"use client";

import type { ChatMessage, StructuredSolution, WorkCheck } from "@/lib/tutor/types";
import RichText from "@/components/RichText";
import SolutionCard from "@/components/SolutionCard";
import WorkCheckCard from "@/components/WorkCheckCard";
import { TutorLabel } from "@/components/States";

/**
 * A single conversation turn. Tutor turns may carry an attached structured
 * solution, a "similar problem" callout, or a "Check My Work" diagnosis rendered
 * beneath the text. Student turns may carry an attached photo of their attempt.
 *
 * Tutor turns render as a full-width block under a small avatar row; student
 * turns stay right-aligned bubbles with a "You" label, so role is carried by a
 * text label rather than colour alone.
 */
export default function MessageBubble({
  message,
  solution,
  similarProblem,
  workCheck,
  attemptImage,
}: {
  message: ChatMessage;
  solution?: StructuredSolution;
  similarProblem?: string;
  workCheck?: WorkCheck;
  attemptImage?: string;
}) {
  const isStudent = message.role === "student";

  if (isStudent) {
    return (
      <div className="flex animate-rise flex-col items-end">
        <span className="mb-1 text-xs font-medium text-slate-500">You</span>
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-brand-600 px-4 py-2.5 text-[15px] leading-relaxed text-white [overflow-wrap:anywhere]">
          <RichText text={message.content} />
        </div>

        {attemptImage && (
          <div className="mt-2 flex animate-pop-in justify-end">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attemptImage}
              alt="Your attempted solution"
              className="max-h-48 rounded-md border border-hairline object-contain"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <TutorLabel />
      <div className="mt-2 max-w-none text-[16px] leading-relaxed text-ink [overflow-wrap:anywhere]">
        <RichText text={message.content} />
      </div>

      {workCheck && (
        <div className="mt-3 animate-pop-in">
          <WorkCheckCard check={workCheck} />
        </div>
      )}

      {solution && (
        <div className="mt-3 animate-pop-in">
          <SolutionCard solution={solution} />
        </div>
      )}

      {similarProblem && (
        <div className="mt-3 animate-pop-in rounded-lg border border-warn-200 bg-warn-50 px-4 py-3">
          <p className="mb-1 text-xs font-medium text-warn-700">
            Try a similar problem
          </p>
          <div className="text-[15px] leading-relaxed text-warn-800">
            <RichText text={similarProblem} />
          </div>
        </div>
      )}
    </div>
  );
}
