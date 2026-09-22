// Domain types shared across UI, tutoring logic, and the AI provider layer.
// Kept provider-agnostic on purpose so a real model can be swapped in later.

export type Subject =
  | "Physics"
  | "Chemistry"
  | "Biology"
  | "Mathematics"
  | "Unknown";

/** Result of analyzing an uploaded problem image (problem extraction + classification). */
export interface ProblemAnalysis {
  /** The problem text as detected from the image (OCR in a real provider). */
  problemText: string;
  /** Subject classification. */
  subject: Subject;
  /** A finer-grained topic, e.g. "Conservation of energy". */
  topic: string;
  /**
   * Concept identification: the single governing concept/principle the problem
   * hinges on (may equal or refine `topic`). This is the target of the
   * "concept identification" capability and seeds the tutoring session.
   */
  concept: string;
  /** 0..1 confidence that the detection is correct. */
  confidence: number;
  /**
   * The student's own handwritten attempt, when the photo already contains one.
   * They frequently shoot a problem they have already worked on, so the session
   * opens by diagnosing this instead of inviting them to start.
   *
   * Handwriting only: a printed worked example or answer key on the same page is
   * part of the question, not an attempt. `transcript` preserves their steps and
   * their mistakes verbatim.
   */
  studentWork: {
    present: boolean;
    transcript: string;
  };
  /**
   * One short sentence pointing at where to start, shown as the session's first
   * message. It rides along on the analysis call, so the student gets a real
   * hint with no extra wait and no extra request — rather than a paragraph
   * explaining which buttons to press.
   */
  openingHint: string;
}

/**
 * What the client sends to /api/analyze. The image is a data URL so it carries
 * its own media type; a real provider splits it into base64 + media_type for
 * the model's image content block.
 */
export interface AnalyzeRequest {
  /** `data:<mediaType>;base64,<data>` URL of the problem photo/upload. */
  imageDataUrl: string;
  /**
   * The subject the student picked in the capture step, if any. Passed to the
   * provider as context only — the model still classifies by content.
   */
  subjectHint?: Subject;
}

// ---------------------------------------------------------------------------
// Question detection — locating individual questions on a photographed page
// ---------------------------------------------------------------------------

/** A rectangle in normalised image coordinates (fractions of width/height, 0..1). */
export interface NormalizedRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One question found on the page, with where it sits in the photo. */
export interface DetectedQuestion {
  /** The label printed on the page ("Question 5", "3(b)") or a generated one. */
  label: string;
  rect: NormalizedRect;
}

/** What the client sends to /api/detect-questions. */
export interface DetectQuestionsRequest {
  imageDataUrl: string;
}

/**
 * The questions found in a photo, top-to-bottom, and which one the student
 * most likely wants. Empty `questions` means nothing distinct was found and
 * the whole photo should be offered as the crop.
 */
export interface QuestionDetection {
  questions: DetectedQuestion[];
  /** Index into `questions` of the most likely intended question. */
  primaryIndex: number;
}

export type Role = "student" | "tutor";

export interface ChatMessage {
  id: string;
  role: Role;
  /** Markdown-ish text; may contain $inline$ and $$block$$ math. */
  content: string;
  createdAt: number;
}

/**
 * Explicit signals the student can send the tutor about how much help they
 * want. These are NOT separate systems — every one is just an input to the same
 * tutor engine, alongside free-form "ask". They form a rough ladder of
 * assistance:
 *   hint (least) → explain → go_deeper → show_solution (most), plus
 *   similar_problem (a lateral "test my understanding" move).
 * "continue" asks for the next small piece after a chunked turn.
 */
export type TutorAction =
  | "ask"
  | "continue"
  | "hint"
  | "explain"
  | "go_deeper"
  | "show_solution"
  | "similar_problem";

/**
 * Student preferences captured at setup and toggleable in-session. Stored
 * client-side (localStorage) and threaded into the tutor's system prompt.
 */
export interface TutorPreferences {
  /**
   * Grade for LOOSE calibration of vocabulary/assumed baseline only — never a
   * basis to assume specific courses or topics.
   */
  grade?: "9" | "10" | "11" | "12" | "other" | null;
  /** Default lean: make me work first, or explain directly. Toggleable. */
  assistanceStyle: "hint_first" | "direct";
  /** What the student is here for. Baseline always keeps exam-relevance +
   * conceptual depth; this only shifts emphasis. Toggleable. */
  goal: "understand" | "exam" | "both";
}

// ---------------------------------------------------------------------------
// Session memory — the tutor's cross-turn working memory
// ---------------------------------------------------------------------------

