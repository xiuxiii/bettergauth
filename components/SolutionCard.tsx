"use client";

import type { StructuredSolution } from "@/lib/tutor/types";
import RichText from "@/components/RichText";

const SECTIONS: {
  key: keyof StructuredSolution;
  label: string;
  emphasis?: boolean;
}[] = [
  { key: "understanding", label: "Problem understanding" },
  { key: "keyConcept", label: "Key concept", emphasis: true },
  { key: "reasoning", label: "Reasoning" },
  { key: "solution", label: "Solution" },
  { key: "finalAnswer", label: "Final answer", emphasis: true },
  { key: "takeaway", label: "Important takeaway" },
];

/** The full structured solution, shown only when the student asks for it. */
export default function SolutionCard({
  solution,
}: {
  solution: StructuredSolution;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-brand-100 bg-white shadow-sm">
      <div className="border-b border-brand-100 bg-brand-50 px-4 py-2.5">
        <p className="text-sm font-semibold text-brand-800">Worked solution</p>
      </div>
      <div className="divide-y divide-slate-100">
        {SECTIONS.map(({ key, label, emphasis }) => (
          <section key={key} className="px-4 py-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              {label}
            </p>
            <div
              className={
                emphasis
                  ? "rounded-lg bg-brand-50/60 px-3 py-2 text-[15px] font-medium text-slate-900"
                  : "text-sm text-slate-700"
              }
            >
              <RichText text={solution[key]} />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
