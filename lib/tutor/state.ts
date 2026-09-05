/**
 * The tutoring engine's working memory.
 *
 * `TutorState` is the tutor's structured, evolving model of (a) the problem and
 * (b) the student. A real AI provider is given this object (as JSON) alongside
 * the conversation, updates it every turn from what the student just said/did,
 * and uses it to choose the next move. Making the model explicit — rather than
 * leaving it implicit in the chat history — is what lets the tutor adapt depth,
 * avoid re-teaching, and target the actual bottleneck.
 *
 * These types are provider-agnostic and deliberately serializable: the same
 * object round-trips through the API on every turn (see docs/tutoring-engine.md,
 * "State read/write protocol").
 */

// ---------------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------------

/** How well the student understands a concept, inferred from evidence. */
export type UnderstandingLevel =
  | "unknown" // no evidence yet — the default; NOT the same as "beginner"
  | "low" // misapplies or cannot use it
  | "developing" // partial / shaky / inconsistent
  | "solid" // uses it correctly and deliberately
  | "mastered"; // uses it fluently, can justify and transfer it

/**
 * Classification of a student error. The tutor's response depends entirely on
 * this: strategic/conceptual errors get taught; the rest get corrected in a
 * clause and left behind.
 */
export type MistakeType =
  | "none"
  | "careless" // knows better; a slip (dropped unit, transcription)
  | "arithmetic" // 7×8, a decimal — trivial, correct inline
  | "algebraic" // sign flip, mis-distribution — trivial, correct inline
  | "notation" // sloppy but not wrong thinking
  | "conceptual" // wrong mental model of a concept — TEACH
  | "strategic"; // chose the wrong principle/model for the problem — TEACH (highest value)

/** Can the student make progress on their own right now? */
export type SelfSufficiency =
  | "blocked" // cannot proceed without help
  | "needs_nudge" // one pointer will unblock them
  | "independent"; // can and should continue alone

/** What the student is actually here for on this turn. */
export type SessionGoal =
  | "understand" // wants to learn the idea (default)
  | "get_answer" // wants the solution now
  | "practice" // wants another problem to try
  | "check_work"; // wants their attempt verified

/**
 * Explanation depth for the next message. Depth modulates every move; it is a
 * dial, not a move of its own.
 *   0 minimal   — one line, no scaffolding (strong student / trivial step)
 *   1 standard  — the idea plus the one reason it matters (default)
 *   2 expanded  — idea + mechanism + a concrete instance
 *   3 deep      — build from a lower-level concept; analogy + example + check
 */
export type Depth = 0 | 1 | 2 | 3;

export type Signal = "low" | "medium" | "high";

// ---------------------------------------------------------------------------
// The moves the tutor can choose from (its action space)
// ---------------------------------------------------------------------------

/**
 * Exactly one primary move is chosen per turn. These are the tutor's internal
 * decisions; they are broader than the UI's `TutorAction` buttons (which are
 * just student-triggered shortcuts that map onto some of these).
 */
export type TutorMove =
  | "explain" // state the idea directly
  | "conceptual_question" // ask ONE targeted question about a decision point
  | "hint" // smallest nudge that unblocks the next step
  | "address_misconception" // name the wrong model, contrast, correct it
  | "worked_example" // demonstrate on a small parallel instance
  | "let_continue" // acknowledge and hand control back
  | "complete_solution" // full structured worked solution
  | "similar_problem" // generate a fresh practice problem
  | "consolidate"; // one-line takeaway that locks in the concept

// ---------------------------------------------------------------------------
// Problem model
// ---------------------------------------------------------------------------

export interface ProblemModel {
  subject: string; // "Physics"
  topic: string; // "Conservation of mechanical energy"
  /** The one principle/model recognizing this problem hinges on. */
  principle: string; // "Mechanical energy is conserved when only conservative forces act"
  /** Concepts a correct solution requires the student to command. */
  requiredConcepts: string[];
  /** Assumptions the problem quietly relies on — prime targets for teaching. */
  assumptions: string[]; // ["frictionless surface", "point mass", "g constant"]
  answerType: "numeric" | "symbolic" | "proof" | "explanation" | "multiple_choice";
  difficulty: "foundational" | "standard" | "challenging" | "olympiad";
  /**
   * The decision points of a solution — NOT the arithmetic. Used to locate the
   * student on the path and to know what "the next step" is.
   */
  solutionOutline: string[];
}

