"use client";

import type { ChatMessage, StructuredSolution } from "@/lib/tutor/types";
import RichText from "@/components/RichText";
import SolutionCard from "@/components/SolutionCard";

/**
 * A single conversation turn. Tutor turns may carry an attached structured
 * solution or a "similar problem" callout rendered beneath the text.
 */
export default function MessageBubble({
  message,
  solution,
  similarProblem,
}: {
  message: ChatMessage;
  solution?: StructuredSolution;
  similarProblem?: string;
}) {
  const isStudent = message.role === "student";

  return (
    <div
      className={`flex animate-rise ${isStudent ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[92%] ${isStudent ? "items-end" : "items-start"}`}>
        <div
          className={
            isStudent
              ? "rounded-2xl rounded-br-md bg-brand-600 px-4 py-2.5 text-sm text-white shadow-sm"
              : "rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 shadow-sm"
          }
        >
          <RichText text={message.content} />
        </div>

        {solution && (
          <div className="mt-2">
            <SolutionCard solution={solution} />
          </div>
        )}

        {similarProblem && (
          <div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">
              Try a similar problem
            </p>
            <div className="text-sm text-amber-900">
              <RichText text={similarProblem} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