/** A wrong mental model the tutor is tracking, with resolution status. */
export interface RememberedMisconception {
  concept: string;
  /** The student's wrong model, in plain terms. */
  studentBelief: string;
  /** The correct model. */
  correctModel: string;
  status: "suspected" | "confirmed" | "resolving" | "resolved";
}

/** A classified mistake, kept so repetition on one concept reads as a gap. */
export interface RememberedError {
  type:
    | "careless"
    | "arithmetic"
    | "algebraic"
    | "notation"
    | "procedural"
    | "conceptual"
    | "strategic";
  concept: string;
}

/**
 * Compact, mutable memory the tutor maintains and round-trips through
 * /api/tutor every turn — the working subset of the full TutorState
 * (lib/tutor/state.ts). This is what gives the tutor cross-turn memory:
 * adapting depth, not re-teaching mastered concepts, and spotting a RECURRING
 * misconception (the same concept failing more than once).
 */
export interface SessionMemory {
  /** Concepts the student has proven they know — never re-explain these. */
  demonstrated: string[];
  /** Misconceptions seen this session. */
  misconceptions: RememberedMisconception[];
  /** Classified errors, in order. */
  errors: RememberedError[];
  /** The single current blocker in one line ("" if none). */
  bottleneck: string;
}

/** A fresh, empty session memory. */
export function emptySessionMemory(): SessionMemory {
  return { demonstrated: [], misconceptions: [], errors: [], bottleneck: "" };
}

/** A concept that has tripped the student up more than once this session. */
export interface RecurringGap {
  concept: string;
  /** How many classified errors touched this concept. */
  count: number;
  /** The tracked wrong model, if one was named for this concept. */
  studentBelief?: string;
  /** The correct model — the one-line refresher. */
  correctModel?: string;
}

/**
 * Find the single most-recurring conceptual gap: a concept with ≥2 classified
 * errors and not already resolved. Deterministic and client-side — the model
 * just maintains the memory; the UI decides when a pattern is worth surfacing.
 */
