"use client";

import { Check } from "lucide-react";
import type { ErrorCategory, WorkCheck } from "@/lib/tutor/types";
import RichText from "@/components/RichText";
import { Eyebrow } from "@/components/States";

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
      ? "border-success-200"
      : significant
        ? "border-danger-200"
        : "border-warn-200";

  return (
    <div className={`overflow-hidden rounded-lg border bg-surface ${accent}`}>
      <Header verdict={verdict} />

      <div className="space-y-3 p-4">
        {/* What's right — always shown first. */}
        <div className="flex gap-2">
          <Check
            size={18}
            strokeWidth={1.75}
            className="mt-0.5 flex-shrink-0 text-success-600"
            aria-hidden="true"
          />
          <div className="text-[15px] leading-relaxed text-slate-700">
            <RichText text={strengths} />
          </div>
        </div>

        {firstError && (
          <div
            className={
              significant
                ? "rounded-sm bg-danger-50 p-3"
                : "rounded-sm bg-slate-100 p-3"
            }
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <Eyebrow>First thing to fix</Eyebrow>
              <CategoryBadge
                category={firstError.category}
                significant={significant}
              />
              {firstError.conceptCorrect && (
                <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700">
                  concept is right
                </span>
              )}
            </div>

            <div className="mb-1 text-xs text-slate-500">
              <RichText text={`at ${firstError.location}`} />
            </div>
            <div className="text-[15px] leading-relaxed text-ink">
              <RichText text={firstError.explanation} />
            </div>
            <div className="mt-2 border-t border-hairline pt-2 text-[15px] leading-relaxed text-ink">
              <span className="font-semibold">Fix: </span>
              <span className="inline">
                <RichText text={firstError.correction} />
              </span>
            </div>
          </div>
        )}

        {/* How to continue from the corrected point. */}
        <div className="rounded-sm bg-brand-50 px-3 py-2">
          <Eyebrow className="mb-0.5 !text-brand-700">Continue from here</Eyebrow>
          <div className="text-[15px] leading-relaxed text-ink">
            <RichText text={continueFrom} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Header({ verdict }: { verdict: WorkCheck["verdict"] }) {
  const map = {
    correct: { label: "Looks correct", cls: "bg-success-50 text-success-800 border-success-100" },
    partially_correct: {
      label: "Partially correct",
      cls: "bg-warn-50 text-warn-800 border-warn-100",
    },
    error_found: { label: "One thing to fix", cls: "bg-danger-50 text-danger-800 border-danger-100" },
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
    ? "bg-danger-100 text-danger-700"
    : "bg-slate-200 text-slate-600";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {CATEGORY_LABEL[category]}
    </span>
  );
}
