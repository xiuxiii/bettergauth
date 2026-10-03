import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

import type { AIProvider } from "@/lib/ai/types";
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
  SessionMemory,
  TutorStreamEvent,
  TutorTurn,
  TutorRequest,
  WorkCheck,
} from "@/lib/tutor/types";
import { normalizeWorkCheck } from "@/lib/tutor/types";
import { createMessageFieldDecoder } from "@/lib/tutor/streamText";
import {
  ANALYZE_SYSTEM,
  CHECKWORK_SYSTEM,
  DETECT_SYSTEM,
  EVALUATE_SYSTEM,
  GENERATE_SYSTEM,
  PROGRESS_SYSTEM,
  PracticeEvaluationSchema,
  PracticeProblemSchema,
  ProblemAnalysisSchema,
  QuestionDetectionSchema,
  TutorChunkSchema,
  TutorSimilarSchema,
  TutorSolutionSchema,
  WorkCheckSchema,
  checkWorkText,
  detectUserText,
  evaluatePracticeText,
  generatePracticeText,
  guardNotStem,
  normalizeDetection,
  progressText,
  required,
  tutorSystemParts,
  tutorTurns,
} from "@/lib/ai/shared";

/**
 * Real vision-capable provider (Claude). Turns each request into a Claude call
 * and maps the structured response back into the app's domain types. The
 * frontend and API routes never see anything below this file.
 *
 * Structured outputs: every method constrains the model to the exact domain
 * shape with a Zod schema via `client.messages.parse` + `zodOutputFormat`, so
 * the parsed result is validated before it leaves this module. The schemas
 * and prompts themselves are shared with the DeepSeek provider (lib/ai/shared.ts).
 */