export function detectRecurring(
  memory: SessionMemory | undefined,
): RecurringGap | null {
  if (!memory) return null;

  // A concept the student has since demonstrated is resolved — never nag on it.
  const demonstrated = new Set(
    memory.demonstrated.map((d) => d.trim().toLowerCase()),
  );
  const counts = new Map<string, number>();
  for (const e of memory.errors) {
    const key = e.concept.trim();
    if (key && !demonstrated.has(key.toLowerCase())) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  let top: { concept: string; count: number } | null = null;
  for (const [concept, count] of counts) {
    if (count >= 2 && (!top || count > top.count)) top = { concept, count };
  }
  if (!top) return null;

  const related = memory.misconceptions.filter(
    (m) => m.concept.trim().toLowerCase() === top!.concept.toLowerCase(),
  );
  const unresolved = related.find((m) => m.status !== "resolved");
  // All named misconceptions for this concept are resolved → don't nag.
  if (related.length > 0 && !unresolved) return null;

  return {
    concept: top.concept,
    count: top.count,
    studentBelief: unresolved?.studentBelief,
    correctModel: unresolved?.correctModel,
  };
}

function mapCategory(cat: ErrorCategory): RememberedError["type"] {
  switch (cat) {
    case "conceptual":
      return "conceptual";
    case "model_selection":
      return "strategic";
    case "setup":
    case "procedural":
      return "procedural";
    case "arithmetic":
      return "arithmetic";
    case "units_notation":
      return "notation";
  }
}

/**
 * Fold a Check-My-Work diagnosis into the session memory so it counts toward
 * recurrence, don't-re-teach, and resolution — the check-work path runs through
 * a separate endpoint that doesn't round-trip memory, so we merge its already
 * structured result in on the client (no extra model tokens):
 *  - log the classified error against the problem's concept;
 *  - on a significant conceptual/strategic error, record/confirm a misconception;
 *  - when the attempt's concept is sound, mark it demonstrated and RESOLVE any
 *    open misconception on it (this clears a recurring flag — a retry that stuck).
 */
export function applyWorkCheckToMemory(
  memory: SessionMemory,
  check: WorkCheck,
  concept: string,
): SessionMemory {
  const c = concept.trim();
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const next: SessionMemory = {
    demonstrated: [...memory.demonstrated],
    misconceptions: memory.misconceptions.map((m) => ({ ...m })),
    errors: [...memory.errors],
    bottleneck: check.continueFrom || memory.bottleneck,
  };

  const err = check.firstError;
  const conceptSound = check.verdict === "correct" || (!!err && err.conceptCorrect);

  if (err && c) {
    next.errors.push({ type: mapCategory(err.category), concept: c });
    if (
      err.severity === "significant" &&
      !err.conceptCorrect &&
      (err.category === "conceptual" || err.category === "model_selection")
    ) {
      const open = next.misconceptions.find(
        (m) => eq(m.concept, c) && m.status !== "resolved",
      );
      if (open) open.status = "confirmed";
      else
        next.misconceptions.push({
          concept: c,
          studentBelief: err.explanation,
          correctModel: err.correction,
          status: "confirmed",
        });
    }
  }

  if (conceptSound && c) {
    if (!next.demonstrated.some((d) => eq(d, c))) next.demonstrated.push(c);
    for (const m of next.misconceptions) {
      if (eq(m.concept, c) && m.status !== "resolved") m.status = "resolved";
    }
  }

  return next;
}

/**
 * Mark a concept resolved after a successful targeted retry: add it to
 * `demonstrated` (so `detectRecurring` stops flagging it) and resolve any open
 * misconception on it.
 */
export function resolveMisconception(
  memory: SessionMemory,
  concept: string,
): SessionMemory {
  const c = concept.trim();
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const next: SessionMemory = {
    demonstrated: memory.demonstrated.some((d) => eq(d, c))
      ? [...memory.demonstrated]
      : [...memory.demonstrated, c],
    misconceptions: memory.misconceptions.map((m) =>
      eq(m.concept, c) && m.status !== "resolved"
        ? { ...m, status: "resolved" as const }
        : { ...m },
    ),
    errors: [...memory.errors],
    bottleneck: memory.bottleneck,
  };
  return next;
}

/** Record another failed attempt at a concept (a targeted retry that missed). */
export function recordConceptError(
  memory: SessionMemory,
  concept: string,
): SessionMemory {
  const c = concept.trim();
  if (!c) return memory;
  return {
    ...memory,
    errors: [...memory.errors, { type: "conceptual", concept: c }],
  };
}

/**
 * Did a practice attempt resolve the targeted misconception? True when the
 * concept-selection and reasoning axes are sound (execution/arithmetic slips are
 * allowed — the misconception is about the idea, not the algebra). A submission
 * with no shown work ("show solution") never counts as resolved.
 */
export function practiceResolved(evaluation: PracticeEvaluation): boolean {
  const status = (axis: PracticeAxis): RubricStatus | undefined =>
    evaluation.rubric.find((r) => r.axis === axis)?.status;
  const concept = status("concept_selection");
  if (!concept || concept === "not_shown") return false;
  if (evaluation.verdict === "correct") return true;
  const reasoning = status("reasoning");
  return (
    concept === "correct" &&
    (reasoning === "correct" || reasoning === "minor_issue")
  );
}

/**
 * A structured solution. The tutor only fills this in when the student
 * explicitly asks to see the full solution.
 */
export interface StructuredSolution {
  understanding: string;
  keyConcept: string;
  reasoning: string;
  solution: string;
  finalAnswer: string;
  takeaway: string;
}

/** One tutor turn: conversational text plus optional structured payloads. */
export interface TutorTurn {
  message: string;
  /** Present only when the student asked for the full worked solution. */
  solution?: StructuredSolution;
  /** Present only for the "try a similar problem" action. */
  similarProblem?: string;
  /**
   * True when the tutor deliberately stopped after one small piece and a natural
   * next piece remains — drives the "Continue" affordance. Only set for the
   * conceptual moves (ask / continue / hint / explain / go_deeper).
   */
  hasMore?: boolean;
  /**
   * The tutor's updated cross-turn memory. The conceptual moves return a freshly
   * updated one; other moves pass the incoming memory back unchanged. The client
   * stores it and sends it back on the next turn.
   */
  memory?: SessionMemory;
}

/**
 * One frame of a streamed tutor turn.
 *
 * `delta` carries display-only text decoded from the partial response and may
 * lag or differ slightly from the final text. `done` carries the validated turn
 * and is authoritative — the client replaces whatever it has accumulated with
 * `turn.message` when it arrives.
 */
export type TutorStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; turn: TutorTurn };

/** What the client sends to /api/tutor. */
export interface TutorRequest {
  problem: ProblemAnalysis;
  history: ChatMessage[];
  action: TutorAction;
  /** The student's typed text, for the "ask" action. */
  studentText?: string;
  /** Student preferences, folded into the system prompt when present. */
  preferences?: TutorPreferences;
  /** The tutor's memory from the previous turn, round-tripped for continuity. */
  memory?: SessionMemory;
}

// ---------------------------------------------------------------------------
// "Check My Work" mode
// ---------------------------------------------------------------------------

