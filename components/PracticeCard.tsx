"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PracticeAxis,
  PracticeEvaluation,
  PracticeFocus,
  PracticeProblem,
  ProblemAnalysis,
  RubricResult,
  StudentAttempt,
} from "@/lib/tutor/types";
import { practiceResolved } from "@/lib/tutor/types";
import { fileToDataUrl } from "@/lib/utils";
import { readApiError } from "@/lib/apiClient";
import RichText from "@/components/RichText";
import SolutionCard from "@/components/SolutionCard";
import { CircleAlert, CircleCheck, CircleX, Sparkles } from "lucide-react";
import { ErrorState, Eyebrow, LoadingState } from "@/components/States";

type Phase = "generating" | "gen_error" | "solving" | "evaluating" | "done";

/**
 * Self-contained "practice one like this" widget. It generates a fresh problem
 * on the same concept, lets the student solve it INDEPENDENTLY (the solution is
 * withheld until they submit), then evaluates the attempt across five axes and
 * reveals the worked solution. AI work stays behind /api/practice/* → the
 * provider interface.
 */
export default function PracticeCard({
  source,
  focus,
  onResolved,
}: {
  source: ProblemAnalysis;
  /** When set, this is a targeted retry of a recurring misconception. */
  focus?: PracticeFocus;
  /** Called after a genuine attempt to a targeted retry, with the outcome. */
  onResolved?: (concept: string, resolved: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("generating");
  const [problem, setProblem] = useState<PracticeProblem | null>(null);
  const [evaluation, setEvaluation] = useState<PracticeEvaluation | null>(null);
  const [submitted, setSubmitted] = useState<StudentAttempt | null>(null);
  const [resolved, setResolved] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const generate = useCallback(async () => {
    setPhase("generating");
    setError(null);
    try {
      const res = await fetch("/api/practice/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem: source, focus }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Generation failed."));
      setProblem(await res.json());
      setPhase("solving");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
      setPhase("gen_error");
    }
  }, [source, focus]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void generate();
  }, [generate]);

  async function submit(attempt: StudentAttempt) {
    if (!problem) return;
    setSubmitted(attempt);
    setPhase("evaluating");
    setError(null);
    try {
      const res = await fetch("/api/practice/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ practice: problem, attempt }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Evaluation failed."));
      const evaluation: PracticeEvaluation = await res.json();
      setEvaluation(evaluation);
      setPhase("done");
      // Retry→verify: only a genuine attempt on a targeted retry reports back.
      if (focus && (attempt.text || attempt.imageDataUrl)) {
        const ok = practiceResolved(evaluation);
        setResolved(ok);
        onResolved?.(focus.concept, ok);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed.");
      setPhase("solving"); // let them retry the submission
    }
  }

  return (
    <div className="animate-rise overflow-hidden rounded-lg border border-brand-200 bg-surface">
      <div className="flex items-center gap-2 border-b border-brand-100 bg-brand-50 px-4 py-2.5">
        <Sparkles size={16} strokeWidth={1.75} className="text-brand-500" aria-hidden="true" />
        <span className="text-sm font-semibold text-brand-800">
          {focus ? "Retry — clear the gap" : "Practice — one like this"}
        </span>
        {problem && (
          <span className="ml-auto rounded-full bg-surface px-2 py-0.5 text-xs font-medium text-brand-700">
            {problem.difficulty === "slightly_harder" ? "a notch harder" : "same level"}
          </span>
        )}
      </div>

      <div className="space-y-3 p-4">
        {phase === "generating" && (
          <LoadingState label="Generating a fresh problem on the same concept…" />
        )}

        {phase === "gen_error" && (
          <ErrorState message={error ?? "Could not generate."} onRetry={generate} />
        )}

        {problem && phase !== "generating" && phase !== "gen_error" && (
          <div>
            <Eyebrow className="mb-1">Your problem</Eyebrow>
            <div className="text-[15px] leading-relaxed text-ink">
              <RichText text={problem.problemText} />
            </div>
          </div>
        )}

        {phase === "solving" && (
          <SolveArea onSubmit={submit} error={error} />
        )}

        {phase === "evaluating" && (
          <LoadingState label="Checking your work across the five axes…" />
        )}

        {phase === "done" && focus && resolved !== null && (
          <div
            className={
              resolved
                ? "rounded-sm bg-success-50 px-3 py-2 text-sm font-medium text-success-800"
                : "rounded-sm bg-warn-50 px-3 py-2 text-sm font-medium text-warn-800"
            }
          >
            {resolved
              ? "Nice — that concept looks locked in now. Cleared it from your recurring gaps."
              : "Still shaky on this one — worth another pass before moving on."}
          </div>
        )}

        {phase === "done" && evaluation && (
          <Evaluated attempt={submitted} evaluation={evaluation} />
        )}
      </div>
    </div>
  );
}

