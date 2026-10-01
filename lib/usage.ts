/**
 * Anonymous usage counts: how many sessions, checks, hints and solves a day,
 * which tutor ran, how long calls took, and how often things failed. Enough to
 * answer "did the students use it, did it help, is DeepSeek holding up?"
 * without watching over a shoulder.
 *
 * The users are minors, so nothing identifying is kept: no problem text, no
 * photos, no replies, no IPs, no session ids. Only per-day counters, plus a
 * HyperLogLog of keyed device hashes, which estimates how many distinct
 * devices showed up and cannot be read back into hashes, let alone IPs.
 *
 * Pure (no Next) so `npm test` can import it; lib/usageServer.ts wires it to
 * the routes. Stored in the same Upstash Redis as the rate limits when that's
 * configured (90 days, then expired), else in module memory.
 */

import type { CheckVerdict, ErrorCategory, TutorAction } from "@/lib/tutor/types";
import { redisPipeline, type RedisCommand } from "@/lib/redisRest";

/** The AI routes, as they appear in counter names. */
export type UsageRoute =
  | "analyze"
  | "check"
  | "tutor"
  | "detect"
  | "practiceGenerate"
  | "practiceEvaluate"
  | "progress";

type PracticeVerdict = "correct" | "partially_correct" | "incorrect";

/**
 * Every counter there is. A template-literal union, so a typo in a route is a
 * type error rather than a new, silently empty counter.
 */
export type UsageCounter =
  | "session.photo"
  | "session.text"
  | "turnedAway"
  | "check"
  | "check.retry"
  | `verdict.${CheckVerdict}`
  | `category.${ErrorCategory}`
  | `turn.${TutorAction}`
  | "resolved"
  | "practice.generate"
  | `practice.${PracticeVerdict}`
  | "detect"
  | `provider.${"deepseek" | "anthropic"}`
  | `ms.${UsageRoute}`
  | `n.${UsageRoute}`
  | `slow.${UsageRoute}`
  | `error.${UsageRoute}.${number}`
  | "limited.minute"
  | "limited.day"
  | `fallback.${string}`;

export type Counts = Partial<Record<UsageCounter, number>>;

/** A call slower than this is counted as slow for its route. */
export const SLOW_MS = 10_000;
/** How long a day's counts are kept. */
export const KEEP_DAYS = 90;

/** The UTC day a moment falls in, as YYYY-MM-DD. */
export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** The last `n` days, newest first. */
export function lastDays(now: number, n: number): string[] {
  return Array.from({ length: n }, (_, i) => dayKey(now - i * 86_400_000));
}

export type DayUsage = { date: string; devices: number; counts: Record<string, number> };

export interface UsageStore {
  add(day: string, counts: Counts, deviceId?: string): Promise<void>;
  read(days: string[]): Promise<DayUsage[]>;
}

export class MemoryUsageStore implements UsageStore {
  private days = new Map<string, { counts: Record<string, number>; devices: Set<string> }>();

  async add(day: string, counts: Counts, deviceId?: string): Promise<void> {
    let d = this.days.get(day);
    if (!d) {
      d = { counts: {}, devices: new Set() };
      this.days.set(day, d);
    }
    for (const [k, v] of Object.entries(counts)) {
      if (v) d.counts[k] = (d.counts[k] ?? 0) + v;
    }
    if (deviceId) d.devices.add(deviceId);
  }

  async read(days: string[]): Promise<DayUsage[]> {
    return days.map((date) => {
      const d = this.days.get(date);
      return { date, devices: d?.devices.size ?? 0, counts: { ...(d?.counts ?? {}) } };
    });
  }
}

export class RedisUsageStore implements UsageStore {
  constructor(
    private url: string,
    private token: string,
    private prefix = "mg:usage:",
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async add(day: string, counts: Counts, deviceId?: string): Promise<void> {
    const key = this.prefix + day;
    const ttl = KEEP_DAYS * 86_400;
    const commands: RedisCommand[] = [];
    for (const [field, n] of Object.entries(counts)) {
      if (n) commands.push(["HINCRBY", key, field, Math.round(n)]);
    }
    if (commands.length) commands.push(["EXPIRE", key, ttl]);
    if (deviceId) {
      commands.push(["PFADD", `${key}:devices`, deviceId], ["EXPIRE", `${key}:devices`, ttl]);
    }
    if (commands.length) await redisPipeline(this.url, this.token, commands, this.fetchImpl);
  }

  async read(days: string[]): Promise<DayUsage[]> {
    const commands: RedisCommand[] = days.flatMap((d) => [
      ["HGETALL", this.prefix + d],
      ["PFCOUNT", `${this.prefix}${d}:devices`],
    ]);
    const replies = await redisPipeline(this.url, this.token, commands, this.fetchImpl);
    return days.map((date, i) => ({
      date,
      counts: hashReply(replies[i * 2]),
      devices: Number(replies[i * 2 + 1]) || 0,
    }));
  }
}

/** HGETALL comes back as a flat [field, value, field, value, …] list. */
function hashReply(reply: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (Array.isArray(reply)) {
    for (let i = 0; i + 1 < reply.length; i += 2) out[String(reply[i])] = Number(reply[i + 1]) || 0;
  } else if (reply && typeof reply === "object") {
    for (const [k, v] of Object.entries(reply)) out[k] = Number(v) || 0;
  }
  return out;
}

/** The counters for one finished AI call: its route, time, tutor and status. */
export function callCounts(
  route: UsageRoute,
  ms: number,
  status: number,
  provider?: string,
): Counts {
  const counts: Counts = { [`n.${route}`]: 1, [`ms.${route}`]: Math.max(0, Math.round(ms)) };
  if (ms > SLOW_MS) counts[`slow.${route}`] = 1;
  if (status >= 400) counts[`error.${route}.${status}`] = 1;
  if (provider === "deepseek" || provider === "anthropic") counts[`provider.${provider}`] = 1;
  return counts;
}

/**
 * The readable summary of a day: the raw counts, plus the averages and rates
 * that are tedious to work out by hand.
 */
export function summarizeDay(day: DayUsage) {
  const c = day.counts;
  const avgMs: Record<string, number> = {};
  for (const [k, n] of Object.entries(c)) {
    if (!k.startsWith("n.") || !n) continue;
    const route = k.slice(2);
    avgMs[route] = Math.round((c[`ms.${route}`] ?? 0) / n);
  }
  const checks = c["check"] ?? 0;
  const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : null);
  const fallbacks = Object.entries(c)
    .filter(([k]) => k.startsWith("fallback."))
    .reduce((sum, [, n]) => sum + n, 0);
  return {
    ...day,
    avgMs,
    checksCorrectPct: pct(c["verdict.correct"] ?? 0, checks),
    fallbackPctOfDeepseek: pct(fallbacks, c["provider.deepseek"] ?? 0),
  };
}
