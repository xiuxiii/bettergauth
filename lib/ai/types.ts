import type {
  CheckWorkRequest,
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
}
