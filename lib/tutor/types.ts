// Domain types shared across UI, tutoring logic, and the AI provider layer.
// Kept provider-agnostic on purpose so a real model can be swapped in later.

export type Subject =
  | "Physics"
  | "Chemistry"
  | "Biology"
  | "Mathematics"
  | "Unknown";

/** Result of analyzing an uploaded problem image. */
export interface ProblemAnalysis {
  /** The problem text as detected from the image (OCR in a real provider). */
  problemText: string;
  subject: Subject;
  /** A finer-grained topic, e.g. "Conservation of energy". */
  topic: string;
  /** 0..1 confidence that the detection is correct. */
  confidence: number;
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
 * Explicit actions the student can trigger. Free-form questions use "ask".
 * The tutoring engine maps each to a different pedagogical intent.
 */
export type TutorAction =
  | "ask"
  | "hint"
  | "explain"
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
