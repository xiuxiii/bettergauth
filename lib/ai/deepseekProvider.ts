import "server-only";

import {
  ProviderNotImplementedError,
  type AIProvider,
} from "@/lib/ai/types";
import type {
  AnalyzeRequest,
  CheckWorkRequest,
  CheckWorkStreamEvent,
  DetectQuestionsRequest,
  EvaluatePracticeRequest,
  GeneratePracticeRequest,
  PracticeEvaluation,
  PracticeProblem,
  ProblemAnalysis,
  ProgressRequest,
  QuestionDetection,
  TutorRequest,
  TutorStreamEvent,
  TutorTurn,
  WorkCheck,
} from "@/lib/tutor/types";

/**
 * DeepSeek — a reserved slot, not an implementation yet.
 *
 * Selected with `AI_PROVIDER=deepseek` + `DEEPSEEK_API_KEY`. The factory,
 * config and /api/health reporting are real; every method below throws
 * `ProviderNotImplementedError`, which the routes turn into a 501 that says to
 * switch back to anthropic.
 *
 * Open decisions for the real implementation:
 *   - Transport. DeepSeek serves an OpenAI-compatible API at
 *     https://api.deepseek.com and an Anthropic-compatible one at
 *     https://api.deepseek.com/anthropic. The second could reuse most of
 *     AnthropicProvider with a different `baseURL`; check which of its
 *     features (structured output parsing, thinking/effort) that endpoint
 *     honours before relying on it.
 *   - Vision. DeepSeek's API models are text-only. detectQuestions,
 *     analyzeProblem (photo), and checkWork / evaluatePractice with a photo of
 *     work need a fallback — e.g. delegate those to AnthropicProvider when an
 *     Anthropic key is also set — or a clear "type the problem" error.
 *   - Thinking. `thinkingFor` in anthropicProvider.ts is Claude-specific;
 *     deepseek-reasoner is the rough equivalent for checkWork /
 *     show_solution / evaluatePractice.
 */
export class DeepSeekProvider implements AIProvider {
  readonly name = "deepseek";
  // Held for the real implementation; unused while every method is a stub.
  readonly model: string;
  readonly baseURL: string;
  private readonly apiKey: string;

  constructor(config: { apiKey: string; model?: string; baseURL?: string }) {
    if (!config.apiKey) {
      throw new Error(
        "DeepSeekProvider requires an API key (set DEEPSEEK_API_KEY).",
      );
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? "deepseek-chat";
    this.baseURL = config.baseURL ?? "https://api.deepseek.com";
  }

  private notImplemented(method: string): never {
    throw new ProviderNotImplementedError(this.name, method);
  }

  async detectQuestions(_request: DetectQuestionsRequest): Promise<QuestionDetection> {
    return this.notImplemented("detectQuestions");
  }

  async analyzeProblem(_request: AnalyzeRequest): Promise<ProblemAnalysis> {
    return this.notImplemented("analyzeProblem");
  }

  async summarizeProgress(_request: ProgressRequest): Promise<string> {
    return this.notImplemented("summarizeProgress");
  }

  async tutor(_request: TutorRequest): Promise<TutorTurn> {
    return this.notImplemented("tutor");
  }

  // Both streams throw on the first next(). /api/check-work awaits that before
  // committing to a 200, so it gets the 501; /api/tutor reports it in-stream.
  // Either way analyzeProblem fails first, so neither is reached in practice.
  async *tutorStream(_request: TutorRequest): AsyncGenerator<TutorStreamEvent> {
    this.notImplemented("tutorStream");
  }

  async checkWork(_request: CheckWorkRequest): Promise<WorkCheck> {
    return this.notImplemented("checkWork");
  }

  async *checkWorkStream(
    _request: CheckWorkRequest,
  ): AsyncGenerator<CheckWorkStreamEvent, void, unknown> {
    this.notImplemented("checkWorkStream");
  }

  async generatePractice(_request: GeneratePracticeRequest): Promise<PracticeProblem> {
    return this.notImplemented("generatePractice");
  }

  async evaluatePractice(
    _request: EvaluatePracticeRequest,
  ): Promise<PracticeEvaluation> {
    return this.notImplemented("evaluatePractice");
  }
}
