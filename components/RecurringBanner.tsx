"use client";

import type { RecurringGap } from "@/lib/tutor/types";
import RichText from "@/components/RichText";

/**
 * Surfaces a recurring conceptual gap — the same concept failing more than once
 * in a session — with a one-line refresher and a nudge to try it again. This is
 * the payoff of the tutor's cross-turn memory: three wrong answers from ONE
 * underlying misconception get named as one thing, not treated independently.
 */
export default function RecurringBanner({
  gap,
  onPractice,
  onDismiss,
}: {
  gap: RecurringGap;
  onPractice: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="animate-rise border-t border-brand-200 bg-brand-50 px-4 py-3">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-px w-4 bg-brand-600" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-700">
            Recurring gap · {gap.count}×
          </span>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-full p-1 text-brand-700/70 transition hover:bg-brand-100 active:scale-95"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}>
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="text-sm text-slate-800">
        {gap.studentBelief ? (
          <RichText text={gap.studentBelief} />
        ) : (
          <span>
            <span className="font-semibold">{gap.concept}</span> has tripped you
            up a few times this session.
          </span>
        )}
      </div>

      {gap.correctModel && (
        <div className="mt-1 text-sm text-slate-600">
          <RichText text={gap.correctModel} />
        </div>
      )}

      <button
        onClick={onPractice}
        className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-3.5 py-1.5 text-sm font-semibold text-white transition hover:bg-brand-700 active:scale-[0.97]"
      >
        Practice this
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    </div>
  );
}
