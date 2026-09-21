import type {
  AnalyzeRequest,
  CheckWorkRequest,
  DetectQuestionsRequest,
  EvaluatePracticeRequest,
  GeneratePracticeRequest,
  PracticeEvaluation,
  PracticeProblem,
  ProblemAnalysis,
  QuestionDetection,
  TutorRequest,
  TutorStreamEvent,
  TutorTurn,
  WorkCheck,
} from "@/lib/tutor/types";

/**
 * The provider abstraction — the single contract every model backend implements
 * (the real vision-capable provider today; another backend could be added
 * later). It is intentionally uniform: each
 * method takes ONE typed request and returns ONE typed domain object. The
 * frontend and API routes only ever see these domain types (in @/lib/tutor/
 * types), never a model's raw response — a real provider is responsible for
 * mapping the model output into them inside lib/ai/, so swapping providers never
 * touches the UI. Everything that constructs a provider is server-only, so API
 * keys are never bundled to the client.
 *
 * The methods below cover every capability the real system needs:
 *   detectQuestions → image input · locate each question on a page (for the
 *                     capture-time crop step)
 *   analyzeProblem  → image input · problem extraction · subject/topic
 *                     classification · concept identification
 *   tutor           → tutoring responses · follow-up questions
 *   checkWork       → student attempt analysis (Check My Work)
 *   generatePractice→ similar-problem generation
 *   evaluatePractice→ practice attempt evaluation
 */
export interface AIProvider {
  readonly name: string;

  /**
   * Locate the individual questions in a photo of a page so the student can
   * crop to one before analysis. Returns normalised bounding boxes.
   */
  detectQuestions(request: DetectQuestionsRequest): Promise<QuestionDetection>;

  /**
   * Analyze an uploaded problem image into structured text + classification +
   * the identified governing concept.
   */
  analyzeProblem(request: AnalyzeRequest): Promise<ProblemAnalysis>;

  /** Produce the next tutor turn given the problem and conversation so far. */
  tutor(request: TutorRequest): Promise<TutorTurn>;

  /**
   * The same conceptual-move turn, delivered progressively.
   *
   * Yields display-only `delta` frames while the model is still writing, then
   * exactly one authoritative `done` frame carrying the validated turn. Only
   * the conceptual moves stream; `show_solution` and `similar_problem` go
   * through `tutor()`, since their payloads are cards that are only meaningful
   * complete.
   */
  tutorStream(request: TutorRequest): AsyncGenerator<TutorStreamEvent>;

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
