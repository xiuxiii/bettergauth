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
}

/**
 * What the client sends to /api/analyze. The image is a data URL so it carries
 * its own media type; a real provider splits it into base64 + media_type for
 * the model's image content block.
 */
export interface AnalyzeRequest {
  /** `data:<mediaType>;base64,<data>` URL of the problem photo/upload. */
  imageDataUrl: string;
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
 * tutor engine (the mock's `tutor()`, a real model later), alongside free-form
 * "ask". They form a rough ladder of assistance:
 *   hint (least) → explain → go_deeper → show_solution (most), plus
 *   similar_problem (a lateral "test my understanding" move).
 */
export type TutorAction =
  | "ask"
  | "hint"
  | "explain"
  | "go_deeper"
  | "show_solution"
  | "similar_problem";

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
}

/** What the client sends to /api/tutor. */
export interface TutorRequest {
  problem: ProblemAnalysis;
  history: ChatMessage[];
  action: TutorAction;
  /** The student's typed text, for the "ask" action. */
  studentText?: string;
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

/** What the client sends to /api/practice/generate. */
export interface GeneratePracticeRequest {
  problem: ProblemAnalysis;
}

/** What the client sends to /api/practice/evaluate. */
export interface EvaluatePracticeRequest {
  practice: PracticeProblem;
  /** The student's attempt. Empty attempt = "just show me the solution". */
  attempt: StudentAttempt;
}
