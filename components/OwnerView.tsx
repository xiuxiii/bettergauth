"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  BarChart3,
  Check,
  ChevronLeft,
  Copy,
  FlaskConical,
  Gauge,
  KeyRound,
  Play,
  ScanSearch,
  Sparkles,
  Square,
  ToggleRight,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { NetworkError, readApiError } from "@/lib/apiClient";
import { pinnedRunProblem } from "@/lib/ai/choose";
import { EmptyState, Spinner } from "@/components/States";
import SettingsGroup from "@/components/ui/SettingsGroup";
import {
  PROVIDER_NAME,
  RUN_SPECS,
  casesFor,
  failedResult,
  formatDay,
  hasActivity,
  ofText,
  reportText,
  runTitle,
  splitRate,
  usageFields,
  type OwnerCase,
  type OwnerStatus,
  type Provider,
  type RunId,
  type RunSpec,
  type UsageDay,
} from "@/lib/ownerFormat";
// Shared with `npm run eval`, so the page and the CLI can't disagree.
import { summarize } from "@/evals/score.mjs";
import { formatResult, formatSummary } from "@/evals/format.mjs";
import type { EvalResult } from "@/evals/runCase.mjs";

/**
 * The owner's page, `/owner?code=<DEBUG_CODE>`: what's configured, how the app
 * was used over the last two weeks, and the evals as one-tap runs whose
 * results can be copied to the developer. For someone who works from a phone
 * and never runs the CLI.
 *
 * Without the code (or with a wrong one: the routes answer 404) it is the
 * app's plain "Page not found", so it doesn't advertise itself.
 */

/** A route's 404 is "wrong code", which the page answers with Not found. */
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * `fetch` with a dropped connection surfaced as a NetworkError, like
 * `apiFetch`, but WITHOUT the student's saved tutor choice (`x-ai-provider`):
 * a run pinned to Claude must not be steered to DeepSeek by a pick left in
 * this browser's storage.
 */
async function ownerFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, { cache: "no-store", ...init });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new NetworkError();
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await ownerFetch(url);
  if (!res.ok) {
    const message = await readApiError(res, `HTTP ${res.status}`);
    throw new HttpError(res.status, message);
  }
  return (await res.json()) as T;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Loaded<T> = { state: "loading" } | { state: "ok"; data: T } | { state: "error"; message: string };

type Phase = "checking" | "notFound" | "error" | "ready";

type RunState = {
  spec: RunSpec;
  startedAt: string;
  total: number;
  /** Cases finished, failed or not. */
  done: number;
  /** The case in flight. */
  current: string | null;
  results: EvalResult[];
  lines: string[];
  status: "running" | "done" | "stopped";
};

const SAFE_TOP = "pt-[max(1rem,calc(env(safe-area-inset-top,0px)+0.5rem))]";

