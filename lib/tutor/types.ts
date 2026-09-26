// Domain types shared across UI, tutoring logic, and the AI provider layer.
// Kept provider-agnostic on purpose so a real model can be swapped in later.

import { canonicalConcept } from "@/lib/tutor/concepts";

export type Subject =
  | "Physics"
  | "Chemistry"
  | "Biology"
  | "Mathematics"
  | "Unknown";

/** Result of analyzing an uploaded problem image (problem extraction + classification). */
export interface ProblemAnalysis {
  /**
   * False when the photo holds no study material at all. Optional because
   * sessions saved to history before this existed don't carry it — and absent
   * is read as true, so an old record never reopens as "not a question".
   */
  hasStemContent?: boolean;
  /** The problem text as detected from the image (OCR in a real provider). */
  problemText: string;
  /** Subject classification. */
  subject: Subject;
  /** A finer-grained topic, e.g. "Conservation of energy". */
  topic: string;
  /**
   * A SAFE label for the idea area, 2-5 words — "Projectile time of flight" —
   * shown on the problem card before the student has worked anything.
   *
   * It must never name the method or the fix. It used to be the full governing
   * insight ("…using the vertical component of initial velocity"), which put
   * the student's exact error on screen before any tutoring.
   *
   * It is also the KEY for all concept tracking: memory errors, misconceptions
   * and `demonstrated`, and from those the History ranking, RecurringBanner and
   * targeted practice. A short stable label is what lets the same gap match
   * across two different problems; a long insight sentence almost never did.
   */
  concept: string;
  /**
   * The governing insight the problem hinges on. Given to the tutor, but shown
   * to the student only once the gap is resolved or a solution was requested.
   * Optional because records saved before the split don't have it — read them
   * through `normalizeAnalysis`.
   */
  keyIdea?: string;
  /** 0..1 confidence that the detection is correct. */
  confidence: number;
  /**
   * Whether the photo already contains the student's own handwritten attempt.
   * They frequently shoot a problem they have already worked on, so the session
   * opens by diagnosing it instead of inviting them to start.
   *
   * Handwriting only: a printed worked example or answer key on the same page is
   * part of the question, not an attempt. Deliberately just a flag — the
   * diagnosis reads the photo itself rather than a transcription, because a
   * transcription turns every misread stroke into a step the tutor then
   * "corrects" the student for never having written.
   */
  studentWork: {
    present: boolean;
  };
  /**
   * TYPED input only: the student's own working, copied verbatim out of what
   * they typed and kept out of `problemText`. A typed attempt has no photo for
   * the check to read, so this is what gets checked. Empty for photos, where
   * the transcription problem above still applies.
   */
  attemptText?: string;
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
  imageDataUrl?: string;
  /** A problem typed or pasted instead of photographed. One of the two is set. */
  problemText?: string;
}

/**
 * Bring an analysis from any era up to the current shape.
 *
 * Records saved before the concept/keyIdea split carry the full insight in
 * `concept` — exactly the spoiler the split exists to hide. So when `keyIdea`
 * is missing, the old `concept` moves into the hidden `keyIdea` and the
 * broader `topic` becomes the visible label. Old memory entries keep their old
 * long keys; they just won't merge with new short labels, and nothing breaks.
 */
export function normalizeAnalysis(a: ProblemAnalysis): ProblemAnalysis {
  if (typeof a.keyIdea === "string") return a;
  return {
    ...a,
    keyIdea: a.concept,
    concept: a.topic?.trim() || "This problem",
  };
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
  /**
   * Whether the student's own handwritten working sits in this question's box.
   * Only a hint for timing: when true, the workspace starts the work check in
   * parallel with the analysis instead of after it. Analysis still decides.
   */
  hasWorking?: boolean;
}

/** What the client sends to /api/detect-questions. */
export interface DetectQuestionsRequest {
  imageDataUrl: string;
  /**
   * Pixel dimensions of that image. The model is asked for boxes in absolute
   * pixels, because it is measurably worse at normalised coordinates, so these
   * are needed both to tell it the bounds and to convert its answer back.
   */
  width: number;
  height: number;
}

