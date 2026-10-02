/**
 * Pure formatting for the owner page (`/owner`, components/OwnerView.tsx):
 * the five test runs, which cases each one sends, the copyable report, and
 * the per-day usage card. React-free, so it can be unit-tested like the rest
 * of lib/. The summary numbers themselves come from evals/score.mjs and
 * evals/format.mjs, shared with the CLI, so the page and `npm run eval` can't
 * disagree.
 */

export type Provider = "anthropic" | "deepseek";

export const PROVIDER_NAME: Record<Provider, string> = {
  deepseek: "DeepSeek",
  anthropic: "Claude",
};

/** GET /api/owner/status */
export type OwnerStatus = {
  providers: Record<Provider, boolean>;
  tutor: Provider | null;
  detectProvider: Provider | null;
  detectGrid: boolean;
  tutorSwitch: boolean;
  deepseekVision: boolean;
  rateLimitStore: "redis" | "memory";
  usageStore: "redis" | "memory";
  evalBypass: boolean;
};

export type CaseKind = "check" | "notStem" | "tutor" | "detect";

/** GET /api/owner/cases */
export type OwnerCase = { id: string; kind: CaseKind; hasGrid: boolean };

/** One day from GET /api/usage (lib/usage.ts summarizeDay). */
export type UsageDay = {
  date: string;
  devices: number;
  counts: Record<string, number>;
  avgMs: Record<string, number>;
  checksCorrectPct: number | null;
  fallbackPctOfDeepseek: number | null;
};

export type RunGroup = "detect" | "check";
export type RunId =
  | "detect-deepseek"
  | "detect-anthropic"
  | "detect-deepseek-grid"
  | "check-deepseek"
  | "check-anthropic";

export type RunSpec = { id: RunId; group: RunGroup; provider: Provider; grid: boolean };

/** The five buttons, in the order they're shown. */
export const RUN_SPECS: readonly RunSpec[] = [
  { id: "detect-deepseek", group: "detect", provider: "deepseek", grid: false },
  { id: "detect-anthropic", group: "detect", provider: "anthropic", grid: false },
  { id: "detect-deepseek-grid", group: "detect", provider: "deepseek", grid: true },
  { id: "check-deepseek", group: "check", provider: "deepseek", grid: false },
  { id: "check-anthropic", group: "check", provider: "anthropic", grid: false },
];

export const GROUP_TITLE: Record<RunGroup, string> = {
  detect: "Box placement",
  check: "Checking work",
};

/** "DeepSeek", "Claude", "DeepSeek + grid". */
export function variantTitle(spec: RunSpec): string {
  return PROVIDER_NAME[spec.provider] + (spec.grid ? " + grid" : "");
}

/** "Box placement · DeepSeek + grid": the run's name, also the report header. */
export function runTitle(spec: RunSpec): string {
  return `${GROUP_TITLE[spec.group]} · ${variantTitle(spec)}`;
}

/** Box placement sends the detect cases; checking work sends everything else
 *  (check, notStem and tutor), the way `npm run eval` without --kind does. */
export function casesFor(spec: RunSpec, cases: readonly OwnerCase[]): OwnerCase[] {
  return cases.filter((c) =>
    spec.group === "detect" ? c.kind === "detect" : c.kind !== "detect",
  );
}

/** The result recorded for a case that didn't run, in the CLI's shape, so
 *  `summarize` counts it under "failed to run" instead of scoring it. */
export function failedResult(c: OwnerCase, message: string) {
  return { id: c.id, kind: c.kind, failed: true as const, error: message };
}

/**
 * The text "Copy results" puts on the clipboard: the run's name and when it
 * started, every per-case line, then the summary block.
 */
export function reportText({
  title,
  startedAt,
  lines,
  summary,
  stopped,
}: {
  title: string;
  startedAt: string;
  lines: readonly string[];
  summary: readonly string[];
  /** Set when the run was stopped before the last case. */
  stopped?: { done: number; total: number };
}): string {
  const head = [`${title} · ${startedAt}`];
  if (stopped) head.push(`Stopped after ${stopped.done} of ${stopped.total} cases.`);
  return [...head, "", ...lines, "", ...summary].join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** "6/8 (75%)" → { value: "75%", detail: "6 of 8" }; anything else as is. */
export function splitRate(rate: string): { value: string; detail?: string } {
  const m = /^(\d+)\/(\d+) \((.+)\)$/.exec(rate.trim());
  if (!m) return { value: rate };
  return { value: m[3], detail: `${m[1]} of ${m[2]}` };
}

/** "1/1" → "1 of 1", for counts that read better spelled out. */
export function ofText(fraction: string): string {
  const m = /^(\d+)\/(\d+)$/.exec(fraction.trim());
  return m ? `${m[1]} of ${m[2]}` : fraction;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

/** A day worth a card: any counter above zero, or a device seen. */
export function hasActivity(day: UsageDay): boolean {
  return day.devices > 0 || Object.values(day.counts).some((n) => n > 0);
}

/** The sum of every counter whose name starts with `prefix`. */
export function sumPrefix(counts: Record<string, number>, prefix: string): number {
  let n = 0;
  for (const [k, v] of Object.entries(counts)) if (k.startsWith(prefix)) n += v || 0;
  return n;
}

/** "–" for no calls, "850 ms" under a second, "7.1 s" above. */
export function formatMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** "2026-10-02" → "Fri 2 Oct" (the counters are UTC days, so read it as UTC). */
export function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

export type UsageField = { label: string; value: string; detail?: string; alert?: boolean };

/** One day as the key/value pairs of its card. */
export function usageFields(day: UsageDay): UsageField[] {
  const c = day.counts;
  const n = (k: string) => c[k] ?? 0;
  const photo = n("session.photo");
  const text = n("session.text");
  const checks = n("check");
  const errors = sumPrefix(c, "error.");
  const fallbacks = sumPrefix(c, "fallback.");
  const limited = n("limited.minute") + n("limited.day");
  const turnedAway = n("turnedAway");
  return [
    { label: "Devices", value: String(day.devices) },
    {
      label: "Sessions",
      value: String(photo + text),
      detail: photo + text ? `${photo} photo · ${text} typed` : undefined,
    },
    {
      label: "Checks",
      value: String(checks),
      detail: day.checksCorrectPct === null ? undefined : `${day.checksCorrectPct}% correct`,
    },
    {
      label: "Hint · explain · deeper",
      value: `${n("turn.hint")} · ${n("turn.explain")} · ${n("turn.go_deeper")}`,
    },
    { label: "Solved", value: String(n("resolved")) },
    {
      label: "Turned away",
      value: String(turnedAway),
      detail: turnedAway ? "not homework" : undefined,
    },
    { label: "Avg check", value: formatMs(day.avgMs.check) },
    { label: "Avg tutor reply", value: formatMs(day.avgMs.tutor) },
    { label: "Errors", value: String(errors), alert: errors > 0 },
    {
      label: "Fallbacks",
      value: String(fallbacks),
      detail:
        fallbacks && day.fallbackPctOfDeepseek !== null
          ? `${day.fallbackPctOfDeepseek}% of DeepSeek`
          : undefined,
    },
    ...(limited
      ? [{ label: "Rate-limited", value: String(limited), alert: true } satisfies UsageField]
      : []),
  ];
}
