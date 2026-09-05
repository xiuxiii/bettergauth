import type {
  CheckWorkRequest,
  EvaluatePracticeRequest,
  GeneratePracticeRequest,
  PracticeEvaluation,
  PracticeProblem,
  ProblemAnalysis,
  TutorRequest,
  TutorTurn,
  WorkCheck,
} from "@/lib/tutor/types";

/**
 * The provider abstraction. Any model backend (mock now, a real LLM later)
 * implements this interface. Everything above this line is provider-agnostic;
 * everything that constructs a provider lives server-side only, so API keys
 * are never bundled to the client.
 */
export interface AIProvider {
  readonly name: string;

  /** Analyze an uploaded problem image (data URL) into structured text. */
  analyzeProblem(imageDataUrl: string): Promise<ProblemAnalysis>;

  /** Produce the next tutor turn given the problem and conversation so far. */
  tutor(request: TutorRequest): Promise<TutorTurn>;

  /**
   * "Check My Work": diagnose a student's attempted solution. Returns the FIRST
   * meaningful error (classified), what was done right, and how to continue —
   * not merely whether the final answer is wrong.
   */
  checkWork(request: CheckWorkRequest): Promise<WorkCheck>;

  /**
   * Practice mode — generate a fresh problem testing the same concept as the
   * original, with changed numbers/context so memorization is useless, at
   * matching or slightly higher difficulty. The solution is intentionally NOT
   * included so the student solves it independently first.
   */
  generatePractice(request: GeneratePracticeRequest): Promise<PracticeProblem>;

  /**
   * Evaluate a submitted practice attempt across five axes (concept selection,
   * reasoning, setup, execution, final answer), give concise feedback on the
   * most important issue, and reveal the worked solution.
   */
  evaluatePractice(
    request: EvaluatePracticeRequest,
  ): Promise<PracticeEvaluation>;
}
