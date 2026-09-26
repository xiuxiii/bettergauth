"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ChevronDown, ChevronLeft, Settings2 } from "lucide-react";
import type {
  ChatMessage,
  CheckWorkRequest,
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
  WorkError,
} from "@/lib/tutor/types";
import {
  hintGiven,
  initialReveal,
  sessionStage,
  type RevealStep,
} from "@/lib/tutor/stage";
import {
  applyWorkCheckToMemory,
  detectRecurring,
  emptySessionMemory,
  normalizeAnalysis,
  normalizeWorkCheck,
  recordConceptError,
  resolveGaps,
  resolveMisconception,
} from "@/lib/tutor/types";
import {
  IMAGE_KEY,
  QUESTION_KEY,
  TEXT_KEY,
  WORK_HINT_KEY,
  uid,
} from "@/lib/utils";
import { safePrefix } from "@/lib/tutor/streamText";
import { apiFetch, readApiError, readNdjson } from "@/lib/apiClient";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
} from "@/lib/preferences";
import { resumeSession, saveProgress, startSession } from "@/lib/history/record";
import { getImage, getSession } from "@/lib/history/db";
import { blobToDataUrl } from "@/lib/image";
import ProblemCard from "@/components/ProblemCard";
import MessageBubble from "@/components/MessageBubble";
import ActionBar from "@/components/ActionBar";
import AttemptComposer from "@/components/AttemptComposer";
import PracticeCard, { type PracticeState } from "@/components/PracticeCard";
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
  /** How far that check has been revealed. Saved, so a reopen shows no more. */
  reveal?: RevealStep;
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
  /** The practice widget's own progress, saved so a reopen can restore it. */
  practiceState?: PracticeState;
  /** The tutor action that produced this turn (e.g. "hint"). */
  action?: TutorAction;
  /** This turn confirmed the student solved it in the chat. */
  resolved?: boolean;
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

/** One NDJSON frame from the streaming /api/check-work response. */
type CheckStreamFrame =
  | { t: "stage"; stage: "thinking" | "writing" }
  | { t: "done"; check: WorkCheck }
  | { t: "error"; message: string };

/** "notWork": the photo holds no study material at all (dinner, the floor, an
 *  accidental shot) — shown as "Question not detected", not as an error. */
/**
 * The problem as sent with a work check started BEFORE the analysis returns.
 * The check reads the printed question off the same photo it reads the working
 * from, so it doesn't need the extracted text; it needs something non-empty
 * that tells it where to look.
 */
const PROBLEM_FROM_PHOTO: ProblemAnalysis = {
  problemText: "The printed question shown in the attached photo — read it from the image.",
  subject: "Unknown",
  topic: "",
  concept: "",
  confidence: 0,
  studentWork: { present: true },
  openingHint: "",
};

type Phase = "loading" | "ready" | "error" | "empty" | "notWork";

/**
 * Whether the transcript already holds a practice card for `concept` that the
 * student hasn't finished. A finished card is one with a saved evaluation.
 */
function hasOpenPractice(messages: readonly DisplayMessage[], concept: string) {
  const key = concept.trim().toLowerCase();
  return messages.some(
    (m) =>
      m.practiceFor &&
      m.practiceFocus?.concept.trim().toLowerCase() === key &&
      !m.practiceState?.evaluation,
  );
}

