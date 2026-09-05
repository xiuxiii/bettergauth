import "server-only";

import type { AIProvider } from "@/lib/ai/types";
import type {
  AnalyzeRequest,
  CheckWorkRequest,
  EvaluatePracticeRequest,
  GeneratePracticeRequest,
  PracticeEvaluation,
  PracticeProblem,
  ProblemAnalysis,
  TutorTurn,
  TutorRequest,
  WorkCheck,
} from "@/lib/tutor/types";
// TODO(real-api): when wiring the real model, uncomment after
//   `npm install @anthropic-ai/sdk`:
//     import Anthropic from "@anthropic-ai/sdk";
//     import { SYSTEM_INSTRUCTIONS } from "@/lib/tutor/engine";
// Keep this file free of the SDK import until then so the app builds without
// the dependency and `AI_PROVIDER=mock` stays the zero-config default.

/**
 * ============================================================================
 *  REAL PROVIDER STUB — this is exactly where the real vision model plugs in.
 * ============================================================================
 *
 * `AnthropicProvider` implements the same `AIProvider` contract the mock does.
 * The frontend and API routes are already decoupled: they only consume the
 * domain types in `@/lib/tutor/types`. This class's ONLY job is to turn each
 * request into a Claude call and MAP the model's raw output back into those
 * domain types. Never return raw model JSON past this boundary.
 *
 * Recommended model: `claude-opus-5` (vision-capable). Any vision-capable model
 * that can return structured JSON can implement this same interface.
 *
 * How to finish each method (same pattern throughout):
 *   1. Build a request to `client.messages` with:
 *        - system: the tutoring instructions (SYSTEM_INSTRUCTIONS from
 *          lib/tutor/engine.ts for tutoring/analysis; a task-specific system
 *          prompt for check-work / practice).
 *        - user content: text + (for image inputs) an image content block built
 *          from the data URL via `dataUrlToImagePart()` below.
 *   2. Constrain the output to the exact domain shape with Structured Outputs
 *        — `output_config: { format: { type: "json_schema", schema } }`, or
 *        `client.messages.parse({ ..., output_config })` — using a JSON schema
 *        (or Zod schema) that mirrors the return type.
 *   3. Validate and return the parsed object as the domain type. On refusal or
 *        error, throw; the API route already translates that to a 4xx/5xx.
 *
 * See docs/ai-provider-integration.md for the full field-by-field schema and
 * the end-to-end call shapes.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";

  // TODO(real-api): hold the SDK client, e.g. `private client: Anthropic;`
  private readonly model: string;

  constructor(config: { apiKey: string; model?: string }) {
    if (!config.apiKey) {
      throw new Error(
        "AnthropicProvider requires an API key (set ANTHROPIC_API_KEY).",
      );
    }
    this.model = config.model ?? "claude-opus-5";
    // TODO(real-api): this.client = new Anthropic({ apiKey: config.apiKey });
    void this.model; // referenced once the methods are implemented
  }

  // ---- image input · problem extraction · classification · concept id -------
  async analyzeProblem(_request: AnalyzeRequest): Promise<ProblemAnalysis> {
    // TODO(real-api): one vision call.
    //   const { mediaType, data } = dataUrlToImagePart(_request.imageDataUrl);
    //   const res = await this.client.messages.create({
    //     model: this.model, max_tokens: 1024,
    //     system: "Extract the STEM problem from the image and classify it.",
    //     messages: [{ role: "user", content: [
    //       { type: "image", source: { type: "base64", media_type: mediaType, data } },
    //       { type: "text", text: "Return problemText, subject, topic, concept, confidence." },
    //     ]}],
    //     output_config: { format: { type: "json_schema", schema: PROBLEM_ANALYSIS_SCHEMA } },
    //   });
    //   return parseInto<ProblemAnalysis>(res); // validate → domain type
    return this.notImplemented("analyzeProblem");
  }

  // ---- tutoring responses · follow-up questions -----------------------------
  async tutor(_request: TutorRequest): Promise<TutorTurn> {
    // TODO(real-api): pass SYSTEM_INSTRUCTIONS as `system`; render the problem +
    // history as messages; map `_request.action` (hint/explain/go_deeper/
    // show_solution/similar_problem/ask) into the user turn. Constrain output to
    // the TutorTurn shape (message + optional solution / similarProblem).
    return this.notImplemented("tutor");
  }

  // ---- student attempt analysis (Check My Work) -----------------------------
  async checkWork(_request: CheckWorkRequest): Promise<WorkCheck> {
    // TODO(real-api): send the problem + the attempt (text and/or an image block
    // from _request.attempt.imageDataUrl). Instruct the model to find the FIRST
    // meaningful error, classify it (the ErrorCategory union), and not nitpick a
    // correct concept. Constrain output to the WorkCheck shape.
    return this.notImplemented("checkWork");
  }

  // ---- similar-problem generation -------------------------------------------
  async generatePractice(
    _request: GeneratePracticeRequest,
  ): Promise<PracticeProblem> {
    // TODO(real-api): generate a fresh problem on the same concept, changed
    // numbers/context, matching or slightly harder. Constrain to PracticeProblem
    // — and DO NOT include a solution (the student solves it first).
    return this.notImplemented("generatePractice");
  }

  async evaluatePractice(
    _request: EvaluatePracticeRequest,
  ): Promise<PracticeEvaluation> {
    // TODO(real-api): evaluate the submitted attempt across the five axes, focus
    // feedback on the most important issue, and include the worked solution.
    // Constrain output to the PracticeEvaluation shape.
    return this.notImplemented("evaluatePractice");
  }

  private notImplemented(method: string): never {
    throw new Error(
      `AnthropicProvider.${method}() is not implemented yet. ` +
        `Follow the TODO in lib/ai/anthropicProvider.ts and ` +
        `docs/ai-provider-integration.md, then set AI_PROVIDER=anthropic.`,
    );
  }
}

/**
 * Split a `data:<mediaType>;base64,<data>` URL into the parts Claude's image
 * content block needs. This is real and ready to use — image handling doesn't
 * depend on the SDK.
 */
export function dataUrlToImagePart(dataUrl: string): {
  mediaType: string;
  data: string;
} {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error("Expected a base64 data URL (data:<mediaType>;base64,<data>).");
  }
  return { mediaType: match[1], data: match[2] };
}
