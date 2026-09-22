"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronLeft, Settings2 } from "lucide-react";
import type {
  ChatMessage,
  PracticeFocus,
  ProblemAnalysis,
  RecurringGap,
  SessionMemory,
  StructuredSolution,
  StudentAttempt,
  TutorAction,
  TutorPreferences,
  TutorTurn,
  WorkCheck,
} from "@/lib/tutor/types";
import {
  applyWorkCheckToMemory,
  detectRecurring,
  emptySessionMemory,
  recordConceptError,
  resolveMisconception,
} from "@/lib/tutor/types";
import { IMAGE_KEY, uid } from "@/lib/utils";
import { safePrefix } from "@/lib/tutor/streamText";
import { readApiError, readNdjson } from "@/lib/apiClient";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
} from "@/lib/preferences";
import ProblemCard from "@/components/ProblemCard";
import MessageBubble from "@/components/MessageBubble";
import ActionBar from "@/components/ActionBar";
import AttemptComposer from "@/components/AttemptComposer";
import PracticeCard from "@/components/PracticeCard";
import SessionToggles from "@/components/SessionToggles";
import RecurringBanner from "@/components/RecurringBanner";
import Wordmark from "@/components/Wordmark";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  OpeningNudge,
  ProblemCardSkeleton,
} from "@/components/States";

/** A chat message plus any structured payloads attached to a turn. */
type DisplayMessage = ChatMessage & {
  solution?: StructuredSolution;
  similarProblem?: string;
  /** Attached to a tutor turn produced by "Check My Work". */
  workCheck?: WorkCheck;
  /** Attached to a student turn: a photo of their attempt. */
  attemptImage?: string;
  /** The tutor stopped after one piece and more remains → offer "Continue". */
  hasMore?: boolean;
  /**
   * When set, this entry renders a self-contained practice widget (generate →
   * solve → evaluate) seeded from the given source problem, instead of a bubble.
   */
  practiceFor?: ProblemAnalysis;
  /** When set, the practice widget is a targeted retry of this misconception. */
  practiceFocus?: PracticeFocus;
  /** The session's opening nudge, rendered quieter than a real tutor turn. */
  opener?: boolean;
  /** A student turn that is only a photo: `content` is for the model, not the UI. */
  imageOnly?: boolean;
};

