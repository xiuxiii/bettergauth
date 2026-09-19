"use client";

import { CircleAlert } from "lucide-react";
import type { ProblemAnalysis } from "@/lib/tutor/types";
import RichText from "@/components/RichText";
import { Eyebrow } from "@/components/States";

/** Shows the uploaded image, the detected problem, and detected subject/topic. */
export default function ProblemCard({
  image,
  analysis,
}: {
  image: string;
  analysis: ProblemAnalysis;
}) {
  const lowConfidence = analysis.confidence < 0.7;

  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-surface">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt="Uploaded problem"
        className="max-h-56 w-full bg-slate-100 object-contain max-md:max-h-48"
      />
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
            {analysis.subject}
          </span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            {analysis.topic}
          </span>
          {lowConfidence && (
            <div className="max-md:basis-full max-md:ml-0">
              <span className="inline-flex items-center gap-1 rounded-full bg-warn-50 px-2.5 py-1 text-xs font-medium text-warn-700">
                <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
                Low confidence — check the text below
              </span>
            </div>
          )}
        </div>
        <div>
          <Eyebrow className="mb-1">Detected problem</Eyebrow>
          <div className="text-[15px] leading-relaxed text-ink">
            <RichText text={analysis.problemText} />
          </div>
        </div>
        {analysis.concept && (
          <div>
            <Eyebrow className="mb-1">Key concept</Eyebrow>
            <div className="font-serif text-lg leading-snug text-ink">
              <RichText text={analysis.concept} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