// --- Provider ---------------------------------------------------------------

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly model: string;
  /** Question detection only — see DETECTION_MODEL in the constructor. */
  private readonly detectionModel: string;

  constructor(config: { apiKey: string; model?: string; detectionModel?: string }) {
    if (!config.apiKey) {
      throw new Error(
        "AnthropicProvider requires an API key (set ANTHROPIC_API_KEY).",
      );
    }
    this.client = new Anthropic({ apiKey: config.apiKey });
    // Sonnet 5 is ~2.5x cheaper than Opus 5 and plenty for this workload.
    // Override with ANTHROPIC_MODEL if you want more headroom (e.g. claude-opus-5).
    this.model = config.model ?? "claude-sonnet-5";
    // Detection is pure localisation — find the boxes, read the printed
    // numbers — so it can plausibly run on something faster and cheaper than
    // the model that does the tutoring. DETECTION_MODEL exists to A/B that
    // (claude-haiku-4-5) against real worksheet photos on a deploy. It
    // defaults to the main model, so nothing changes until it is set.
    this.detectionModel = config.detectionModel ?? this.model;
  }

  async detectQuestions(
    request: DetectQuestionsRequest,
  ): Promise<QuestionDetection> {
    const res = await this.client.messages.parse({
      model: this.detectionModel,
      max_tokens: 1200,
      // Thinking would only add latency to a localisation task. On Sonnet 5
      // this has to be said explicitly, because OMITTING `thinking` there runs
      // adaptive thinking rather than none. Haiku 4.5 doesn't take this shape
      // (it uses budget_tokens), and for it "off" is simply leaving it out.
      ...(isHaiku(this.detectionModel)
        ? {}
        : { thinking: { type: "disabled" as const } }),
      system: DETECT_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            imageBlock(request.imageDataUrl),
            {
              type: "text",
              text: detectUserText(request),
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(QuestionDetectionSchema) },
    });
    logUsage("detectQuestions", res);
    const out = required(res.parsed_output, "question detection");
    return {
      ...normalizeDetection(out, request.width, request.height),
      // The route strips this unless the client asked for it.
      debug: {
        model: this.detectionModel,
        width: request.width,
        height: request.height,
        raw: out.questions.map(({ label, x1, y1, x2, y2 }) => ({ label, x1, y1, x2, y2 })),
        primaryIndex: out.primaryIndex,
        grid: request.grid === true,
      },
    };
  }

  async summarizeProgress(request: ProgressRequest): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 700,
      // No thinking: this is a short piece of writing over a handful of lines
      // of text, and adaptive thinking would only add latency and cost.
      thinking: { type: "disabled" },
      system: PROGRESS_SYSTEM,
      messages: [
        {
          role: "user",
          content: progressText(request),
        },
      ],
    });
    logUsage("summarizeProgress", res);
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  }

  async analyzeProblem(request: AnalyzeRequest): Promise<ProblemAnalysis> {
    const res = await this.client.messages.parse({
      // Headroom for the problem text plus an opening hint. Truncation here
      // fails the parse and surfaces as a 500, which this route has hit before.
      model: this.model,
      max_tokens: 1800,
      thinking: { type: "disabled" },
      system: ANALYZE_SYSTEM,
      messages: [
        {
          role: "user",
          // A typed or pasted problem has no photo, and so nothing else on the
          // page: its hasStemContent is still asked (someone can paste
          // "hello"), and studentWork will simply be false.
          content: request.imageDataUrl
            ? [
                imageBlock(request.imageDataUrl),
                { type: "text", text: "Extract and classify this problem." },
              ]
            : `Extract and classify this problem, typed by the student:\n\n${request.problemText ?? ""}`,
        },
      ],
      output_config: { format: zodOutputFormat(ProblemAnalysisSchema) },
    });
    logUsage("analyze", res);
    return guardNotStem(required(res.parsed_output, "problem analysis"));
  }

  /**
   * Build the system + messages for a tutor turn.
   *
   * Shared by `tutor()` and `tutorStream()` so both send a byte-identical
   * cached prefix — the `cache_control` block below only pays off if the
   * streaming path reproduces it exactly.
   */
  private tutorContext(request: TutorRequest): {
    memory: SessionMemory;
    system: Anthropic.TextBlockParam[];
    messages: Anthropic.MessageParam[];
  } {
    // Split the system prompt so the big, frozen instructions are cached across
    // every turn/problem/user (prompt caching, ~90% cheaper on the cached
    // prefix), while the small per-problem block stays uncached.
    const parts = tutorSystemParts(request);
    const system: Anthropic.TextBlockParam[] = [
      {
        type: "text",
        text: parts.instructions,
        cache_control: { type: "ephemeral" },
      },
      { type: "text", text: parts.problem },
      { type: "text", text: parts.studentModel },
    ];
    const messages: Anthropic.MessageParam[] = tutorTurns(request);
    const memory = parts.memory;

    return { memory, system, messages };
  }

  async tutor(request: TutorRequest): Promise<TutorTurn> {
    const { memory, system, messages } = this.tutorContext(request);

    if (request.action === "show_solution") {
      // A worked solution the student will copy from has to be right: thinking
      // on, and streamed only to stay clear of request timeouts.
      const { thinking, effort } = thinkingFor(this.model);
      const res = await this.client.messages
        .stream({
          model: this.model,
          max_tokens: THINKING_MAX_TOKENS,
          thinking,
          system,
          messages,
          output_config: {
            format: zodOutputFormat(TutorSolutionSchema),
            ...(effort ? { effort } : {}),
          },
        })
        .finalMessage();
      logUsage("tutor:solution", res);
      const out = required(res.parsed_output, "solution");
      // Declined (not a STEM problem): the fields come back empty by
      // instruction, and an empty card would render section headings over
      // nothing — or "Not applicable" six times. Just the message, then.
      const empty = Object.values(out.solution).every((v) => !String(v).trim());
      return empty
        ? { message: out.message, memory }
        : { message: out.message, solution: out.solution, memory };
    }

    if (request.action === "similar_problem") {
      const res = await this.client.messages.parse({
        model: this.model,
        max_tokens: 800,
        thinking: { type: "disabled" },
        system,
        messages,
        output_config: { format: zodOutputFormat(TutorSimilarSchema) },
      });
      logUsage("tutor:similar", res);
      const out = required(res.parsed_output, "similar problem");
      return {
        message: out.message,
        similarProblem: out.similarProblem.trim() || undefined,
        memory,
      };
    }

    // Conceptual moves (ask / continue / hint / explain / go_deeper): one small
    // piece + hasMore, so the UI can offer "Continue". Kept short on purpose.
    const turnThinking = thinkingFor(this.model, TURN_EFFORT);
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: TURN_MAX_TOKENS,
      thinking: turnThinking.thinking,
      system,
      messages,
      output_config: {
        format: zodOutputFormat(TutorChunkSchema),
        ...(turnThinking.effort ? { effort: turnThinking.effort } : {}),
      },
    });
    logUsage("tutor:chunk", res);
    const out = required(res.parsed_output, "tutor reply");
    return {
      message: out.message,
      hasMore: out.hasMore,
      resolved: out.resolved,
      memory: out.memory,
    };
  }

  /**
   * The conceptual-move turn, streamed.
   *
   * Same request as the chunk branch of `tutor()` — same cached system prefix,
   * same schema, same token cap. The difference is purely in delivery: the
   * model writes `message` first (it is declared first in TutorChunkSchema) and
   * only then regenerates the whole memory blob, so streaming lets the student
   * read the sentences while that tail is still being written. The deeper into
   * a session, the bigger that tail, and the more this saves.
   *
   * Deltas are best-effort display only — decoded out of the partial JSON. The
   * authoritative turn comes from the SDK's validated `parsed_output` at the
   * end, exactly as the non-streaming path does, so a desynced decoder can
   * never produce wrong content: the final event overwrites it.
   */
  async *tutorStream(
    request: TutorRequest,
  ): AsyncGenerator<TutorStreamEvent, void, unknown> {
    const { system, messages } = this.tutorContext(request);

    // Thinking blocks stream first and carry no text deltas, so the decoder
    // below skips them; the student sees "Tutor is thinking…" meanwhile.
    const turnThinking = thinkingFor(this.model, TURN_EFFORT);
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: TURN_MAX_TOKENS,
      thinking: turnThinking.thinking,
      system,
      messages,
      output_config: {
        format: zodOutputFormat(TutorChunkSchema),
        ...(turnThinking.effort ? { effort: turnThinking.effort } : {}),
      },
    });

    const decode = createMessageFieldDecoder();
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        const text = decode(event.delta.text);
        if (text) yield { type: "delta", text };
      }
    }

    const final = await stream.finalMessage();
    logUsage("tutor:chunk", final);
    const out = required(final.parsed_output, "tutor reply");
    yield {
      type: "done",
      turn: {
        message: out.message,
        hasMore: out.hasMore,
        resolved: out.resolved,
        memory: out.memory,
      },
    };
  }

  /**
   * Diagnose an attempt, streaming progress while the model thinks.
   *
   * Thinking makes this slower, so the student sees real stages — driven by
   * the stream's own content_block_start events, not a timer — and then one
   * validated result.
   */
  async *checkWorkStream(
    request: CheckWorkRequest,
  ): AsyncGenerator<CheckWorkStreamEvent, void, unknown> {
    const { thinking, effort } = thinkingFor(this.model);

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: THINKING_MAX_TOKENS,
      thinking,
      system: CHECKWORK_SYSTEM,
      messages: [
        {
          role: "user",
          content: attemptContent(
            checkWorkText(request),
            request.attempt.imageDataUrl,
          ),
        },
      ],
      output_config: {
        format: zodOutputFormat(WorkCheckSchema),
        ...(effort ? { effort } : {}),
      },
    });

    let stage: "thinking" | "writing" | null = null;
    for await (const event of stream) {
      if (event.type !== "content_block_start") continue;
      const kind = event.content_block.type;
      const next =
        kind === "thinking" || kind === "redacted_thinking"
          ? "thinking"
          : kind === "text"
            ? "writing"
            : null;
      if (next && next !== stage) {
        stage = next;
        yield { type: "stage", stage: next };
      }
    }

    const final = await stream.finalMessage();
    logUsage("checkWork", final);
    const out = required(final.parsed_output, "work check");
    // Every fresh check goes through the same clean-up as a stored one (a
    // stray trailing quote, a null firstError), so the UI never sees raw
    // model output.
    yield { type: "done", check: normalizeWorkCheck(out) };
  }

  /** The same diagnosis without the progress frames, for non-streaming callers. */
  async checkWork(request: CheckWorkRequest): Promise<WorkCheck> {
    for await (const event of this.checkWorkStream(request)) {
      if (event.type === "done") return event.check;
    }
    throw new Error("The work check ended without a result.");
  }

  async generatePractice(
    request: GeneratePracticeRequest,
  ): Promise<PracticeProblem> {
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 800,
      thinking: { type: "disabled" },
      system: GENERATE_SYSTEM,
      messages: [
        {
          role: "user",
          content: generatePracticeText(request),
        },
      ],
      output_config: { format: zodOutputFormat(PracticeProblemSchema) },
    });
    logUsage("generatePractice", res);
    return required(res.parsed_output, "practice problem");
  }

  async evaluatePractice(
    request: EvaluatePracticeRequest,
  ): Promise<PracticeEvaluation> {
    // Marking: the same "don't call a right answer wrong" stakes as checkWork.
    const { thinking, effort } = thinkingFor(this.model);
    const res = await this.client.messages
      .stream({
        model: this.model,
        max_tokens: THINKING_MAX_TOKENS,
        thinking,
        system: EVALUATE_SYSTEM,
        messages: [
          {
            role: "user",
            content: attemptContent(
              evaluatePracticeText(request),
              request.attempt.imageDataUrl,
            ),
          },
        ],
        output_config: {
          format: zodOutputFormat(PracticeEvaluationSchema),
          ...(effort ? { effort } : {}),
        },
      })
      .finalMessage();
    logUsage("evaluatePractice", res);
    return required(res.parsed_output, "practice evaluation");
  }
}

