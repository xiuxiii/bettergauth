"use client";

import type { StructuredSolution } from "@/lib/tutor/types";
import RichText from "@/components/RichText";
import { Eyebrow } from "@/components/States";

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
    <div className="overflow-hidden rounded-lg border border-brand-100 bg-surface">
      <div className="border-b border-brand-100 bg-brand-50 px-4 py-2.5">
        <Eyebrow className="!text-brand-800">Worked solution</Eyebrow>
      </div>
      <div className="divide-y divide-hairline">
        {SECTIONS.map(({ key, label, emphasis }) => (
          <section key={key} className="px-4 py-4">
            <p className="mb-1 text-xs font-medium text-slate-500">{label}</p>
            <div
              className={
                emphasis
                  ? "rounded-sm bg-brand-50 px-3 py-2 text-[15px] font-medium leading-relaxed text-ink"
                  : "text-[15px] leading-relaxed text-slate-700"
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