/** The independent-solve input: type and/or attach a photo, then submit. */
function SolveArea({
  onSubmit,
  error,
}: {
  onSubmit: (attempt: StudentAttempt) => void;
  error: string | null;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setReadError("Please choose an image of your work.");
      return;
    }
    setReadError(null);
    try {
      setImage(await fileToDataUrl(file));
    } catch {
      setReadError("Could not read that image.");
    }
  }

  const canSubmit = text.trim().length > 0 || !!image;

  return (
    <div className="rounded-sm bg-slate-100 p-3">
      <p className="mb-2 text-sm font-medium text-slate-700">
        Solve it yourself first, then submit for feedback.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Show your working and final answer…"
        className="w-full resize-none rounded-md border border-slate-300 bg-surface px-3.5 py-2.5 text-base leading-6 text-ink outline-none transition placeholder:text-slate-400 focus:border-slate-300"
      />

      {image ? (
        <div className="mt-2 flex items-center gap-3 rounded-sm bg-surface p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="Your work" className="h-12 w-12 rounded-sm object-cover" />
          <span className="flex-1 text-sm text-slate-600">Photo attached</span>
          <button
            onClick={() => setImage(null)}
            className="h-10 rounded-md px-3 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-ink"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          className="mt-1 inline-flex h-9 items-center rounded-md text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
        >
          + Attach a photo of your work
        </button>
      )}

      {readError && <p className="mt-2 text-sm text-danger-600">{readError}</p>}
      {error && <p className="mt-2 text-sm text-danger-600">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => onSubmit({ text: text.trim() || undefined, imageDataUrl: image ?? undefined })}
          disabled={!canSubmit}
          className="h-11 flex-1 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-brand-700 active:scale-[0.98] active:bg-brand-700 disabled:bg-brand-300 disabled:text-white/90"
        >
          Submit for feedback
        </button>
        <button
          onClick={() => onSubmit({})}
          className="h-10 rounded-md px-3 text-sm font-medium text-slate-500 transition hover:bg-slate-200 hover:text-ink"
        >
          Show solution
        </button>
      </div>
    </div>
  );
}

const AXIS_LABEL: Record<PracticeAxis, string> = {
  concept_selection: "Concept selection",
  reasoning: "Reasoning",
  setup: "Setup",
  execution: "Execution",
  final_answer: "Final answer",
};

const VERDICT = {
  correct: { label: "Correct", cls: "bg-success-50 text-success-800" },
  partially_correct: { label: "Almost there", cls: "bg-warn-50 text-warn-800" },
  incorrect: { label: "Let's regroup", cls: "bg-danger-50 text-danger-800" },
} as const;

/** The evaluation view: student attempt, rubric, focused feedback, solution. */
function Evaluated({
  attempt,
  evaluation,
}: {
  attempt: StudentAttempt | null;
  evaluation: PracticeEvaluation;
}) {
  const revealed = evaluation.rubric.every((r) => r.status === "not_shown");
  const verdict = VERDICT[evaluation.verdict];

  return (
    <div className="space-y-3">
      {attempt && (attempt.text || attempt.imageDataUrl) && (
        <div className="rounded-sm bg-slate-100 p-3">
          <p className="mb-1 text-xs font-medium text-slate-500">Your answer</p>
          {attempt.text && (
            <div className="text-[15px] leading-relaxed text-ink">
              <RichText text={attempt.text} />
            </div>
          )}
          {attempt.imageDataUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={attempt.imageDataUrl}
              alt="Your work"
              className="mt-2 max-h-40 rounded-sm object-contain"
            />
          )}
        </div>
      )}

      {!revealed && (
        <>
          <span
            className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${verdict.cls}`}
          >
            {verdict.label}
          </span>

          <ul className="divide-y divide-hairline">
            {evaluation.rubric.map((r) => (
              <RubricRow key={r.axis} result={r} />
            ))}
          </ul>
        </>
      )}

      {/* The single most important issue. */}
      <div className="rounded-sm bg-brand-50 px-3 py-2.5">
        <Eyebrow className="mb-0.5 !text-brand-700">
          {revealed ? "Worked solution" : "Focus on this"}
        </Eyebrow>
        <div className="text-[15px] leading-relaxed text-brand-900">
          <RichText text={evaluation.focus} />
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-slate-500">Solution</p>
        <SolutionCard solution={evaluation.solution} />
      </div>
    </div>
  );
}

function RubricRow({ result }: { result: RubricResult }) {
  return (
    <li className="flex items-start gap-2.5 py-2.5">
      <StatusDot status={result.status} />
      <div className="min-w-0">
        <span className="text-sm font-medium text-slate-800">
          {AXIS_LABEL[result.axis]}
        </span>
        {result.note && (
          <div className="text-xs text-slate-500">
            <RichText text={result.note} />
          </div>
        )}
      </div>
    </li>
  );
}

function StatusDot({ status }: { status: RubricResult["status"] }) {
  const common = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
  const cls = "mt-0.5 flex-shrink-0";
  switch (status) {
    case "correct":
      return <CircleCheck {...common} className={`${cls} text-success-600`} />;
    case "minor_issue":
      return <CircleAlert {...common} className={`${cls} text-warn-600`} />;
    case "incorrect":
      return <CircleX {...common} className={`${cls} text-danger-600`} />;
    default:
      return (
        <span
          className={`${cls} mt-1.5 h-2 w-2 rounded-full bg-slate-300`}
          aria-hidden="true"
        />
      );
  }
}
