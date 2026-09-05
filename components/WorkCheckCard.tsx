"use client";

import type { ErrorCategory, WorkCheck } from "@/lib/tutor/types";
import RichText from "@/components/RichText";

/** Human labels for each error category. */
const CATEGORY_LABEL: Record<ErrorCategory, string> = {
  conceptual: "Conceptual",
  model_selection: "Wrong model",
  setup: "Setup",
  procedural: "Procedure",
  arithmetic: "Arithmetic",
  units_notation: "Units / notation",
};

/**
 * Renders the "Check My Work" diagnosis. Significant conceptual/model errors are
 * styled prominently; trivial slips (arithmetic, units) are deliberately muted,
 * so the UI itself reflects "don't nitpick when the reasoning is right".
 */
export default function WorkCheckCard({ check }: { check: WorkCheck }) {
  const { verdict, strengths, firstError, continueFrom } = check;

  const significant = firstError?.severity === "significant";

  const accent =
    verdict === "correct"
      ? "border-emerald-200"
      : significant
        ? "border-rose-200"
        : "border-amber-200";

  return (
    <div className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${accent}`}>
      <Header verdict={verdict} />

      <div className="space-y-3 p-4">
        {/* What's right — always shown first. */}
        <div className="flex gap-2">
          <CheckIcon />
          <div className="text-sm text-slate-700">
            <RichText text={strengths} />
          </div>
        </div>

        {firstError && (
          <div
            className={
              significant
                ? "rounded-xl border border-rose-100 bg-rose-50/70 p-3"
                : "rounded-xl border border-slate-200 bg-slate-50 p-3"
            }
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                First thing to fix
              </span>
              <CategoryBadge
                category={firstError.category}
                significant={significant}
              />
              {firstError.conceptCorrect && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  concept is right
                </span>
              )}
            </div>

            <div className="mb-1 text-xs text-slate-400">
              <RichText text={`at ${firstError.location}`} />
            </div>
            <div className="text-sm text-slate-800">
              <RichText text={firstError.explanation} />
            </div>
            <div className="mt-2 border-t border-slate-200/70 pt-2 text-sm text-slate-800">
              <span className="font-semibold text-slate-900">Fix: </span>
              <span className="inline">
                <RichText text={firstError.correction} />
              </span>
            </div>
          </div>
        )}

        {/* How to continue from the corrected point. */}
        <div className="rounded-xl bg-brand-50/70 px-3 py-2">
          <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-brand-700">
            Continue from here
          </p>
          <div className="text-sm text-slate-800">
            <RichText text={continueFrom} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Header({ verdict }: { verdict: WorkCheck["verdict"] }) {
  const map = {
    correct: { label: "Looks correct", cls: "bg-emerald-50 text-emerald-800 border-emerald-100" },
    partially_correct: {
      label: "Partially correct",
      cls: "bg-amber-50 text-amber-800 border-amber-100",
    },
    error_found: { label: "One thing to fix", cls: "bg-rose-50 text-rose-800 border-rose-100" },
  } as const;
  const { label, cls } = map[verdict];
  return (
    <div className={`flex items-center gap-2 border-b px-4 py-2.5 ${cls}`}>
      <span className="text-sm font-semibold">{label}</span>
    </div>
  );
}

function CategoryBadge({
  category,
  significant,
}: {
  category: ErrorCategory;
  significant: boolean;
}) {
  const cls = significant
    ? "bg-rose-100 text-rose-700"
    : "bg-slate-200 text-slate-600";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {CATEGORY_LABEL[category]}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg
      className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-500"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.7 5.3a1 1 0 010 1.4l-7 7a1 1 0 01-1.4 0l-3-3a1 1 0 111.4-1.4l2.3 2.3 6.3-6.3a1 1 0 011.4 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}