export default function OwnerView() {
  const [phase, setPhase] = useState<Phase>("checking");
  const [loadError, setLoadError] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<OwnerStatus | null>(null);
  const [usage, setUsage] = useState<Loaded<{ store: string; days: UsageDay[] }>>({
    state: "loading",
  });
  const [cases, setCases] = useState<Loaded<OwnerCase[]>>({ state: "loading" });

  const load = useCallback(async (c: string) => {
    setPhase("checking");
    const q = `code=${encodeURIComponent(c)}`;
    const [s, u, k] = await Promise.allSettled([
      getJson<OwnerStatus>(`/api/owner/status?${q}`),
      getJson<{ store: string; days: UsageDay[] }>(`/api/usage?${q}&days=14`),
      getJson<{ cases: OwnerCase[] }>(`/api/owner/cases?${q}`),
    ]);
    if (s.status === "rejected") {
      if (s.reason instanceof HttpError && s.reason.status === 404) {
        setPhase("notFound");
      } else {
        setLoadError(errorText(s.reason));
        setPhase("error");
      }
      return;
    }
    setStatus(s.value);
    setUsage(
      u.status === "fulfilled"
        ? { state: "ok", data: { store: u.value.store, days: u.value.days ?? [] } }
        : { state: "error", message: errorText(u.reason) },
    );
    setCases(
      k.status === "fulfilled"
        ? { state: "ok", data: k.value.cases ?? [] }
        : { state: "error", message: errorText(k.reason) },
    );
    setPhase("ready");
  }, []);

  // Read in the client, after mount: useSearchParams would need a Suspense
  // boundary, and the code is only ever used for these client fetches.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code")?.trim();
    if (!c) {
      setPhase("notFound");
      return;
    }
    setCode(c);
    void load(c);
  }, [load]);

  // ---- Runs ---------------------------------------------------------------

  const [runs, setRuns] = useState<Partial<Record<RunId, RunState>>>({});
  const [activeId, setActiveId] = useState<RunId | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function start(spec: RunSpec) {
    if (activeId || !code || cases.state !== "ok") return;
    const list = casesFor(spec, cases.data);
    if (!list.length) return;
    const controller = new AbortController();
    abortRef.current = controller;

    let run: RunState = {
      spec,
      startedAt: new Date().toISOString(),
      total: list.length,
      done: 0,
      current: list[0].id,
      results: [],
      lines: [],
      status: "running",
    };
    const put = (next: RunState) => {
      run = next;
      setRuns((all) => ({ ...all, [spec.id]: next }));
    };
    put(run);
    setActiveId(spec.id);

    // One case per request, in order: each is several model calls, and one
    // at a time keeps a run inside the rate limits and the function timeout.
    for (const c of list) {
      if (controller.signal.aborted) break;
      put({ ...run, current: c.id });
      let result: EvalResult;
      let lines: string[];
      try {
        const res = await ownerFetch("/api/owner/eval", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            caseId: c.id,
            provider: spec.provider,
            ...(spec.grid ? { grid: true } : {}),
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const why = await readApiError(res, "");
          throw new Error(`HTTP ${res.status}${why ? `: ${why}` : ""}`);
        }
        const data = (await res.json()) as { result?: unknown; lines?: unknown; error?: unknown };
        if (typeof data.error === "string") throw new Error(data.error);
        if (!data.result || typeof data.result !== "object") {
          throw new Error("The response had no result.");
        }
        result = data.result as EvalResult;
        lines = Array.isArray(data.lines) ? data.lines.map(String) : formatResult(result);
      } catch (err) {
        if (controller.signal.aborted) break;
        const message = errorText(err);
        result = failedResult(c, message);
        lines = formatResult(result);
      }
      put({
        ...run,
        done: run.done + 1,
        results: [...run.results, result],
        lines: [...run.lines, ...lines],
      });
    }

    put({ ...run, current: null, status: controller.signal.aborted ? "stopped" : "done" });
    if (abortRef.current === controller) abortRef.current = null;
    setActiveId(null);
  }

  function stop() {
    abortRef.current?.abort();
  }

  const active = activeId ? runs[activeId] : undefined;
  const lastRun = Object.values(runs)
    .filter((r): r is RunState => !!r)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const progress = active
    ? `Running ${Math.min(active.done + 1, active.total)} / ${active.total}${active.current ? ` · ${active.current}` : ""}`
    : lastRun
      ? `${runTitle(lastRun.spec)}: ${
          lastRun.status === "stopped"
            ? `stopped after ${lastRun.done} of ${lastRun.total}`
            : `finished, ${lastRun.total} ${lastRun.total === 1 ? "case" : "cases"}`
        }.`
      : "";

  // ---- Not found / loading / error ---------------------------------------

  if (phase === "notFound") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md animate-rise flex-col items-center justify-center px-6 text-center">
        <EmptyState title="Page not found" hint="That link doesn't lead anywhere in MindGap." />
        <Link
          href="/"
          className="mt-4 inline-flex h-11 items-center rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-raised transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep"
        >
          Go to home
        </Link>
      </main>
    );
  }

  if (phase === "checking" || (phase === "ready" && !status)) {
    return (
      <main className="flex min-h-dvh items-center justify-center" role="status">
        <Spinner className="h-5 w-5 text-slate-400" />
        <span className="sr-only">Loading</span>
      </main>
    );
  }

  if (phase === "error") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6">
        <div className="w-full rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-danger-800">
          <p className="text-sm font-medium">Couldn&apos;t load this page</p>
          <p className="mt-0.5 text-sm">{loadError}</p>
          <button
            type="button"
            onClick={() => code && void load(code)}
            className="mt-3 h-11 rounded-md bg-danger-solid px-4 text-sm font-semibold text-white transition hover:bg-danger-deep active:bg-danger-deep"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  const s = status!;

  return (
    <main
      className={`mx-auto min-h-dvh w-full max-w-md animate-rise px-4 pb-24 ${SAFE_TOP} md:max-w-lg md:pt-10`}
    >
      <header className="mb-5 flex items-center gap-1">
        <Link
          href="/"
          aria-label="Back"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
        >
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <h1 className="font-serif text-2xl font-normal leading-[1.15] tracking-tight text-ink">
          Owner
        </h1>
      </header>

      <div className="space-y-8">
        <StatusSection status={s} />
        <UsageSection usage={usage} />

        <div className="space-y-3">
          <SettingsGroup
            title="Run tests"
            footer="One run at a time, one case after another. Each case is a few real model calls, so a run takes a few minutes."
          >
            {RUN_SPECS.map((spec) => (
              <RunRow
                key={spec.id}
                spec={spec}
                status={s}
                cases={cases}
                run={runs[spec.id]}
                busy={activeId !== null}
                active={activeId === spec.id}
                onRun={() => void start(spec)}
                onStop={stop}
              />
            ))}
          </SettingsGroup>

          {/* Always mounted, so each change is announced. */}
          <p
            role="status"
            aria-live="polite"
            className={`px-4 text-sm tnum ${active ? "font-medium text-ink" : "text-slate-500"} ${progress ? "" : "sr-only"}`}
          >
            {progress}
          </p>
        </div>

        {RUN_SPECS.map((spec) => {
          const run = runs[spec.id];
          return run ? <RunPanel key={spec.id} run={run} onStop={stop} /> : null;
        })}
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

type Tone = "ok" | "warn";

function InfoRow({
  icon: Icon,
  label,
  value,
  description,
  tone = "ok",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  description?: string;
  tone?: Tone;
}) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-3">
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-sm bg-brand-50 text-brand-700">
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-5 text-ink">{label}</span>
        {description && (
          <span className="block text-xs leading-4 text-slate-500">{description}</span>
        )}
      </span>
      <span
        className={
          "flex flex-shrink-0 items-center gap-1 text-right text-sm " +
          (tone === "warn" ? "font-medium text-warn-700" : "text-slate-600")
        }
      >
        {tone === "warn" && <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />}
        {value}
      </span>
    </div>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-lg border border-warn-200 bg-warn-50 px-4 py-3 text-sm leading-5 text-warn-800">
      <TriangleAlert size={18} strokeWidth={1.75} className="mt-px flex-shrink-0" aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}