// --- Helpers ----------------------------------------------------------------


/** Haiku takes a different thinking shape from the Sonnet/Opus default. */
function isHaiku(model: string): boolean {
  return model.toLowerCase().includes("haiku");
}

/**
 * Thinking for the calls where being WRONG is the costly failure: judging a
 * student's work, a full worked solution, and marking practice at "medium";
 * conversational turns at "low" (see TURN_EFFORT). Telling a correct student
 * they are wrong is the worst thing this app can do.
 *
 * There is no token budget on the default model: on Sonnet 5 `budget_tokens`
 * is removed and returns a 400, and adaptive thinking with an effort level is
 * the only way on. "medium" is the modest setting; `npm run eval` is how to
 * tell whether it should move. Haiku (only reachable by overriding the model)
 * still takes a budget and rejects `effort`, so it gets the older shape.
 *
 * `display: "omitted"` because nothing here ever shows the reasoning — it is
 * still done and billed, just not shipped over the wire.
 */
function thinkingFor(
  model: string,
  effort: "low" | "medium" = "medium",
): {
  thinking: Anthropic.ThinkingConfigParam;
  effort?: "low" | "medium";
} {
  if (isHaiku(model)) {
    return {
      thinking: {
        type: "enabled",
        budget_tokens: effort === "low" ? 2000 : 4000,
        display: "omitted",
      },
    };
  }
  return { thinking: { type: "adaptive", display: "omitted" }, effort };
}

