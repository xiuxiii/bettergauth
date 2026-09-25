"use client";

import { Check, CornerDownRight, RotateCcw } from "lucide-react";
import type { ErrorCategory, WorkCheck } from "@/lib/tutor/types";
import {
  fullyRevealed,
  hasFix,
  hasRest,
  nextReveal,
  type RevealStep,
} from "@/lib/tutor/stage";
import RichText from "@/components/RichText";
import { Eyebrow } from "@/components/States";

/** One category, in plain words. The old card showed two tags that disagreed. */
const CATEGORY_LABEL: Record<ErrorCategory, string> = {
  conceptual: "Concept",
  model_selection: "Wrong principle",
  setup: "Setup",
  procedural: "Method step",
  arithmetic: "Arithmetic",
  units_notation: "Units",
};

/**
 * The diagnosis of a student's attempt, revealed one tap at a time:
 *
 *   0  headline → the flagged line → one nudge   [Try again] [Show me the fix]
 *   1  + what the work assumes, and the fix      [Try again] [Show the rest]
 *   2  + the rest of the way (the final answer lives only here)
 *
 * Each piece is its own field from the model, so nothing here hides part of a
 * sentence. A piece that came back empty is skipped, never a dead end: a check
 * with no fix offers "Show the rest" straight away.
 *
 * `reveal` is stored on the message, so a reopened session shows exactly what
 * the student had already opened, and no more.
 */
export default function WorkCheckCard({
  check,
  reveal,
  onReveal,
  onRetry,
  busy,
}: {
  check: WorkCheck;
  reveal: RevealStep;
  onReveal?: (next: RevealStep) => void;
  /** Try the flagged step again. Absent when there is no flagged step. */
  onRetry?: () => void;
  busy?: boolean;
}) {
  const { verdict, headline, strength, firstError: err, continueFrom } = check;
  const correct = verdict === "correct";
  const minor = err?.severity === "minor";

  const accent = correct
    ? "border-success-200"
    : minor
      ? "border-warn-200"
      : "border-danger-200";

  const showFix = !correct && reveal >= 1 && !!err && hasFix(check);
  const showRest = (correct || reveal >= 2) && hasRest(check);
  const done = correct || fullyRevealed(check, reveal);
  const next = done ? null : nextReveal(check, reveal);

  return (
    <div className={`overflow-hidden rounded-lg border bg-surface ${accent}`}>
      <div className="space-y-3 p-4">
        <div className="flex items-start gap-2">
          {correct && (
            <Check
              size={18}
              strokeWidth={2}
              className="mt-0.5 flex-shrink-0 text-success-600"
              aria-hidden="true"
            />
          )}
          <div className="text-[15px] font-medium leading-relaxed text-ink">
            <RichText text={headline} />
          </div>
        </div>

        {strength.trim() && (
          <p className="text-sm leading-relaxed text-slate-500">
            <RichText text={strength} />
          </p>
        )}

        {err && !correct && (
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  minor ? "bg-slate-100 text-slate-600" : "bg-danger-50 text-danger-700"
                }`}
              >
                {CATEGORY_LABEL[err.category] ?? "Mistake"}
              </span>
              {err.locate.trim() && (
                <span className="text-sm text-slate-600">
                  <RichText text={err.locate} />
                </span>
              )}
            </div>

            {err.line.trim() && (
              <blockquote className="rounded-sm border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-[15px] text-ink">
                <RichText text={err.line} />
              </blockquote>
            )}

            {err.nudge.trim() && (
              <div className="flex gap-2 rounded-sm bg-brand-50 px-3 py-2 text-[15px] leading-relaxed text-brand-900">
                <CornerDownRight
                  size={16}
                  strokeWidth={1.75}
                  className="mt-1 flex-shrink-0 text-brand-700"
                  aria-hidden="true"
                />
                <RichText text={err.nudge} />
              </div>
            )}
          </div>
        )}

        {showFix && err && (
          <div className="animate-fade-in space-y-2 border-t border-hairline pt-3 text-[15px] leading-relaxed text-ink">
            {err.diagnosis.trim() && <RichText text={err.diagnosis} />}
            {err.fix.trim() && (
              <div>
                <Eyebrow className="mb-0.5">The fix</Eyebrow>
                <RichText text={err.fix} />
              </div>
            )}
          </div>
        )}

        {showRest && (
          <div className="animate-fade-in rounded-sm bg-brand-50 px-3 py-2">
            <Eyebrow className="mb-0.5 !text-brand-700">
              {correct ? "Why it holds" : "The rest of the way"}
            </Eyebrow>
            <div className="text-[15px] leading-relaxed text-brand-900">
              <RichText text={continueFrom} />
            </div>
          </div>
        )}

        {/* Once the rest is out, retrying the step has nothing left to find. */}
        {!done && (
          <div className="flex flex-wrap gap-2 pt-1">
            {onRetry && err && (
              <button
                onClick={onRetry}
                disabled={busy}
                className="inline-flex h-10 items-center gap-1.5 rounded-md border border-slate-300 bg-surface px-3.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-700 active:scale-[0.98] disabled:opacity-50"
              >
                <RotateCcw size={15} strokeWidth={1.75} aria-hidden="true" />
                Try again
              </button>
            )}
            {next !== null && onReveal && (
              <button
                onClick={() => onReveal(next)}
                disabled={busy}
                className="h-10 rounded-md bg-brand-600 px-3.5 text-sm font-semibold text-white transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep disabled:opacity-50"
              >
                {next === 1 ? "Show me the fix" : "Show the rest"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
