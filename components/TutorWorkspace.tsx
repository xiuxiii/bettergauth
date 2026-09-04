"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  ChatMessage,
  ProblemAnalysis,
  StructuredSolution,
  TutorAction,
  TutorTurn,
} from "@/lib/tutor/types";
import { IMAGE_KEY, uid } from "@/lib/utils";
import ProblemCard from "@/components/ProblemCard";
import MessageBubble from "@/components/MessageBubble";
import ActionBar from "@/components/ActionBar";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";

/** A chat message plus any structured payloads attached to a tutor turn. */
type DisplayMessage = ChatMessage & {
  solution?: StructuredSolution;
  similarProblem?: string;
};

type Phase = "loading" | "ready" | "error" | "empty";

export default function TutorWorkspace() {
  const router = useRouter();
  const [image, setImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ProblemAnalysis | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [turnBusy, setTurnBusy] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the captured image and analyze it.
  const runAnalysis = useCallback(async (dataUrl: string) => {
    setPhase("loading");
    setAnalyzeError(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "Analysis failed.");
      const data: ProblemAnalysis = await res.json();
      setAnalysis(data);
      setPhase("ready");
      // Seed the session with a concept-level opener.
      void requestTurn("ask", data, []);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Analysis failed.");
      setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const stored =
      typeof window !== "undefined" ? sessionStorage.getItem(IMAGE_KEY) : null;
    if (!stored) {
      setPhase("empty");
      return;
    }
    setImage(stored);
    void runAnalysis(stored);
  }, [runAnalysis]);

  // Keep the newest message in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, turnBusy]);

  const toHistory = (msgs: DisplayMessage[]): ChatMessage[] =>
    msgs.map(({ id, role, content, createdAt }) => ({
      id,
      role,
      content,
      createdAt,
    }));

  async function requestTurn(
    action: TutorAction,
    problem: ProblemAnalysis,
    history: DisplayMessage[],
    studentText?: string,
  ) {
    setTurnBusy(true);
    setTurnError(null);
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problem,
          history: toHistory(history),
          action,
          studentText,
        }),
      });
      if (!res.ok) throw new Error((await res.json())?.error ?? "Tutor failed.");
      const turn: TutorTurn = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          id: uid("t"),
          role: "tutor",
          content: turn.message,
          createdAt: Date.now(),
          solution: turn.solution,
          similarProblem: turn.similarProblem,
        },
      ]);
    } catch (err) {
      setTurnError(err instanceof Error ? err.message : "Tutor failed.");
    } finally {
      setTurnBusy(false);
    }
  }

  function handleAction(action: Exclude<TutorAction, "ask">) {
    if (!analysis || turnBusy) return;
    void requestTurn(action, analysis, messages);
  }

  function handleAsk(text: string) {
    if (!analysis || turnBusy) return;
    const student: DisplayMessage = {
      id: uid("s"),
      role: "student",
      content: text,
      createdAt: Date.now(),
    };
    const next = [...messages, student];
    setMessages(next);
    void requestTurn("ask", analysis, next, text);
  }

  // ---- Render ----

  if (phase === "empty") {
    return (
      <CenteredShell>
        <EmptyState
          title="No problem to tutor yet"
          hint="Head back and take or upload a photo of a problem to get started."
        />
        <Link
          href="/"
          className="mt-4 inline-block rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Go to home
        </Link>
      </CenteredShell>
    );
  }

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col bg-slate-50">
      <TopBar onBack={() => router.push("/")} topic={analysis?.topic} />

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {phase === "loading" && !analysis && (
          <LoadingState label="Reading your problem…" />
        )}

        {phase === "error" && (
          <ErrorState
            message={analyzeError ?? "Could not analyze the problem."}
            onRetry={() => image && runAnalysis(image)}
          />
        )}

        {image && analysis && (
          <ProblemCard image={image} analysis={analysis} />
        )}

        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            solution={m.solution}
            similarProblem={m.similarProblem}
          />
        ))}

        {turnBusy && <LoadingState label="Tutor is thinking…" />}

        {turnError && (
          <ErrorState
            message={turnError}
            onRetry={() =>
              analysis && requestTurn("ask", analysis, messages)
            }
          />
        )}
      </div>

      {analysis && (
        <ActionBar busy={turnBusy} onAction={handleAction} onAsk={handleAsk} />
      )}
    </div>
  );
}

function TopBar({
  onBack,
  topic,
}: {
  onBack: () => void;
  topic?: string;
}) {
  return (
    <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-3 py-3">
      <button
        onClick={onBack}
        aria-label="Back"
        className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 6l-6 6 6 6" />
        </svg>
      </button>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-900">Tutoring session</p>
        {topic && <p className="truncate text-xs text-slate-500">{topic}</p>}
      </div>
    </header>
  );
}

function CenteredShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      {children}
    </main>
  );
}
