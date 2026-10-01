/**
 * Counters for the rate limits, and the decision logic that reads them. Pure
 * (no Next, no React) so `npm test` can exercise it; lib/rateLimit.ts wraps it
 * for the routes.
 *
 * Two stores behind one interface:
 * - MemoryStore: module memory. Per warm instance on Vercel, reset by a cold
 *   start, so a daily cap kept here is a brake, not a ceiling.
 * - RedisRestStore: Upstash Redis over its REST API (what Vercel's KV / Redis
 *   integration provisions). One shared count for every instance, so the
 *   daily cap is real. A few lines of fetch, no SDK.
 * FallbackStore puts the two together: Redis when it answers, memory when it
 * doesn't, so a Redis blip never locks every student out.
 */

import { redisPipeline, withTimeout, type RedisCommand } from "@/lib/redisRest";

export type Count = { count: number; resetAt: number };

export interface LimitStore {
  /** Add one. The window starts at the first hit and does not slide. */
  incr(key: string, windowMs: number, now: number): Promise<Count>;
  /** The current count, or null if there is none (or it expired). */
  peek(key: string, now: number): Promise<Count | null>;
  clear(key: string): Promise<void>;
}

export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * 60 * 60_000;

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export class MemoryStore implements LimitStore {
  private buckets = new Map<string, Count>();

  private prune(now: number) {
    if (this.buckets.size < 5000) return;
    for (const [k, b] of this.buckets) if (now >= b.resetAt) this.buckets.delete(k);
  }

  async incr(key: string, windowMs: number, now: number): Promise<Count> {
    this.prune(now);
    let b = this.buckets.get(key);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, b);
    }
    b.count++;
    return { ...b };
  }

  async peek(key: string, now: number): Promise<Count | null> {
    const b = this.buckets.get(key);
    return b && now < b.resetAt ? { ...b } : null;
  }

  async clear(key: string): Promise<void> {
    this.buckets.delete(key);
  }
}

/**
 * Upstash Redis over REST: each operation is one POST to `/pipeline`.
 *
 * `incr` is SET key 0 PX window NX (creates the key with its expiry only if it
 * doesn't exist), then INCR (which keeps the expiry), then PTTL to report when
 * the window ends. Plain SET NX rather than PEXPIRE NX, which needs Redis 7.
 */
export class RedisRestStore implements LimitStore {
  constructor(
    private url: string,
    private token: string,
    private prefix = "mg:rl:",
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private pipeline(commands: RedisCommand[]): Promise<unknown[]> {
    return redisPipeline(this.url, this.token, commands, this.fetchImpl);
  }

  async incr(key: string, windowMs: number, now: number): Promise<Count> {
    const k = this.prefix + key;
    const [, count, pttl] = await this.pipeline([
      ["SET", k, 0, "PX", windowMs, "NX"],
      ["INCR", k],
      ["PTTL", k],
    ]);
    return { count: Number(count), resetAt: now + ttl(pttl, windowMs) };
  }

  async peek(key: string, now: number): Promise<Count | null> {
    const k = this.prefix + key;
    const [value, pttl] = await this.pipeline([
      ["GET", k],
      ["PTTL", k],
    ]);
    if (value === null || value === undefined || Number(pttl) === -2) return null;
    return { count: Number(value), resetAt: now + ttl(pttl, 0) };
  }

  async clear(key: string): Promise<void> {
    await this.pipeline([["DEL", this.prefix + key]]);
  }
}

/** PTTL: ms left; -1 means no expiry (shouldn't happen), -2 means no key. */
function ttl(pttl: unknown, fallback: number): number {
  const n = Number(pttl);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * The shared store when it answers within `timeoutMs`, else the local one.
 * Failing open is deliberate: during a Redis outage the limits drop back to
 * per-instance brakes rather than turning every student away. The provider
 * consoles' spend limits are the hard backstop.
 */
export class FallbackStore implements LimitStore {
  constructor(
    private primary: LimitStore,
    private secondary: LimitStore,
    private timeoutMs: number,
    private onError: (err: unknown) => void,
  ) {}

  private async run<T>(op: (s: LimitStore) => Promise<T>): Promise<T> {
    try {
      return await withTimeout(op(this.primary), this.timeoutMs);
    } catch (err) {
      this.onError(err);
      return op(this.secondary);
    }
  }

  incr(key: string, windowMs: number, now: number) {
    return this.run((s) => s.incr(key, windowMs, now));
  }
  peek(key: string, now: number) {
    return this.run((s) => s.peek(key, now));
  }
  clear(key: string) {
    return this.run((s) => s.clear(key));
  }
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export type Verdict = { ok: true } | { ok: false; reason: "minute" | "day"; resetAt: number };

/**
 * One request from `id` against both windows.
 *
 * Minute brake first. Rejections there count toward the minute (so a
 * hammering client stays blocked) but never toward the day: letting them burn
 * the day's allowance would lock a real student out for 24 hours over one
 * burst. Only ADMITTED requests count toward the day.
 */
export async function admit(
  store: LimitStore,
  id: string,
  limits: { perMin: number; perDay: number },
  now: number,
): Promise<Verdict> {
  const minute = await store.incr(`min:${id}`, MINUTE_MS, now);
  if (minute.count > limits.perMin) return { ok: false, reason: "minute", resetAt: minute.resetAt };

  const day = await store.peek(`day:${id}`, now);
  if (day && day.count >= limits.perDay) return { ok: false, reason: "day", resetAt: day.resetAt };
  await store.incr(`day:${id}`, DAY_MS, now);
  return { ok: true };
}

/**
 * The access gate's guess limit: after UNLOCK_MAX_FAILS wrong codes in
 * UNLOCK_WINDOW_MS, more guesses are refused until the window ends. Only
 * failures count; a correct code clears the count.
 */
export const UNLOCK_MAX_FAILS = 10;
export const UNLOCK_WINDOW_MS = 15 * 60_000;

/** When this client is out of guesses, the time they come back; else null. */
export async function unlockLockedUntil(
  store: LimitStore,
  id: string,
  now: number,
): Promise<number | null> {
  const fails = await store.peek(`unlock:${id}`, now);
  return fails && fails.count >= UNLOCK_MAX_FAILS ? fails.resetAt : null;
}

export async function noteUnlockFail(store: LimitStore, id: string, now: number): Promise<void> {
  await store.incr(`unlock:${id}`, UNLOCK_WINDOW_MS, now);
}

export async function clearUnlockFails(store: LimitStore, id: string): Promise<void> {
  await store.clear(`unlock:${id}`);
}
