"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PracticeAxis,
  PracticeEvaluation,
  PracticeProblem,
  ProblemAnalysis,
  RubricResult,
  StudentAttempt,
} from "@/lib/tutor/types";
import { fileToDataUrl } from "@/lib/utils";
import RichText from "@/components/RichText";
import SolutionCard from "@/components/SolutionCard";
import { ErrorState, LoadingState, Spinner } from "@/components/States";

type Phase = "generating" | "gen_error" | "solving" | "evaluating" | "done";

/**
 * Self-contained "practice one like this" widget. It generates a fresh problem
 * on the same concept, lets the student solve it INDEPENDENTLY (the solution is
 * withheld until they submit), then evaluates the attempt across five axes and
 * reveals the worked solution. AI work stays behind /api/practice/* → the
 * provider interface.
 */
export default function PracticeCard({ source }: { source: ProblemAnalysis }) {
  const [phase, setPhase] = useState<Phase>("generating");
  const [problem, setProblem] = useState<PracticeProblem | null>(null);
  const [evaluation, setEvaluation] = useState<PracticeEvaluation | null>(null);
  const [submitted, setSubmitted] = useState<StudentAttempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  const generate = useCallback(async () => {
    setPhase("generating");
    setError(null);
    try {
      const res = await fetch("/api/practice/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem: source }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "Generation failed.");
      setProblem(await res.json());
      setPhase("solving");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
      setPhase("gen_error");
    }
  }, [source]);

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
      if (!res.ok) throw new Error((await res.json())?.error ?? "Evaluation failed.");
      setEvaluation(await res.json());
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Evaluation failed.");
      setPhase("solving"); // let them retry the submission
    }
  }

  return (
    <div className="animate-rise overflow-hidden rounded-2xl border border-indigo-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-indigo-100 bg-indigo-50 px-4 py-2.5">
        <SparkIcon />
        <span className="text-sm font-semibold text-indigo-800">
          Practice — one like this
        </span>
        {problem && (
          <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-xs font-medium text-indigo-700">
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
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Your problem
            </p>
            <div className="text-sm text-slate-800">
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
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
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
        className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
      />

      {image ? (
        <div className="mt-2 flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="Your work" className="h-12 w-12 rounded object-cover" />
          <span className="flex-1 text-sm text-slate-600">Photo attached</span>
          <button
            onClick={() => setImage(null)}
            className="rounded px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            Remove
          </button>
        </div>
      ) : (
        <button
          onClick={() => fileRef.current?.click()}
          className="mt-2 text-sm font-medium text-brand-700 hover:underline"
        >
          + Attach a photo of your work
        </button>
      )}

      {readError && <p className="mt-2 text-sm text-rose-600">{readError}</p>}
      {error && <p className="mt-2 text-sm text-rose-600">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => onSubmit({ text: text.trim() || undefined, imageDataUrl: image ?? undefined })}
          disabled={!canSubmit}
          className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          Submit for feedback
        </button>
        <button
          onClick={() => onSubmit({})}
          className="rounded-xl px-3 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100"
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
  correct: { label: "Correct", cls: "bg-emerald-50 text-emerald-800 border-emerald-100" },
  partially_correct: { label: "Almost there", cls: "bg-amber-50 text-amber-800 border-amber-100" },
  incorrect: { label: "Let's regroup", cls: "bg-rose-50 text-rose-800 border-rose-100" },
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
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Your answer
          </p>
          {attempt.text && (
            <div className="text-sm text-slate-800">
              <RichText text={attempt.text} />
            </div>
          )}
          {attempt.imageDataUrl && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={attempt.imageDataUrl}
              alt="Your work"
              className="mt-2 max-h-40 rounded-lg border border-slate-200 object-contain"
            />
          )}
        </div>
      )}

      {!revealed && (
        <>
          <span
            className={`inline-block rounded-full border px-3 py-1 text-sm font-semibold ${verdict.cls}`}
          >
            {verdict.label}
          </span>

          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {evaluation.rubric.map((r) => (
              <RubricRow key={r.axis} result={r} />
            ))}
          </ul>
        </>
      )}

      {/* The single most important issue. */}
      <div className="rounded-xl bg-brand-50/70 px-3 py-2.5">
        <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-brand-700">
          {revealed ? "Worked solution" : "Focus on this"}
        </p>
        <div className="text-sm text-slate-800">
          <RichText text={evaluation.focus} />
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Solution
        </p>
        <SolutionCard solution={evaluation.solution} />
      </div>
    </div>
  );
}

function RubricRow({ result }: { result: RubricResult }) {
  return (
    <li className="flex items-start gap-2.5 px-3 py-2">
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
  const map = {
    correct: { cls: "bg-emerald-500", ch: "✓" },
    minor_issue: { cls: "bg-amber-500", ch: "!" },
    incorrect: { cls: "bg-rose-500", ch: "✕" },
    not_shown: { cls: "bg-slate-300", ch: "–" },
  } as const;
  const { cls, ch } = map[status];
  return (
    <span
      className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${cls}`}
      aria-hidden="true"
    >
      {ch}
    </span>
  );
}

function SparkIcon() {
  return (
    <svg className="h-4 w-4 text-indigo-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 1l1.8 5.2L17 8l-5.2 1.8L10 15l-1.8-5.2L3 8l5.2-1.8L10 1z" />
    </svg>
  );
}