/** One NDJSON frame from the streaming /api/tutor response. */
type TutorStreamFrame =
  | { t: "delta"; v: string }
  | { t: "done"; turn: TutorTurn }
  | { t: "error"; message: string };

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
  // Id of the message currently streaming in, or null. Distinct from turnBusy:
  // controls stay locked until the turn completes, but the "thinking" dots give
  // way as soon as there is real text to read.
  const [streamingId, setStreamingId] = useState<string | null>(null);
  // What "Try again" should re-run. Set by whichever request failed, so a
  // failed work-check retries the work-check (image and all) instead of
  // silently falling back to a plain "ask" — which succeeded and made the
  // failure look intermittent while quietly never checking the student's work.
  const retryRef = useRef<(() => void) | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<"check" | "why">("why");
  const [prefs, setPrefs] = useState<TutorPreferences>(DEFAULT_PREFERENCES);

  function openComposer(mode: "check" | "why") {
    setComposerMode(mode);
    setComposerOpen(true);
  }

  // Load saved preferences (client-only) so tutor turns can carry them.
  useEffect(() => {
    setPrefs(loadPreferences() ?? DEFAULT_PREFERENCES);
  }, []);

  function updatePrefs(next: TutorPreferences) {
    setPrefs(next);
    savePreferences(next);
  }

  // The tutor's cross-turn memory: round-tripped through /api/tutor so the
  // tutor adapts, avoids re-teaching, and catches recurring misconceptions.
  const memoryRef = useRef<SessionMemory>(emptySessionMemory());
  // A recurring conceptual gap to surface, and the last one dismissed (by
  // concept + count, so it re-surfaces if the same gap keeps growing).
  const [recurring, setRecurring] = useState<RecurringGap | null>(null);
  const [dismissed, setDismissed] = useState<{
    concept: string;
    count: number;
  } | null>(null);

  const showRecurring =
    recurring !== null &&
    (dismissed === null ||
      dismissed.concept !== recurring.concept ||
      recurring.count > dismissed.count);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Ensures the initial auto-analysis fires exactly once, so a double effect
  // invocation (StrictMode / Fast Refresh) can never append a duplicate opener.
  // Manual retries call runAnalysis directly and are unaffected.
  const startedRef = useRef(false);

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
      if (!res.ok) throw new Error(await readApiError(res, "Analysis failed."));
      const data: ProblemAnalysis = await res.json();
      setAnalysis(data);
      setPhase("ready");

      // The photo already shows their attempt: diagnose it instead of asking
      // them to start. No student turn is posted — the card directly above is
      // already showing the photo with the working in it, and the diagnosis
      // reads that same photo. Everything downstream (memory, recurring gaps,
      // retry) behaves as if they had submitted it themselves.
      if (data.studentWork?.present) {
        setMessages([]);
        void sendCheckWork({ imageDataUrl: dataUrl }, data);
        return;
      }

      // Open with an actual hint, not instructions. It comes back on the
      // analysis call, so it costs no extra request and no extra wait — the
      // student lands on something useful having pressed nothing. Falls back to
      // a plain nudge if the model returns an empty hint.
      setMessages([
        {
          id: uid("t"),
          role: "tutor",
          content:
            data.openingHint?.trim() ||
            "Start wherever you can and show me what you get.",
          createdAt: Date.now(),
          opener: true,
        },
      ]);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Analysis failed.");
      setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const stored =
      typeof window !== "undefined" ? sessionStorage.getItem(IMAGE_KEY) : null;
    if (!stored) {
      setPhase("empty");
      return;
    }
    setImage(stored);
    void runAnalysis(stored);
  }, [runAnalysis]);

  // Whether the student is parked at the bottom. Tracked from their own
  // scrolling rather than measured after a render, because by then the new
  // content has already changed the distance.
  const pinnedRef = useRef(true);
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  // Keep the newest message in view — but only if they haven't scrolled up.
  // While streaming this fires constantly; yanking the view back down while
  // they are re-reading an earlier line would be worse than not following.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTo({
      top: el.scrollHeight,
      // Queued smooth scrolls fight each other at streaming frequency.
      behavior: streamingId ? "auto" : "smooth",
    });
  }, [messages, turnBusy, streamingId]);

  // Keyboard follow (visual only): when the composer gains focus, and again
  // once the on-screen keyboard has finished resizing the visual viewport,
  // pin the newest message above the input so it is never hidden.
  const scrollToBottom = useCallback(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    vv.addEventListener("resize", scrollToBottom);
    return () => vv.removeEventListener("resize", scrollToBottom);
  }, [scrollToBottom]);

  const toHistory = (msgs: DisplayMessage[]): ChatMessage[] =>
    msgs
      // A practice widget occupies a message slot with empty content, and the
      // API rejects a message whose content is "" — so a tutor turn taken after
      // one would 400. It carries no conversational text anyway.
      .filter((m) => m.content.trim().length > 0)
      .map(({ id, role, content, createdAt }) => ({
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
    retryRef.current = null;
    try {
      const res = await fetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problem,
          history: toHistory(history),
          action,
          studentText,
          preferences: prefs,
          memory: memoryRef.current,
        }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Tutor failed."));

      const id = uid("t");

      /** Create the tutor message on first paint, then update it in place. */
      const put = (patch: Partial<DisplayMessage> & { content: string }) =>
        setMessages((prev) => {
          const i = prev.findIndex((m) => m.id === id);
          if (i === -1) {
            return [
              ...prev,
              { id, role: "tutor", createdAt: Date.now(), ...patch },
            ];
          }
          const next = prev.slice();
          next[i] = { ...next[i], ...patch };
          return next;
        });

      const finish = (turn: TutorTurn) => {
        if (turn.memory) {
          memoryRef.current = turn.memory;
          setRecurring(detectRecurring(turn.memory));
        }
        put({
          content: turn.message,
          solution: turn.solution,
          similarProblem: turn.similarProblem,
          hasMore: turn.hasMore,
        });
      };

      // show_solution / similar_problem still answer with one JSON body.
      if (!res.headers.get("content-type")?.includes("ndjson")) {
        finish((await res.json()) as TutorTurn);
        return;
      }

      let shown = "";
      let painted = 0;
      // RichText re-parses and re-renders every KaTeX segment on each change, so
      // painting per token would be hundreds of full re-renders on a phone.
      const paint = () => {
        const safe = safePrefix(shown);
        if (!safe) return;
        painted = Date.now();
        setStreamingId(id);
        put({ content: safe });
      };

      let completed = false;
      for await (const frame of readNdjson<TutorStreamFrame>(res)) {
        if (frame.t === "delta") {
          shown += frame.v;
          if (Date.now() - painted >= 60) paint();
        } else if (frame.t === "done") {
          completed = true;
          finish(frame.turn);
        } else if (frame.t === "error") {
          throw new Error(frame.message);
        }
      }
      // A dropped connection ends the loop without a `done` frame. Whatever was
      // painted is a partial answer, so say so rather than letting it sit there
      // looking finished.
      if (!completed) {
        throw new Error("The tutor's answer was cut off. Please try again.");
      }
    } catch (err) {
      retryRef.current = () =>
        void requestTurn(action, problem, history, studentText);
      setTurnError(err instanceof Error ? err.message : "Tutor failed.");
    } finally {
      setStreamingId(null);
      setTurnBusy(false);
    }
  }

  function handleAction(action: Exclude<TutorAction, "ask">) {
    if (!analysis || turnBusy) return;
    void requestTurn(action, analysis, messages);
  }

  function handleContinue() {
    if (!analysis || turnBusy) return;
    void requestTurn("continue", analysis, messages);
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

  function handleCheckWork(attempt: StudentAttempt) {
    if (!analysis || turnBusy) return;
    setComposerOpen(false);

    // Show the student's attempt in the conversation. Posting it is a separate
    // step so a retry re-sends the attempt without echoing their bubble again.
    //
    // When they only sent a photo, the content line exists so later tutor turns
    // still see that an attempt was made at this point in the conversation, but
    // it is not rendered: putting a chirpy sentence in their bubble that they
    // never typed reads as the app speaking for them.
    const typed = attempt.text?.trim();
    const student: DisplayMessage = {
      id: uid("s"),
      role: "student",
      content: typed || "(sent a photo of my working)",
      createdAt: Date.now(),
      attemptImage: attempt.imageDataUrl,
      imageOnly: !typed,
    };
    setMessages((prev) => [...prev, student]);
    void sendCheckWork(attempt);
  }

  /**
   * Post an attempt for diagnosis.
   *
   * `problem` is an explicit parameter rather than read from state because the
   * opening auto-diagnosis runs in the same tick as `setAnalysis(data)`, when
   * the `analysis` state is still null — and `runAnalysis` is a `[]`-deps
   * callback, so it would close over the first render's value regardless.
   */
  async function sendCheckWork(
    attempt: StudentAttempt,
    problem?: ProblemAnalysis,
  ) {
    const forProblem = problem ?? analysis;
    if (!forProblem) return;
    setTurnBusy(true);
    setTurnError(null);
    retryRef.current = null;
    try {
      const res = await fetch("/api/check-work", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ problem: forProblem, attempt }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Check failed."));
      const check: WorkCheck = await res.json();
      // Fold the diagnosis into memory so it counts toward recurrence /
      // resolution, then refresh the recurring-gap banner.
      memoryRef.current = applyWorkCheckToMemory(
        memoryRef.current,
        check,
        forProblem.concept,
      );
      setRecurring(detectRecurring(memoryRef.current));
      setMessages((prev) => [
        ...prev,
        {
          id: uid("t"),
          role: "tutor",
          content: check.summary,
          createdAt: Date.now(),
          workCheck: check,
        },
      ]);
    } catch (err) {
      retryRef.current = () => void sendCheckWork(attempt, forProblem);
      setTurnError(err instanceof Error ? err.message : "Check failed.");
    } finally {
      setTurnBusy(false);
    }
  }

  function handlePractice(focus?: PracticeFocus) {
    if (!analysis || turnBusy) return;
    // Append a self-contained practice widget; it generates and evaluates on
    // its own via /api/practice/*. A focus makes it a targeted retry.
    setMessages((prev) => [
      ...prev,
      {
        id: uid("p"),
        role: "tutor",
        content: "",
        createdAt: Date.now(),
        practiceFor: analysis,
        practiceFocus: focus,
      },
    ]);
  }

  // Retry→verify: a targeted retry reports back whether the misconception is
  // cleared. Clear it from memory (→ banner disappears) or record the miss.
  function handlePracticeResolved(concept: string, resolved: boolean) {
    memoryRef.current = resolved
      ? resolveMisconception(memoryRef.current, concept)
      : recordConceptError(memoryRef.current, concept);
    setRecurring(detectRecurring(memoryRef.current));
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
          className="mt-4 inline-flex h-11 items-center rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-raised transition hover:bg-brand-700 active:scale-[0.98] active:bg-brand-700"
        >
          Go to home
        </Link>
      </CenteredShell>
    );
  }

  // Offer "Continue" when the last turn was a tutor chunk with more to give.
  const last = messages[messages.length - 1];
  const canContinue =
    !!last && last.role === "tutor" && !!last.hasMore && !last.practiceFor;

  // The reference material (skeleton → error → problem card). Rendered inside
  // the scroll list on mobile and in the sticky left pane on md+; both slots
  // read the same state, so nothing is fetched twice.
  const reference = (
    <>
      {phase === "loading" && !analysis && <ProblemCardSkeleton />}

      {phase === "error" && (
        <ErrorState
          message={analyzeError ?? "Could not analyze the problem."}
          onRetry={() => image && runAnalysis(image)}
        />
      )}

      {image && analysis && (
        <div className="animate-rise">
          <ProblemCard image={image} analysis={analysis} />
        </div>
      )}
    </>
  );

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md animate-rise flex-col bg-slate-50 md:grid md:max-w-6xl md:grid-cols-[minmax(320px,400px)_1fr] md:grid-rows-[auto_minmax(0,1fr)] md:gap-0">
      <TopBar
        onBack={() => router.push("/")}
        topic={analysis?.topic}
        prefs={prefs}
        onPrefsChange={updatePrefs}
        prefsDisabled={turnBusy}
        showPrefs={!!analysis}
      />

      {/* Sticky reference pane (md+) */}
      <aside className="hidden md:block md:min-h-0 md:overflow-y-auto md:border-r md:border-hairline md:p-5">
        {reference}
      </aside>

      {/* Conversation column */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          aria-live="polite"
          className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-6"
        >
          <div className="mx-auto w-full space-y-6 md:max-w-2xl">
            <div className="md:hidden">{reference}</div>

            {messages.map((m) =>
              m.practiceFor ? (
                <div key={m.id} className="animate-rise">
                  <PracticeCard
                    source={m.practiceFor}
                    focus={m.practiceFocus}
                    onResolved={handlePracticeResolved}
                  />
                </div>
              ) : m.opener ? (
                <OpeningNudge key={m.id} text={m.content} />
              ) : (
                <MessageBubble
                  key={m.id}
                  message={m}
                  solution={m.solution}
                  similarProblem={m.similarProblem}
                  workCheck={m.workCheck}
                  attemptImage={m.attemptImage}
                  imageOnly={m.imageOnly}
                />
              ),
            )}

            {turnBusy && !streamingId && (
              <LoadingState label="Tutor is thinking…" />
            )}

            {/* "Continue" expands into place instead of popping and shifting the list. */}
            <div
              className={`grid transition-[grid-template-rows] duration-200 ${
                canContinue && !turnBusy ? "grid-rows-[1fr]" : "grid-rows-[0fr] !mt-0"
              }`}
            >
              <div className="overflow-hidden">
                {canContinue && !turnBusy && (
                  <div className="flex justify-start">
                    <button
                      onClick={handleContinue}
                      className="inline-flex h-11 items-center gap-1.5 rounded-full border border-brand-300 bg-surface px-4 text-sm font-semibold text-brand-700 shadow-raised transition hover:border-brand-500 hover:bg-brand-50 active:scale-[0.98]"
                    >
                      Continue
                      <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {turnError && (
              <ErrorState
                message={turnError}
                onRetry={() => retryRef.current?.()}
              />
            )}
          </div>
        </div>

        {analysis && showRecurring && recurring && (
          <RecurringBanner
            gap={recurring}
            onPractice={() =>
              handlePractice({
                concept: recurring.concept,
                studentBelief: recurring.studentBelief,
                correctModel: recurring.correctModel,
              })
            }
            onDismiss={() =>
              setDismissed({ concept: recurring.concept, count: recurring.count })
            }
          />
        )}

        {analysis && (
          <ActionBar
            busy={turnBusy}
            onAction={handleAction}
            onAsk={handleAsk}
            onFocus={scrollToBottom}
            onWhyWrong={() => openComposer("why")}
            onCheckWork={() => openComposer("check")}
            onPractice={() => handlePractice()}
          />
        )}
      </div>

      {composerOpen && (
        <AttemptComposer
          busy={turnBusy}
          mode={composerMode}
          onSubmit={handleCheckWork}
          onCancel={() => setComposerOpen(false)}
        />
      )}
    </div>
  );
}

const HELP_LABEL: Record<TutorPreferences["assistanceStyle"], string> = {
  hint_first: "Hints",
  direct: "Direct",
};
const GOAL_LABEL: Record<TutorPreferences["goal"], string> = {
  both: "Both",
  understand: "Understand",
  exam: "Exam",
};

function TopBar({
  onBack,
  topic,
  prefs,
  onPrefsChange,
  prefsDisabled,
  showPrefs,
}: {
  onBack: () => void;
  topic?: string;
  prefs: TutorPreferences;
  onPrefsChange: (next: TutorPreferences) => void;
  prefsDisabled?: boolean;
  showPrefs: boolean;
}) {
  // Purely presentational: whether the preferences popover is open.
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!popoverRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <header className="relative z-10 flex min-h-14 items-center gap-2 border-b border-hairline bg-surface px-2 pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top,0px))] md:col-span-2 md:px-4">
      <button
        onClick={onBack}
        aria-label="Back"
        className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
      >
        <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <div className="min-w-0 flex-1">
        <Wordmark className="block text-base leading-5" />
        {topic && (
          <p className="truncate text-xs leading-4 text-slate-500 [@media(max-height:560px)]:hidden">{topic}</p>
        )}
      </div>

      {showPrefs && (
        <div ref={popoverRef} className="relative flex-shrink-0">
          <button
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-slate-300 bg-surface px-3 text-sm font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-700 md:h-9"
          >
            <Settings2 size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="hidden sm:inline">
              {HELP_LABEL[prefs.assistanceStyle]} · {GOAL_LABEL[prefs.goal]}
            </span>
            <span className="sr-only sm:hidden">Session preferences</span>
            <ChevronDown
              size={16}
              strokeWidth={1.75}
              aria-hidden="true"
              className={`transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>

          {open && (
            <div
              role="dialog"
              aria-label="Session preferences"
              className="absolute right-0 top-full z-30 mt-2 w-72 animate-pop-in rounded-lg border border-hairline bg-surface p-3 shadow-raised"
            >
              <SessionToggles
                prefs={prefs}
                onChange={onPrefsChange}
                disabled={prefsDisabled}
              />
            </div>
          )}
        </div>
      )}
    </header>
  );
}

function CenteredShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md animate-rise flex-col items-center justify-center px-6 text-center">
      {children}
    </main>
  );
}