/**
 * Where the FIRST meaningful error sits, from most conceptual to most trivial.
 * The tutor diagnoses at the earliest/most-fundamental point that actually
 * matters — it does not just flag a wrong final answer, and it does not nitpick
 * trivial algebra when the reasoning above it is sound.
 */
export type ErrorCategory =
  | "conceptual" // wrong mental model / wrong physical assumption
  | "model_selection" // chose the wrong equation / principle for the problem
  | "setup" // right principle, but translated the problem into equations wrongly
  | "procedural" // a step in the method executed incorrectly
  | "arithmetic" // a number/algebra slip — trivial, mentioned briefly
  | "units_notation"; // units, sig figs, or notation only

export type CheckVerdict = "correct" | "partially_correct" | "error_found";

/** The single first meaningful error in the student's attempt. */
export interface WorkError {
  category: ErrorCategory;
  /**
   * "significant" = teach it (conceptual, model_selection, setup usually).
   * "minor" = correct it in a clause and move on (arithmetic, units, most
   * procedural). Drives how much the UI/tutor dwells on it.
   */
  severity: "minor" | "significant";
  /** Which step/line the first error is at (not the final answer). */
  location: string;
  /** Concise statement of what went wrong. May contain $math$. */
  explanation: string;
  /** The fix, and for significant errors WHY the right approach is right. */
  correction: string;
  /**
   * True when the underlying concept/principle was sound. When true the tutor
   * must NOT nitpick — it acknowledges the reasoning and keeps the correction
   * brief.
   */
  conceptCorrect: boolean;
}

/** The structured diagnosis of a student's attempt. */
export interface WorkCheck {
  verdict: CheckVerdict;
  /** One line on what the student did right (always present). */
  strengths: string;
  /** The first meaningful error. Absent only when verdict === "correct". */
  firstError?: WorkError;
  /** How to proceed from the corrected point. */
  continueFrom: string;
  /** Short overall message, shown as the tutor's reply text. */
  summary: string;
}

/** The student's attempted solution — typed text and/or a photo of their work. */
export interface StudentAttempt {
  /** Typed working, if any. */
  text?: string;
  /** Data URL of a photo of their handwritten work, if any. */
  imageDataUrl?: string;
}

/** What the client sends to /api/check-work. */
export interface CheckWorkRequest {
  problem: ProblemAnalysis;
  attempt: StudentAttempt;
}

// ---------------------------------------------------------------------------
// "I'm Ready — Give Me One Like This" practice mode
// ---------------------------------------------------------------------------

/**
 * A freshly generated practice problem. Client-facing and deliberately WITHOUT
 * the solution: the student must solve it independently and submit before the
 * worked solution is revealed (it comes back only in the evaluation).
 */
export interface PracticeProblem {
  problemText: string;
  subject: Subject;
  topic: string;
  /** The underlying concept it tests — the same one as the original problem. */
  concept: string;
  /** Relative to the original: matches it, or slightly exceeds it. */
  difficulty: "same" | "slightly_harder";
}

/** The five axes the tutor evaluates a submitted attempt against. */
export type PracticeAxis =
  | "concept_selection"
  | "reasoning"
  | "setup"
  | "execution"
  | "final_answer";

export type RubricStatus = "correct" | "minor_issue" | "incorrect" | "not_shown";

export interface RubricResult {
  axis: PracticeAxis;
  status: RubricStatus;
  /** Short note for this axis. */
  note: string;
}

/** The tutor's evaluation of a practice attempt, with the solution revealed. */
export interface PracticeEvaluation {
  verdict: "correct" | "partially_correct" | "incorrect";
  /** All five axes, in display order. */
  rubric: RubricResult[];
  /** The single most important thing to fix or reinforce — concise. */
  focus: string;
  /** One-line overall message. */
  summary: string;
  /** Revealed only now, after the student has submitted. */
  solution: StructuredSolution;
}

/**
 * A specific misconception to target when generating practice — used by the
 * retry→verify loop so the problem is engineered to expose THIS gap, not just
 * the source problem's concept in general.
 */
export interface PracticeFocus {
  concept: string;
  studentBelief?: string;
  correctModel?: string;
}

/** What the client sends to /api/practice/generate. */
export interface GeneratePracticeRequest {
  problem: ProblemAnalysis;
  /** When present, engineer the problem to probe this exact misconception. */
  focus?: PracticeFocus;
}

/** What the client sends to /api/practice/evaluate. */
export interface EvaluatePracticeRequest {
  practice: PracticeProblem;
  /** The student's attempt. Empty attempt = "just show me the solution". */
  attempt: StudentAttempt;
}
