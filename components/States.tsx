"use client";

import { useEffect, useState } from "react";
import MindGapMark from "@/components/MindGapMark";
import RichText from "@/components/RichText";

/** Reusable loading / error / empty presentational states. */

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

/**
 * The one eyebrow style. Card-level headers only ("Detected problem",
 * "Key concept", "Your problem", …) — section labels inside a card use plain
 * `text-xs font-medium text-slate-500` instead.
 */
export function Eyebrow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 ${className}`}
    >
      {children}
    </p>
  );
}

/** The tutor's identity row: a small brand-tinted circle with the mark + label. */
export function TutorLabel() {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-50">
        <MindGapMark className="h-3.5 w-3.5" />
      </span>
      <span className="text-xs font-medium text-slate-500">Tutor</span>
    </div>
  );
}

/**
 * The session's opening nudge: one line pointing at where to start, plus a
 * quiet reminder that asking is an option.
 *
 * Deliberately lighter than a real tutor turn — no avatar row, muted colour,
 * smaller type. It is a starting point offered before the student has done
 * anything, so it should sit in the corner of their eye rather than announce
 * itself like an answer.
 */
export function OpeningNudge({ text }: { text: string }) {
  return (
    <div className="animate-fade-in space-y-1.5 border-l-2 border-hairline pl-3">
      <div className="text-[15px] leading-relaxed text-slate-600">
        <RichText text={text} />
      </div>
      <p className="text-xs text-slate-500">
        Still stuck? Just ask below, or tap Hint.
      </p>
    </div>
  );
}

/** A tutor turn in progress: the avatar row, then three typing dots. */
export function LoadingState({ label }: { label: string }) {
  return (
    <div className="animate-fade-in" role="status">
      <TutorLabel />
      <div className="mt-2 flex items-center gap-3 text-slate-500">
        <span className="flex items-center gap-1" aria-hidden="true">
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-600" />
          <span
            className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-600"
            style={{ animationDelay: "0.15s" }}
          />
          <span
            className="typing-dot h-1.5 w-1.5 rounded-full bg-brand-600"
            style={{ animationDelay: "0.3s" }}
          />
        </span>
        <span className="text-sm">{label}</span>
      </div>
    </div>
  );
}

const ANALYSIS_STAGES: { at: number; label: string }[] = [
  { at: 0, label: "Reading your photo…" },
  { at: 2500, label: "Finding the concept…" },
  { at: 6000, label: "Almost there…" },
];

/**
 * Placeholder that mirrors ProblemCard's final layout so the card doesn't jump
 * when the analysis lands: image block, two chips, a three-line paragraph and a
 * two-line serif-height concept. The label under it is staged on a purely
 * client-side timer — it reflects elapsed time, not real progress.
 */
export function ProblemCardSkeleton() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const timers = ANALYSIS_STAGES.slice(1).map((s, i) =>
      window.setTimeout(() => setStage(i + 1), s.at),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  return (
    <div className="animate-fade-in" role="status" aria-live="polite">
      <div className="overflow-hidden rounded-lg border border-hairline bg-surface">
        <div className="skeleton h-44 w-full rounded-none rounded-t-lg" />
        <div className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <span className="skeleton h-6 w-16 rounded-full" />
            <span className="skeleton h-6 w-24 rounded-full" />
          </div>
          <div className="space-y-2">
            <div className="skeleton h-3.5 w-full" />
            <div className="skeleton h-3.5 w-11/12" />
            <div className="skeleton h-3.5 w-3/4" />
          </div>
          <div className="space-y-2 pt-1">
            <div className="skeleton h-5 w-5/6" />
            <div className="skeleton h-5 w-1/2" />
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm text-slate-500">{ANALYSIS_STAGES[stage].label}</p>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-danger-800">
      <p className="text-sm font-medium">Something went wrong</p>
      <p className="mt-0.5 text-sm text-danger-700">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 h-9 rounded-md bg-danger-600 px-3 text-sm font-medium text-white transition hover:bg-danger-700"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-surface/60 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}