export default function TutorWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [image, setImage] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ProblemAnalysis | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  // The committed transcript, for callbacks that outlive the render they were
  // created in (a streamed turn finishing seconds later).
  const messagesRef = useRef<DisplayMessage[]>([]);
  messagesRef.current = messages;
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
  // Set when the composer is retrying a flagged step rather than a new check.
  const [composerRetry, setComposerRetry] = useState<WorkError | null>(null);
  const [prefs, setPrefs] = useState<TutorPreferences>(DEFAULT_PREFERENCES);
  // The work check's real progress, from its stream: the model reasoning,
  // then writing. Null before the first frame.
  const [checkStage, setCheckStage] = useState<"thinking" | "writing" | null>(
    null,
  );

  function openComposer(retry: WorkError | null = null) {
    setComposerRetry(retry);
    setComposerOpen(true);
  }

  // What requestTurn actually sends. A ref, not the state above, because the
  // opening turns are fired from inside runAnalysis — a callback created once
  // on mount — and would otherwise read the FIRST render's defaults: an Ask
  // mode answer ignoring the student's curriculum and help style.
  const prefsRef = useRef<TutorPreferences>(DEFAULT_PREFERENCES);

  // Load saved preferences (client-only) so tutor turns can carry them.
  useEffect(() => {
    const loaded = loadPreferences() ?? DEFAULT_PREFERENCES;
    prefsRef.current = loaded;
    setPrefs(loaded);
  }, []);

  function updatePrefs(next: TutorPreferences) {
    prefsRef.current = next;
    setPrefs(next);
    savePreferences(next);
  }

  // The tutor's cross-turn memory: round-tripped through /api/tutor so the
  // tutor adapts, avoids re-teaching, and catches recurring misconceptions.
  const memoryRef = useRef<SessionMemory>(emptySessionMemory());
  // The history record for this session, or null when storage is unavailable
  // (private window, blocked site data) — in which case nothing is recorded and
  // the app behaves exactly as it did before history existed.
  const recordIdRef = useRef<string | null>(null);
  // Bumped whenever something worth persisting changes; the effect below
  // debounces the actual write so a streamed turn is saved once, not per chunk.
  const [recordTick, setRecordTick] = useState(0);
  const bumpRecord = useCallback(() => setRecordTick((n) => n + 1), []);
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

  // Persist the transcript and concept memory, debounced: a streamed turn
  // updates `messages` many times and only its final state is worth writing.
  useEffect(() => {
    const id = recordIdRef.current;
    if (!id) return;
    const timer = window.setTimeout(() => {
      void saveProgress(id, messages, memoryRef.current);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [messages, recordTick]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Ensures the initial auto-analysis fires exactly once, so a double effect
  // invocation (StrictMode / Fast Refresh) can never append a duplicate opener.
  // Manual retries call runAnalysis directly and are unaffected.
  const startedRef = useRef(false);
  // Ask mode's question for this capture, if there is one. Read once at start.
  const questionRef = useRef<string | null>(null);
  // Detection saw handwritten working in the chosen question: start the work
  // check alongside the analysis instead of after it. Read once at start.
  const workHintRef = useRef(false);

  // What the last analysis was run on, for its "Try again".
  const inputRef = useRef<{ image?: string; text?: string } | null>(null);

  // Analyze the captured image, or a problem typed on the home screen.
  const runAnalysis = useCallback(async (input: { image?: string; text?: string }) => {
    inputRef.current = input;
    const dataUrl = input.image ?? null;
    setPhase("loading");
    setAnalyzeError(null);

    // When detection already saw handwritten working, the work check doesn't
    // have to wait for the analysis: the check reads the problem off the same
    // photo. Measured on the live deploy, analyze (~3.9s) then check-work
    // (~7.1s) ran back to back; overlapping them saves the analyze time. The
    // analysis still decides — if it says there is no work (or no problem at
    // all) the early check is aborted and its result ignored. Never in Ask
    // mode, where the student's question wins anyway.
    let early: { promise: Promise<WorkCheck>; controller: AbortController } | null =
      null;
    if (dataUrl && workHintRef.current && !questionRef.current) {
      const controller = new AbortController();
      const promise = fetchCheck(
        { imageDataUrl: dataUrl },
        PROBLEM_FROM_PHOTO,
        controller.signal,
        undefined,
        setCheckStage,
      );
      promise.catch(() => {}); // awaited later, or deliberately dropped
      early = { promise, controller };
    }
    workHintRef.current = false;

    try {
      const res = await apiFetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dataUrl ? { image: dataUrl } : { text: input.text }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Analysis failed."));
      const data: ProblemAnalysis = await res.json();

      // Second line of the not-work gate. Detection normally catches this in
      // the cropper, but it doesn't block the confirm button (it mustn't — that
      // was the slow screen), so a quick tap can get here first. Nothing gets
      // recorded to history and no tutor turn is spent. Only an explicit false
      // counts: a missing flag never turns a real problem away.
      if (data.hasStemContent === false) {
        early?.controller.abort();
        setPhase("notWork");
        return;
      }

      setAnalysis(data);
      setPhase("ready");

      // Record the session from here: before this point there is no problem to
      // file it under. Failure is silent by design — history is an extra, and
      // must never block or break the tutoring itself.
      void startSession(data, dataUrl).then((id) => {
        recordIdRef.current = id;
        if (!id) return;
        bumpRecord();
        // From here the session lives in history. Point the URL at it, so a
        // reload or revisit reopens it — instead of re-running the paid
        // analysis on a handoff that is already spent, and filing a second
        // copy of the same problem.
        router.replace(`/workspace?session=${encodeURIComponent(id)}`);
      });

      // Ask mode: they asked something specific, so answer that. It wins over
      // both the opener and auto-diagnosis — a question about the tension in a
      // diagram shouldn't be answered with a critique of their working.
      const asked = questionRef.current;
      if (asked) {
        questionRef.current = null;
        const student: DisplayMessage = {
          id: uid("s"),
          role: "student",
          content: asked,
          createdAt: Date.now(),
        };
        setMessages([student]);
        void requestTurn("question", data, [student], asked);
        return;
      }

      // The photo already shows their attempt: diagnose it instead of asking
      // them to start. No student turn is posted — the card directly above is
      // already showing the photo with the working in it, and the diagnosis
      // reads that same photo. Everything downstream (memory, recurring gaps,
      // retry) behaves as if they had submitted it themselves.
      if (dataUrl && data.studentWork?.present) {
        setMessages([]);
        void sendCheckWork({ imageDataUrl: dataUrl }, data, early?.promise);
        return;
      }
      // Typed working: there is no photo for the check to read, so the
      // analysis hands the working back separately. Show it as theirs (the
      // problem card holds only the question) and check it straight away.
      const typedWork = !dataUrl ? data.attemptText?.trim() : "";
      if (typedWork && data.studentWork?.present) {
        setMessages([
          {
            id: uid("s"),
            role: "student",
            content: typedWork,
            createdAt: Date.now(),
          },
        ]);
        void sendCheckWork({ text: typedWork }, data);
        return;
      }
      // Detection thought there was working; the analysis says not. Drop it.
      early?.controller.abort();

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
      early?.controller.abort();
      setAnalyzeError(err instanceof Error ? err.message : "Analysis failed.");
      setPhase("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reopening a saved session (/workspace?session=<id>) rehydrates from the
  // stored record instead of re-analyzing: the analysis, transcript and concept
  // memory are already known, and paying for the model again to rebuild what is
  // on disk would be both slow and billable.
  const reopenId = searchParams.get("session");
  const practiceConcept = searchParams.get("practice");

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    if (reopenId) {
      void (async () => {
        const rec = await getSession(reopenId);
        if (!rec) {
          setPhase("empty");
          return;
        }
        if (rec.imageId) {
          const blob = await getImage(rec.imageId);
          if (blob) {
            try {
              setImage(await blobToDataUrl(blob));
            } catch {
              /* the transcript is still worth showing without the photo */
            }
          }
        }
        // Records saved before the concept/keyIdea split would otherwise put
        // the old spoiler sentence straight back on the problem card.
        const analysis = normalizeAnalysis(rec.analysis);
        setAnalysis(analysis);
        memoryRef.current = rec.memory;
        setRecurring(detectRecurring(rec.memory));
        // Attempt photos are stored as ids, not inline data URLs, so they have
        // to be resolved back or the student's own working vanishes from the
        // transcript they just reopened.
        // Every photo resolved from an id, so the next save can reuse the id.
        const knownImages: [string, string][] = [];
        const restored = await Promise.all(
          rec.messages.map(async (m) => {
            const msg = { ...m } as unknown as DisplayMessage & {
              attemptImageId?: string;
            };
            if (msg.workCheck) msg.workCheck = normalizeWorkCheck(msg.workCheck);
            // A practice card's attempt photo is stored by id, like any other.
            const practicePhotoId = (
              msg.practiceState?.attempt as { imageId?: string } | undefined
            )?.imageId;
            if (practicePhotoId && msg.practiceState?.attempt) {
              const blob = await getImage(practicePhotoId);
              if (blob) {
                try {
                  const dataUrl = await blobToDataUrl(blob);
                  knownImages.push([dataUrl, practicePhotoId]);
                  msg.practiceState = {
                    ...msg.practiceState,
                    attempt: { ...msg.practiceState.attempt, imageDataUrl: dataUrl },
                  };
                } catch {
                  /* the evaluation still stands without the photo */
                }
              }
            }
            if (msg.attemptImageId) {
              const blob = await getImage(msg.attemptImageId);
              if (blob) {
                try {
                  msg.attemptImage = await blobToDataUrl(blob);
                  knownImages.push([msg.attemptImage, msg.attemptImageId]);
                } catch {
                  /* leave the bubble without its photo */
                }
              }
            }
            return msg as DisplayMessage;
          }),
        );
        // "Practice this" on the home screen: reopen the session the concept
        // last went wrong in, with a targeted practice problem waiting. Only
        // if there isn't one open for that concept already: the link used to
        // add a card, and a paid generate call, on every load of the URL.
        if (practiceConcept && !hasOpenPractice(restored, practiceConcept)) {
          const key = practiceConcept.trim().toLowerCase();
          const m = rec.memory.misconceptions?.find(
            (x) => x.concept.trim().toLowerCase() === key && x.status !== "resolved",
          );
          restored.push({
            id: uid("p"),
            role: "tutor",
            content: "",
            createdAt: Date.now(),
            practiceFor: analysis,
            practiceFocus: {
              concept: practiceConcept,
              studentBelief: m?.studentBelief,
              correctModel: m?.correctModel,
            },
          });
        }
        setMessages(restored);
        // Keep writing to the same record, so continuing an old session
        // extends it rather than forking a duplicate.
        resumeSession(knownImages);
        recordIdRef.current = rec.id;
        setPhase("ready");
        // The practice request is spent; a reload must not repeat it.
        if (practiceConcept) {
          router.replace(`/workspace?session=${encodeURIComponent(rec.id)}`);
        }
      })();
      return;
    }

    // The handoff from home is read once and cleared at once: every key, so a
    // reload can't replay it (another paid analysis, another history record).
    // After the analysis the URL names the saved session, which is what a
    // reload reopens.
    let stored: string | null = null;
    let typedText: string | null = null;
    try {
      stored = sessionStorage.getItem(IMAGE_KEY);
      typedText = stored ? null : sessionStorage.getItem(TEXT_KEY)?.trim() || null;
      questionRef.current = sessionStorage.getItem(QUESTION_KEY)?.trim() || null;
      workHintRef.current = sessionStorage.getItem(WORK_HINT_KEY) === "1";
      for (const key of [IMAGE_KEY, TEXT_KEY, QUESTION_KEY, WORK_HINT_KEY]) {
        sessionStorage.removeItem(key);
      }
    } catch {
      /* blocked storage: nothing was handed over */
      questionRef.current = null;
      workHintRef.current = false;
    }
    if (typedText) {
      questionRef.current = null;
      workHintRef.current = false;
      void runAnalysis({ text: typedText });
      return;
    }
    if (!stored) {
      setPhase("empty");
      return;
    }
    setImage(stored);
    void runAnalysis({ image: stored });
    // practiceConcept is read once with the reopen, like reopenId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runAnalysis, reopenId]);

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
      const res = await apiFetch("/api/tutor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          problem,
          history: toHistory(history),
          action,
          studentText,
          preferences: prefsRef.current,
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
              { id, role: "tutor", createdAt: Date.now(), action, ...patch },
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
          bumpRecord();
        }
        put({
          content: turn.message,
          solution: turn.solution,
          similarProblem: turn.similarProblem,
          hasMore: turn.hasMore,
          resolved: turn.resolved || undefined,
        });
        if (turn.resolved) markSolvedInChat();
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
    const retry = composerRetry;
    setComposerRetry(null);

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
    void sendCheckWork(
      attempt,
      undefined,
      undefined,
      retry
        ? { line: retry.line, locate: retry.locate, category: retry.category }
        : undefined,
    );
  }

  /**
   * The tutor confirmed the student solved it in the chat. Move everything on
   * as if they had revealed it: the latest check shows the rest, and its gap
   * (plus any misconception still open this session) is closed in memory, so
   * "Concepts to work on" stops listing what they just fixed. The stage reads
   * the turn's `resolved` flag, which is what shows the key idea and the
   * resolved chips.
   */
  function markSolvedInChat() {
    setMessages((prev) => {
      const i = prev.map((m) => !!m.workCheck).lastIndexOf(true);
      if (i === -1) return prev;
      const next = prev.slice();
      next[i] = { ...next[i], reveal: 2 };
      return next;
    });
    // The updater above runs lazily, so the check's concept is read from the
    // latest committed transcript instead.
    const latest = [...messagesRef.current].reverse().find((m) => m.workCheck);
    const open = memoryRef.current.misconceptions
      .filter((m) => m.status !== "resolved")
      .map((m) => m.concept);
    memoryRef.current = resolveGaps(memoryRef.current, [
      latest?.workCheck?.concept,
      ...open,
    ]);
    setRecurring(detectRecurring(memoryRef.current));
    bumpRecord();
  }

  /** Save a practice card's progress on its message (persisted with it). */
  function savePracticeState(id: string, state: PracticeState) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === id ? { ...m, practiceState: { ...m.practiceState, ...state } } : m,
      ),
    );
  }

  /** Move a check's reveal on. Saved with the transcript by the effect above. */
  function handleReveal(id: string, next: RevealStep) {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, reveal: next } : m)),
    );
  }

  /**
   * Post an attempt for diagnosis.
   *
   * `problem` is an explicit parameter rather than read from state because the
   * opening auto-diagnosis runs in the same tick as `setAnalysis(data)`, when
   * the `analysis` state is still null — and `runAnalysis` is a `[]`-deps
   * callback, so it would close over the first render's value regardless.
   */
  /**
   * POST an attempt to /api/check-work and read its NDJSON stream. Touches no
   * state itself, so it is safe to start early; progress goes to `onStage`.
   */
  async function fetchCheck(
    attempt: StudentAttempt,
    problem: ProblemAnalysis,
    signal?: AbortSignal,
    retryOf?: CheckWorkRequest["retryOf"],
    onStage?: (stage: "thinking" | "writing") => void,
  ): Promise<WorkCheck> {
    const res = await apiFetch("/api/check-work", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ problem, attempt, retryOf }),
      signal,
    });
    if (!res.ok) throw new Error(await readApiError(res, "Check failed."));
    for await (const frame of readNdjson<CheckStreamFrame>(res)) {
      if (frame.t === "stage") onStage?.(frame.stage);
      else if (frame.t === "done") return frame.check;
      else if (frame.t === "error") throw new Error(frame.message);
    }
    // The connection dropped before the result arrived.
    throw new Error("The check was cut off. Please try again.");
  }

  async function sendCheckWork(
    attempt: StudentAttempt,
    problem?: ProblemAnalysis,
    /** A check already in flight (started alongside the analysis). */
    pending?: Promise<WorkCheck>,
    /** A second go at a step an earlier check flagged. */
    retryOf?: CheckWorkRequest["retryOf"],
  ) {
    const forProblem = problem ?? analysis;
    if (!forProblem) return;
    setTurnBusy(true);
    setTurnError(null);
    retryRef.current = null;
    // An early check may already be reporting progress; keep its stage.
    if (!pending) setCheckStage(null);
    try {
      const check = normalizeWorkCheck(
        await (pending ??
          fetchCheck(attempt, forProblem, undefined, retryOf, setCheckStage)),
      );
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
          content: check.headline,
          createdAt: Date.now(),
          workCheck: check,
          reveal: initialReveal(
            check,
            prefsRef.current.assistanceStyle === "direct",
          ),
        },
      ]);
    } catch (err) {
      retryRef.current = () =>
        void sendCheckWork(attempt, forProblem, undefined, retryOf);
      setTurnError(err instanceof Error ? err.message : "Check failed.");
    } finally {
      setCheckStage(null);
      setTurnBusy(false);
    }
  }

  // A practice card is on its way: set synchronously, so a double tap (two
  // clicks in one tick, before any re-render) can't add a second card and a
  // second paid generate call. Cleared once the new card has its problem, or
  // gave up.
  const practicePendingRef = useRef(false);
  const [practicePending, setPracticePending] = useState(false);

  function handlePractice(focus?: PracticeFocus) {
    if (!analysis || turnBusy || practicePendingRef.current) return;
    practicePendingRef.current = true;
    setPracticePending(true);
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
    // No message changes here, so the persistence effect needs telling
    // explicitly — this is the one path that moves the concept memory alone.
    bumpRecord();
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
          className="mt-4 inline-flex h-11 items-center rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-raised transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep"
        >
          Go to home
        </Link>
      </CenteredShell>
    );
  }

  // Nothing to tutor. The same words the cropper uses, centred, with one way
  // forward — not the red error card, because nothing failed: the input just
  // wasn't a maths or science problem. Nothing was saved to history.
  if (phase === "notWork") {
    const typed = !!inputRef.current?.text;
    return (
      <CenteredShell>
        <EmptyState
          title={
            typed
              ? "That doesn't look like a maths or science problem"
              : "Question not detected"
          }
          hint={
            typed
              ? "MindGap helps with maths, physics, chemistry and biology. Type or snap one of those."
              : "Please try again with the problem in frame."
          }
        />
        <Link
          href="/"
          className="mt-4 inline-flex h-11 items-center rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-raised transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep"
        >
          {typed ? "Back to home" : "Take another photo"}
        </Link>
      </CenteredShell>
    );
  }

  const stage = sessionStage(messages);

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
          onRetry={() => inputRef.current && runAnalysis(inputRef.current)}
        />
      )}

      {analysis && (
        <div className="animate-rise">
          <ProblemCard
            image={image}
            analysis={analysis}
            showKeyIdea={stage === "resolved"}
          />
        </div>
      )}
    </>
  );

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md animate-rise flex-col bg-slate-50 md:grid md:max-w-6xl md:grid-cols-[minmax(320px,400px)_1fr] md:grid-rows-[auto_minmax(0,1fr)] md:gap-0">
      <TopBar
        onBack={() => router.push("/")}
        // The same label as the problem card's tag, not a second, longer one.
        topic={analysis ? analysis.concept || analysis.topic : undefined}
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
                    saved={m.practiceState}
                    onChange={(state) => savePracticeState(m.id, state)}
                    onSettled={() => {
                      practicePendingRef.current = false;
                      setPracticePending(false);
                    }}
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
                  reveal={m.reveal}
                  onReveal={(next) => handleReveal(m.id, next)}
                  onRetry={
                    m.workCheck?.firstError
                      ? () => openComposer(m.workCheck!.firstError!)
                      : undefined
                  }
                  busy={turnBusy}
                  attemptImage={m.attemptImage}
                  imageOnly={m.imageOnly}
                />
              ),
            )}

            {turnBusy && !streamingId && (
              <LoadingState
                label={
                  checkStage === "writing"
                    ? "Writing it up…"
                    : checkStage === "thinking"
                      ? "Checking each step…"
                      : "Tutor is thinking…"
                }
              />
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
            busy={turnBusy || practicePending}
            stage={stage}
            hinted={hintGiven(messages)}
            onAction={handleAction}
            onAsk={handleAsk}
            onFocus={scrollToBottom}
            onCheckWork={() => openComposer()}
            onPractice={() => handlePractice()}
          />
        )}
      </div>

      {composerOpen && (
        <AttemptComposer
          busy={turnBusy}
          retry={composerRetry ?? undefined}
          onSubmit={handleCheckWork}
          onCancel={() => {
            setComposerOpen(false);
            setComposerRetry(null);
          }}
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
