"use client";

import type { ProblemAnalysis } from "@/lib/tutor/types";
import RichText from "@/components/RichText";

/** Shows the uploaded image, the detected problem, and detected subject/topic. */
export default function ProblemCard({
  image,
  analysis,
}: {
  image: string;
  analysis: ProblemAnalysis;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt="Uploaded problem"
        className="max-h-56 w-full bg-slate-100 object-contain"
      />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
            {analysis.subject}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            {analysis.topic}
          </span>
          <span className="ml-auto text-xs text-slate-400">
            {Math.round(analysis.confidence * 100)}% match
          </span>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Detected problem
          </p>
          <div className="text-sm text-slate-800">
            <RichText text={analysis.problemText} />
          </div>
        </div>
      </div>
    </div>
  );
}