const storeText = (store: "redis" | "memory") => (store === "redis" ? "Redis" : "Memory");

function StatusSection({ status: s }: { status: OwnerStatus }) {
  const keys = (["deepseek", "anthropic"] as const).filter((p) => s.providers[p]);
  const both = keys.length === 2;
  const backup =
    s.tutor && both ? `${PROVIDER_NAME[s.tutor === "deepseek" ? "anthropic" : "deepseek"]} is the backup` : undefined;

  return (
    <div className="space-y-3">
      <SettingsGroup title="Status">
        <InfoRow
          icon={Sparkles}
          label="Tutor"
          value={s.tutor ? PROVIDER_NAME[s.tutor] : "None"}
          description={s.tutor ? backup : "Students can't be tutored"}
          tone={s.tutor ? "ok" : "warn"}
        />
        <InfoRow
          icon={KeyRound}
          label="Keys"
          value={keys.length ? keys.map((p) => PROVIDER_NAME[p]).join(", ") : "None"}
          description={
            s.providers.deepseek
              ? s.deepseekVision
                ? "DeepSeek reads photos itself"
                : "Every photo goes to Claude"
              : undefined
          }
          tone={keys.length ? "ok" : "warn"}
        />
        <InfoRow
          icon={ScanSearch}
          label="Detection"
          value={s.detectProvider ? PROVIDER_NAME[s.detectProvider] : "Same as tutor"}
          description={`Coordinate grid ${s.detectGrid ? "on" : "off"}`}
        />
        <InfoRow
          icon={ToggleRight}
          label="Tutor switch"
          value={s.tutorSwitch ? "On" : "Off"}
          description={s.tutorSwitch ? "Students can pick the tutor" : "Students can't pick the tutor"}
        />
        <InfoRow
          icon={Gauge}
          label="Rate-limit store"
          value={storeText(s.rateLimitStore)}
          description={s.rateLimitStore === "redis" ? "Shared by every instance" : "Resets on a cold start"}
          tone={s.rateLimitStore === "memory" ? "warn" : "ok"}
        />
        <InfoRow
          icon={BarChart3}
          label="Usage store"
          value={storeText(s.usageStore)}
          description={s.usageStore === "redis" ? "Kept 90 days" : "Lost on a cold start"}
          tone={s.usageStore === "memory" ? "warn" : "ok"}
        />
        <InfoRow
          icon={FlaskConical}
          label="Eval bypass"
          value={s.evalBypass ? "Set" : "Not set"}
          description={
            s.evalBypass ? "Test runs skip the limits" : "Test runs count as use and can't pin a tutor"
          }
          tone={s.evalBypass ? "ok" : "warn"}
        />
      </SettingsGroup>

      {s.rateLimitStore === "memory" && (
        <Callout>
          The daily spend cap resets on every cold start. Connect Upstash in Vercel → Storage,
          then redeploy.
        </Callout>
      )}
      {!s.evalBypass && (
        <Callout>
          Set EVAL_BYPASS_TOKEN in Vercel so test runs don&apos;t use your daily limit or show up in
          usage. Without it the app ignores a run&apos;s DeepSeek / Claude pick, so runs pinned to
          the other provider are off.
        </Callout>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

function UsageSection({ usage }: { usage: Loaded<{ store: string; days: UsageDay[] }> }) {
  const days = usage.state === "ok" ? usage.data.days.filter(hasActivity) : [];
  return (
    <SettingsGroup
      title="Usage · last 14 days"
      footer="Days in UTC, newest first. Anonymous counts only."
    >
      {usage.state === "loading" && (
        <p className="px-4 py-6 text-center text-sm text-slate-500">Loading…</p>
      )}
      {usage.state === "error" && (
        <p className="px-4 py-4 text-sm text-danger-700">Couldn&apos;t load usage: {usage.message}</p>
      )}
      {usage.state === "ok" && !days.length && (
        <p className="px-4 py-6 text-center text-sm text-slate-500">No activity yet</p>
      )}
      {days.map((day) => (
        <article key={day.date} aria-label={formatDay(day.date)} className="px-4 py-3">
          <h3 className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-medium text-ink">{formatDay(day.date)}</span>
            <span className="text-xs text-slate-500 tnum">{day.date}</span>
          </h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2.5">
            {usageFields(day).map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-xs leading-4 text-slate-500">{f.label}</dt>
                <dd
                  className={
                    "text-sm font-medium leading-5 tnum " +
                    (f.alert ? "text-danger-700" : "text-ink")
                  }
                >
                  {f.value}
                  {f.detail && (
                    <span className="block text-xs font-normal leading-4 text-slate-500">
                      {f.detail}
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </article>
      ))}
    </SettingsGroup>
  );
}

// ---------------------------------------------------------------------------
// Runs
// ---------------------------------------------------------------------------

const PRIMARY_BTN =
  "inline-flex h-11 min-w-[5.5rem] flex-shrink-0 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-semibold transition " +
  "bg-brand-600 text-white hover:bg-accent-deep active:bg-accent-deep " +
  "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500";
const SECONDARY_BTN =
  "inline-flex h-11 flex-shrink-0 items-center justify-center gap-1.5 rounded-md border border-slate-300 bg-surface px-4 text-sm font-semibold text-ink transition hover:bg-slate-100 active:bg-slate-100 " +
  "disabled:cursor-not-allowed disabled:text-slate-500";

function caseCountText(spec: RunSpec, list: OwnerCase[]): string {
  const n = list.length;
  if (spec.group === "detect") {
    const photos = `${n} ${n === 1 ? "photo" : "photos"}`;
    if (!spec.grid) return photos;
    const withGrid = list.filter((c) => c.hasGrid).length;
    return withGrid === n ? `${photos}, all with a grid` : `${photos}, ${withGrid} with a grid`;
  }
  return `${n} ${n === 1 ? "case" : "cases"}`;
}

function RunRow({
  spec,
  status,
  cases,
  run,
  busy,
  active,
  onRun,
  onStop,
}: {
  spec: RunSpec;
  status: OwnerStatus;
  cases: Loaded<OwnerCase[]>;
  run?: RunState;
  busy: boolean;
  active: boolean;
  onRun: () => void;
  onStop: () => void;
}) {
  const title = runTitle(spec);
  const configured = status.providers[spec.provider];
  const list = cases.state === "ok" ? casesFor(spec, cases.data) : [];

  // The server refuses a pinned run it would quietly put on another provider
  // (no EVAL_BYPASS_TOKEN); say so here instead of failing every case.
  const pinIgnored =
    configured &&
    !!pinnedRunProblem({
      provider: spec.provider,
      detect: spec.group === "detect",
      bypass: status.evalBypass,
      configured: status.providers,
      defaultProvider: status.tutor,
      tutorSwitch: status.tutorSwitch,
      detectProvider: status.detectProvider,
    });

  let note: string;
  if (!configured) note = `No ${PROVIDER_NAME[spec.provider]} key`;
  else if (pinIgnored) note = "Needs EVAL_BYPASS_TOKEN to pin the tutor";
  else if (cases.state === "loading") note = "Loading cases…";
  else if (cases.state === "error") note = "Couldn't load the cases";
  else if (!list.length) note = "No cases";
  else if (active && run) note = `Running ${Math.min(run.done + 1, run.total)} of ${run.total}`;
  else note = caseCountText(spec, list);

  const canRun = configured && !pinIgnored && list.length > 0 && !busy;

  return (
    <div className="flex min-h-[52px] items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-5 text-ink">{title}</span>
        <span className="block text-xs leading-4 text-slate-500">
          {note}
          {run && !active && run.status !== "running" && ` · last run ${run.status === "stopped" ? "stopped" : "done"}`}
        </span>
      </span>
      {active ? (
        <button type="button" onClick={onStop} aria-label={`Stop ${title}`} className={SECONDARY_BTN}>
          <Square size={14} strokeWidth={2} aria-hidden="true" />
          Stop
        </button>
      ) : (
        <button
          type="button"
          onClick={onRun}
          disabled={!canRun}
          aria-label={`Run ${title}`}
          className={PRIMARY_BTN}
        >
          <Play size={14} strokeWidth={2} aria-hidden="true" />
          Run
        </button>
      )}
    </div>
  );
}

type TileTone = "neutral" | "good" | "bad";

function Tile({
  label,
  value,
  unit,
  detail,
  tone = "neutral",
  wide = false,
}: {
  label: string;
  value: string;
  /** Small, after the value: "cases". */
  unit?: string;
  detail?: string;
  tone?: TileTone;
  wide?: boolean;
}) {
  const box =
    tone === "good"
      ? "border-success-200 bg-success-50 text-success-800"
      : tone === "bad"
        ? "border-danger-200 bg-danger-50 text-danger-800"
        : "border-hairline bg-paper text-ink";
  const sub = tone === "neutral" ? "text-slate-500" : "";
  return (
    <div className={`min-w-0 rounded-md border px-3 py-2.5 ${box} ${wide ? "col-span-2" : ""}`}>
      <p className={`text-xs font-medium leading-4 ${sub}`}>{label}</p>
      <p
        className={`mt-1 flex items-center gap-1.5 font-semibold leading-none tracking-tight ${wide ? "text-4xl" : "text-2xl"}`}
      >
        {value}
        {unit && <span className="text-sm font-medium tracking-normal">{unit}</span>}
        {tone === "good" && <Check size={wide ? 24 : 18} strokeWidth={2.5} aria-hidden="true" />}
        {tone === "bad" && <TriangleAlert size={wide ? 24 : 18} strokeWidth={2} aria-hidden="true" />}
      </p>
      {detail && <p className={`mt-1.5 text-xs leading-4 ${sub}`}>{detail}</p>}
    </div>
  );
}

function Headline({ run }: { run: RunState }) {
  const s = summarize(run.results);
  if (run.spec.group === "detect") {
    const hit = splitRate(s.detectHitRate);
    return (
      <div className="grid grid-cols-2 gap-2">
        <Tile
          wide
          label="Hit rate"
          value={hit.value}
          detail={`${hit.detail ? `${hit.detail} questions` : "Questions"}: label found, centre inside, IoU ≥ 0.5`}
        />
        <Tile label="Mean IoU" value={s.detectMeanIoU} detail="1.00 = exact overlap" />
        <Tile label="Mean dy" value={s.detectMeanDy} detail="Negative = boxes too high" />
      </div>
    );
  }
  const falseAlarm = s.falseAlarmRate;
  const tone: TileTone = falseAlarm === "0%" ? "good" : falseAlarm === "n/a" ? "neutral" : "bad";
  return (
    <div className="grid grid-cols-2 gap-2">
      <Tile
        wide
        tone={tone}
        label={"False “you’re wrong”"}
        value={falseAlarm}
        detail="Correct work judged wrong. Must stay at 0%."
      />
      <Tile label="Verdict accuracy" value={s.verdictAccuracy} />
      <Tile label="Missed errors" value={s.missedErrorRate} />
      <Tile
        label="Answer leaks"
        value={String(s.answerLeaks)}
        unit={s.answerLeaks === 1 ? "case" : "cases"}
      />
      <Tile label="First-error category" value={s.categoryMatch} />
      <Tile label="Not-STEM turned away" value={ofText(s.notStemTurnedAway)} />
      <Tile label="Tutor replies passed" value={ofText(s.tutorPassed)} />
    </div>
  );
}

const COPIED_MS = 2000;

function RunPanel({ run, onStop }: { run: RunState; onStop: () => void }) {
  const title = runTitle(run.spec);
  const running = run.status === "running";
  const failed = run.results.filter((r) => r.failed).length;

  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    },
    [],
  );
  // A fresh run replaces the old text.
  useEffect(() => setManual(null), [run.startedAt]);
  useEffect(() => {
    if (manual !== null) textareaRef.current?.select();
  }, [manual]);

  async function copy() {
    const text = reportText({
      title,
      startedAt: run.startedAt,
      lines: run.lines,
      summary: formatSummary(run.results),
      stopped: run.status === "stopped" ? { done: run.done, total: run.total } : undefined,
    });
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setManual(null);
      setCopied(true);
      if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      // No clipboard (an http page, an old browser, a denied permission):
      // put the text in front of them, selected, to copy by hand.
      setManual(text);
    }
  }

  const when = new Date(run.startedAt).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const sub = running
    ? `Running ${Math.min(run.done + 1, run.total)} of ${run.total}`
    : run.status === "stopped"
      ? `Stopped after ${run.done} of ${run.total} · ${when}`
      : `${run.total} ${run.total === 1 ? "case" : "cases"} · ${when}`;

  return (
    <section
      aria-label={`${title} results`}
      className="animate-fade-in rounded-lg border border-hairline bg-surface p-4"
    >
      <h2 className="text-[15px] font-semibold leading-5 text-ink">{title}</h2>
      <p className="mt-0.5 text-xs text-slate-500 tnum">{sub}</p>

      {running && (
        <div className="mt-3 flex items-center gap-3">
          <div
            role="progressbar"
            aria-label={`${title} progress`}
            aria-valuemin={0}
            aria-valuemax={run.total}
            aria-valuenow={run.done}
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"
          >
            <div
              className="h-full rounded-full bg-brand-600 transition-[width] duration-300"
              style={{ width: `${(100 * run.done) / Math.max(1, run.total)}%` }}
            />
          </div>
          <button type="button" onClick={onStop} className={SECONDARY_BTN}>
            <Square size={14} strokeWidth={2} aria-hidden="true" />
            Stop
          </button>
        </div>
      )}

      {!running && run.results.length > 0 && (
        <div className="mt-3">
          <Headline run={run} />
        </div>
      )}

      {!running && (
        <p
          className={`mt-3 flex items-center gap-1.5 text-sm ${failed ? "font-medium text-danger-700" : "text-slate-500"}`}
        >
          {failed > 0 && <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" />}
          {failed
            ? `${failed} of ${run.results.length} ${run.results.length === 1 ? "case" : "cases"} failed to run`
            : run.results.length
              ? `All ${run.results.length} ran`
              : "Nothing ran"}
        </p>
      )}

      {run.lines.length > 0 && (
        <pre className="mt-3 whitespace-pre-wrap break-words rounded-sm border border-hairline bg-paper px-3 py-2 font-mono text-[11px] leading-[1.5] text-slate-700 [overflow-wrap:anywhere]">
          {run.lines.map((line, i) => (
            <span
              key={i}
              className={
                // A hanging indent, so a wrapped line reads as one line.
                "block pl-[2ch] -indent-[2ch]" + (/^\s*[✗!]/.test(line) ? " text-danger-700" : "")
              }
            >
              {/* The CLI pads ids into columns; on a phone that only wraps. */}
              {line.replace(/(\S) {3,}/g, "$1  ")}
            </span>
          ))}
        </pre>
      )}

      {!running && (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" onClick={() => void copy()} className={SECONDARY_BTN}>
            {copied ? (
              <Check size={16} strokeWidth={2} aria-hidden="true" />
            ) : (
              <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
            )}
            Copy results
          </button>
          <span role="status" aria-live="polite" className="text-sm font-medium text-success-700">
            {copied ? "Copied" : ""}
          </span>
        </div>
      )}

      {manual !== null && !running && (
        <div className="mt-3">
          <label htmlFor={`manual-${run.spec.id}`} className="block text-xs text-slate-500">
            Copying isn&apos;t allowed here. The text is selected: copy it from this box.
          </label>
          <textarea
            id={`manual-${run.spec.id}`}
            ref={textareaRef}
            readOnly
            value={manual}
            rows={8}
            onFocus={(e) => e.currentTarget.select()}
            className="mt-1 w-full rounded-sm border border-slate-300 bg-paper px-3 py-2 font-mono text-[11px] leading-[1.5] text-ink"
          />
        </div>
      )}
    </section>
  );
}