/**
 * Conversational turns (hint, explain, a typed reply) think at LOW effort.
 * They used to run with thinking off, and a tutor reading slopes off a graph
 * and doing arithmetic in one pass handed a student a slope that failed its
 * own check, then caved when the student disputed it. Adaptive thinking lets
 * the model skip it on "sure, what's next?" and use it when there is maths.
 */
const TURN_EFFORT = "low" as const;

/**
 * Room for low-effort thinking plus a one-piece reply and the memory blob.
 * The reply's own length is held down by the chunking rule in the prompt.
 */
const TURN_MAX_TOKENS = 8000;

/**
 * Room for thinking plus the structured answer. Streaming requests don't hit
 * the HTTP timeouts a large non-streaming max_tokens can, which is why every
 * thinking call below streams.
 */
const THINKING_MAX_TOKENS = 16000;

/**
 * Log token usage for one call when DEBUG_TOKENS is set. Shows whether prompt
 * caching is hitting (cache_read > 0 on repeat turns) and the real token counts.
 * Off by default.
 */
function logUsage(label: string, res: { usage?: unknown }): void {
  if (!process.env.DEBUG_TOKENS) return;
  const u = (res.usage ?? {}) as Record<string, unknown>;
  console.log(
    `[tokens] ${label} in=${u.input_tokens ?? "?"} ` +
      `cache_read=${u.cache_read_input_tokens ?? 0} ` +
      `cache_write=${u.cache_creation_input_tokens ?? 0} ` +
      `out=${u.output_tokens ?? "?"}`,
  );
}

/** User content that carries a text block plus an optional work image. */
function attemptContent(
  text: string,
  imageDataUrl?: string,
): Anthropic.MessageParam["content"] {
  if (!imageDataUrl) return text;
  // Image first: the vision guidance is that Claude works best with the image
  // ahead of the text, and this call's whole job is reading that image.
  return [imageBlock(imageDataUrl), { type: "text", text }];
}

/** Build a Claude image content block from a data URL. */
function imageBlock(dataUrl: string): Anthropic.ImageBlockParam {
  const { mediaType, data } = dataUrlToImagePart(dataUrl);
  return {
    type: "image",
    source: {
      type: "base64",
      media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
      data,
    },
  };
}

/**
 * Split a `data:<mediaType>;base64,<data>` URL into the parts Claude's image
 * content block needs.
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