/**
 * The questions found in a photo, top-to-bottom, and which one the student
 * most likely wants. Empty `questions` means nothing distinct was found and
 * the whole photo should be offered as the crop.
 */
export interface QuestionDetection {
  /**
   * False when the photo holds no study material at all (food, a room, an
   * accidental shot). Only an explicit false means "not a question": a missing
   * value is treated as true, so a malformed response never blocks real work.
   */
  hasStemContent: boolean;
  questions: DetectedQuestion[];
  /** Index into `questions` of the most likely intended question. */
  primaryIndex: number;
  /**
   * Only when the client asks (`debug: true`, from `?debug=boxes`): what the
   * model actually returned, before normalizing, so a misplaced box can be
   * traced to a coordinate-space bug or to the model misreading the page.
   */
  debug?: DetectionDebug;
}

export interface DetectionDebug {
  model: string;
  /** The image size the model was told, and the coordinates' bounds. */
  width: number;
  height: number;
  raw: { label: string; x1: number; y1: number; x2: number; y2: number }[];
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
  /** Ask mode's opening turn: a direct question about a photo, answered as an
   *  explanation rather than bounced back as a hint. */
  | "question"
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
  /**
   * Which course family the student is in, so the tutor uses its terms. Only
   * vocabulary and notation — never a basis to assume syllabus content.
   */
  curriculum?: "standard" | "ib" | "ap" | null;
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

/**
 * One concept from the on-device ranking, sent to the model for a write-up.
 *
 * Text only, deliberately: no images and no transcripts, so the summary call
 * stays cheap enough to be worth offering on demand.
 */
export interface ProgressConcept {
  concept: string;
  errors: number;
  problems: number;
  types: string[];
  studentBelief?: string;
  correctModel?: string;
}

/** What the client sends to /api/progress. */
export interface ProgressRequest {
  concepts: ProgressConcept[];
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
 *  - log the classified error against the check's canonical concept;
 *  - on a significant conceptual/strategic error, record/confirm a misconception;
 *  - when the attempt's concept is sound, mark it demonstrated and RESOLVE any
 *    open misconception on it (this clears a recurring flag — a retry that stuck).
 */
export function applyWorkCheckToMemory(
  memory: SessionMemory,
  check: WorkCheck,
  fallbackConcept: string,
): SessionMemory {
  // Keyed on the check's own canonical label: the gap it found, not the
  // problem's topic. The fallback covers older checks, and only counts when it
  // is itself a canonical label — a free-text topic would never merge.
  const c =
    canonicalConcept(check.concept) ?? canonicalConcept(fallbackConcept) ?? "";
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const next: SessionMemory = {
    demonstrated: [...memory.demonstrated],
    misconceptions: memory.misconceptions.map((m) => ({ ...m })),
    errors: [...memory.errors],
    bottleneck: check.continueFrom || memory.bottleneck,
  };

  const err = check.firstError;
  // What counts as the concept being sound is decided HERE, from the verdict
  // and the category — not from a flag the model sets alongside the category.
  // That flag once came back "concept is right" on a components error tagged
  // "setup", and recorded the student's misconception as mastered.
  //
  // A clean verdict (including a correct retry) demonstrates the concept. So
  // does a pure slip: an arithmetic or units error made while applying the
  // right idea is not evidence against the idea.
  const pureSlip =
    !!err && (err.category === "arithmetic" || err.category === "units_notation");
  const conceptSound = check.verdict === "correct" || pureSlip;

  if (err && c) {
    next.errors.push({ type: mapCategory(err.category), concept: c });
    if (
      err.severity === "significant" &&
      (err.category === "conceptual" || err.category === "model_selection")
    ) {
      const open = next.misconceptions.find(
        (m) => eq(m.concept, c) && m.status !== "resolved",
      );
      if (open) open.status = "confirmed";
      else
        next.misconceptions.push({
          concept: c,
          studentBelief: err.diagnosis,
          correctModel: err.fix,
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

/**
 * The single first meaningful error, split into the pieces the student reveals
 * one tap at a time.
 *
 * Each field is written to stand on its own. The old contract asked for
 * `explanation` + `correction` as prose meant to be read in full, so the only
 * way to stage it was to hide parts of a block that gave everything away in its
 * first sentence.
 */
export interface WorkError {
  category: ErrorCategory;
  /**
   * "significant" = teach it (conceptual, model_selection, setup usually).
   * "minor" = correct it in a clause and move on (arithmetic, units, most
   * procedural).
   */
  severity: "minor" | "significant";
  /** The flagged line quoted as the student wrote it; "" when illegible. */
  line: string;
  /** Where the error is and what kind — never the fix. */
  locate: string;
  /** ONE question aimed at the gap. Must not contain the fix. */
  nudge: string;
  /** What the student's work assumes. Hidden until the fix is revealed. */
  diagnosis: string;
  /** The corrected idea/step. Must NOT contain the final answer. */
  fix: string;
}

/**
 * The structured diagnosis of a student's attempt.
 *
 * There is deliberately no "concept was right" flag any more. It contradicted
 * the category often enough (a components error tagged "setup" + "concept is
 * right") that the student saw two verdicts — and it fed memory, where it
 * recorded exactly that misconception as DEMONSTRATED.
 */
export interface WorkCheck {
  verdict: CheckVerdict;
  /** One sentence. No fix, no answer. */
  headline: string;
  /** One short line on what the student did right; may be empty. */
  strength: string;
  /** The first meaningful error. Absent when verdict === "correct". */
  firstError?: WorkError;
  /** The rest of the way from the corrected point — the ONLY field that may
   *  contain the final answer. */
  continueFrom: string;
  /**
   * The canonical label (lib/tutor/concepts.ts) for the idea the attempt
   * hinges on — for an error, the idea the FIRST error is about. This, not
   * the problem's own concept, is what the gap is tracked under, so the same
   * mistake merges across problems. Absent on checks saved before it existed.
   */
  concept?: string;
}

/**
 * Bring a stored check from any era up to the current shape.
 *
 * Checks saved before the step-by-step reveal carry `strengths`, `summary`
 * and an error with `location` / `explanation` / `correction`. Those map onto
 * the new pieces; the ones that never existed (`line`, `nudge`) come back
 * empty, and the card skips empty pieces, so an old record still reaches
 * every step it has.
 */
export function normalizeWorkCheck(raw: unknown): WorkCheck {
  const c = (raw ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  const e = c.firstError as Record<string, unknown> | null | undefined;
  const verdict: CheckVerdict =
    c.verdict === "correct" || c.verdict === "partially_correct"
      ? c.verdict
      : "error_found";
  return {
    verdict,
    headline: s(c.headline) || s(c.summary),
    strength: s(c.strength) || s(c.strengths),
    firstError: e
      ? {
          category: (e.category as ErrorCategory) ?? "conceptual",
          severity: e.severity === "minor" ? "minor" : "significant",
          line: s(e.line),
          locate: s(e.locate) || s(e.location),
          nudge: s(e.nudge),
          diagnosis: s(e.diagnosis) || s(e.explanation),
          fix: s(e.fix) || s(e.correction),
        }
      : undefined,
    continueFrom: s(c.continueFrom),
    concept: s(c.concept) || undefined,
  };
}

/** Progress frames streamed by /api/check-work, then exactly one result. */
export type CheckWorkStreamEvent =
  | { type: "stage"; stage: "thinking" | "writing" }
  | { type: "done"; check: WorkCheck };

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
  /**
   * Set when this is a second go at a step already flagged, so the check
   * judges that step first instead of re-diagnosing the whole problem.
   */
  retryOf?: {
    line: string;
    locate: string;
    category: ErrorCategory;
  };
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