// ---------------------------------------------------------------------------
// Student model
// ---------------------------------------------------------------------------

export interface ConceptState {
  concept: string;
  level: UnderstandingLevel;
  /** What the student said/did that justifies this level (keeps it honest). */
  evidence: string;
  updatedTurn: number;
}

export type MisconceptionStatus =
  | "suspected" // hinted at once; not yet confirmed
  | "confirmed" // clearly demonstrated
  | "resolving" // addressed; awaiting confirmation it stuck
  | "resolved";

export interface Misconception {
  id: string;
  concept: string;
  /** The student's wrong model, in plain terms. */
  studentBelief: string; // "heavier objects fall faster"
  correctModel: string; // "in free fall all masses accelerate equally at g"
  status: MisconceptionStatus;
  evidenceTurn: number;
}

export interface ErrorEvent {
  turn: number;
  type: MistakeType;
  concept: string;
  description: string;
}

export interface Affect {
  frustration: Signal;
  confidence: Signal;
  engagement: Signal;
}

export interface StudentModel {
  /** Rolling overall estimate. Starts "unknown" — assume capable, not beginner. */
  overallLevel: UnderstandingLevel;
  /** Per-concept understanding, the backbone of "don't re-teach what they know". */
  concepts: ConceptState[];
  /** Things the student has PROVEN they know this session. Never re-explain these. */
  demonstrated: string[];
  misconceptions: Misconception[];
  /** Every classified error, so repetition on one concept can raise depth. */
  errors: ErrorEvent[];
  selfSufficiency: SelfSufficiency;
  affect: Affect;
  /** Standing instructions from the student, e.g. "hint only", "in a hurry". */
  explicitSignals: string[];
  pace: "fast" | "moderate" | "careful";
}

// ---------------------------------------------------------------------------
// Session model
// ---------------------------------------------------------------------------

export type BottleneckKind =
  | "principle_selection" // hasn't chosen / chose the wrong model — highest value
  | "concept" // a required concept is weak
  | "assumption" // hasn't recognized an assumption
  | "interpretation" // can't read the result's meaning
  | "procedure" // stuck on execution (usually low value to dwell on)
  | "none"; // no blocker — student is moving

export interface Bottleneck {
  kind: BottleneckKind;
  concept?: string;
  description: string;
}

export interface MoveRecord {
  turn: number;
  move: TutorMove;
  targetConcept?: string;
}

export interface SessionState {
  goal: SessionGoal;
  /** The single thing blocking progress right now. The turn aims at this. */
  currentBottleneck: Bottleneck | null;
  depth: Depth;
  /** True once a full solution has been shown — don't keep gating afterward. */
  solutionRevealed: boolean;
  turn: number;
  moveHistory: MoveRecord[];
}

// ---------------------------------------------------------------------------
// The policy output for the upcoming turn
// ---------------------------------------------------------------------------

export interface NextAction {
  move: TutorMove;
  depth: Depth;
  targetConcept?: string;
  /** Private reasoning for the choice. NEVER shown to the student. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// The whole state
// ---------------------------------------------------------------------------

export interface TutorState {
  problem: ProblemModel;
  student: StudentModel;
  session: SessionState;
  /** What the tutor has decided to do next (set during the decision step). */
  next: NextAction | null;
}

/**
 * Build the initial state right after a problem is analyzed and before the
 * first tutor turn. The student model starts empty and "unknown" — the engine
 * fills it in from evidence rather than assuming a beginner.
 */
export function createInitialTutorState(
  problem: ProblemModel,
  goal: SessionGoal = "understand",
): TutorState {
  return {
    problem,
    student: {
      overallLevel: "unknown",
      concepts: [],
      demonstrated: [],
      misconceptions: [],
      errors: [],
      selfSufficiency: "needs_nudge",
      affect: { frustration: "low", confidence: "medium", engagement: "medium" },
      explicitSignals: [],
      pace: "moderate",
    },
    session: {
      goal,
      currentBottleneck: {
        kind: "principle_selection",
        description:
          "Student has not yet chosen the governing principle for the problem.",
      },
      depth: 1,
      solutionRevealed: false,
      turn: 0,
      moveHistory: [],
    },
    next: null,
  };
}
