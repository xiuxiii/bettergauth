"use client";

import { ArrowRight, X } from "lucide-react";
import type { RecurringGap } from "@/lib/tutor/types";
import RichText from "@/components/RichText";
import { Eyebrow } from "@/components/States";

/**
 * Surfaces a recurring conceptual gap — the same concept failing more than once
 * in a session — with a one-line refresher and a nudge to try it again. This is
 * the payoff of the tutor's cross-turn memory: three wrong answers from ONE
 * underlying misconception get named as one thing, not treated independently.
 *
 * Rendered as a floating card just above the ActionBar, not a third stacked bar.
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
    <div className="mx-4 mb-2 animate-rise rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
      <div className="mb-1 flex items-center justify-between">
        <Eyebrow className="!text-brand-700">
          Recurring gap · <span className="tnum">{gap.count}×</span>
        </Eyebrow>
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-brand-700/70 transition hover:bg-brand-100 active:scale-95"
        >
          <X size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>

      <div className="text-[15px] leading-relaxed text-brand-900">
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
        <div className="mt-1 text-[15px] leading-relaxed text-brand-800">
          <RichText text={gap.correctModel} />
        </div>
      )}

      <button
        onClick={onPractice}
        className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-600 px-3.5 text-sm font-semibold text-white transition hover:bg-accent-deep active:scale-[0.97] active:bg-accent-deep"
      >
        Practice this
        <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
