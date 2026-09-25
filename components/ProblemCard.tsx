"use client";

import { useState } from "react";
import { ChevronDown, CircleAlert, PenLine } from "lucide-react";
import type { ProblemAnalysis } from "@/lib/tutor/types";
import RichText, { InlineRichText } from "@/components/RichText";
import { Eyebrow } from "@/components/States";

/**
 * Shows the uploaded image, the detected problem, its subject and a safe label
 * for the idea area.
 *
 * The label is written to give nothing away. The key idea, which does, only
 * appears once the gap is closed or a solution was shown: it used to sit here
 * from the start as "Key concept", naming the student's exact mistake before
 * any tutoring.
 */
export default function ProblemCard({
  image,
  analysis,
  showKeyIdea = false,
}: {
  /** Absent for a problem that was typed, or a saved one whose photo is gone. */
  image?: string | null;
  analysis: ProblemAnalysis;
  showKeyIdea?: boolean;
}) {
  const lowConfidence = analysis.confidence < 0.7;

  // The photo above IS the problem, and the model gets the transcription on
  // every request regardless — so re-printing it here is for the student's
  // benefit only, and costs a screen of text they've already read. Keep it one
  // tap away instead. Open by default when detection was shaky, since that's
  // exactly when it's worth checking what was actually read.
  const [showText, setShowText] = useState(lowConfidence);

  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-surface">
      {image && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt="Uploaded problem"
            className="max-h-56 w-full bg-slate-100 object-contain max-md:max-h-48"
          />
        </>
      )}
      <div className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700">
            {analysis.subject}
          </span>
          {(analysis.concept || analysis.topic) && (
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
              <InlineRichText text={analysis.concept || analysis.topic} />
            </span>
          )}
          {analysis.studentWork?.present && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success-50 px-2.5 py-1 text-xs font-medium text-success-700">
              <PenLine size={14} strokeWidth={1.75} aria-hidden="true" />
              Your working detected
            </span>
          )}
          {lowConfidence && (
            <div className="max-md:basis-full max-md:ml-0">
              <span className="inline-flex items-center gap-1 rounded-full bg-warn-50 px-2.5 py-1 text-xs font-medium text-warn-700">
                <CircleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
                Low confidence — check the text below
              </span>
            </div>
          )}
        </div>

        {showKeyIdea && analysis.keyIdea?.trim() && (
          <div className="animate-fade-in">
            <Eyebrow className="mb-1">Key idea</Eyebrow>
            <div className="font-serif text-lg leading-snug text-ink">
              <RichText text={analysis.keyIdea} />
            </div>
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => setShowText((v) => !v)}
            aria-expanded={showText}
            aria-controls="detected-problem-text"
            className="-mx-1.5 flex items-center gap-1.5 rounded-sm px-1.5 py-1 transition-colors hover:bg-slate-100 active:scale-[0.99]"
          >
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
              {showText ? "Hide detected text" : "Show detected text"}
            </span>
            <ChevronDown
              size={14}
              strokeWidth={2.25}
              aria-hidden="true"
              className={`text-slate-500 transition-transform duration-200 ${
                showText ? "rotate-180" : ""
              }`}
            />
          </button>
          {showText && (
            <div
              id="detected-problem-text"
              className="mt-1.5 animate-fade-in text-[15px] leading-relaxed text-ink"
            >
              <RichText text={analysis.problemText} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
