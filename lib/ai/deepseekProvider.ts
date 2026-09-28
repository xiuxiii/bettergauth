import "server-only";

import { z } from "zod";

import { PhotoUnsupportedError, type AIProvider } from "@/lib/ai/types";
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
  evaluatePracticeText,
  generatePracticeText,
  normalizeDetection,
  progressText,
  tutorSystemParts,
  tutorTurns,
} from "@/lib/ai/shared";

/**
 * DeepSeek, through its OpenAI-compatible Chat Completions API.
 *
 * Why not DeepSeek's Anthropic-compatible endpoint (/anthropic), which would
 * have let AnthropicProvider be reused with a different baseURL? Every Claude
 * call here depends on structured outputs (`messages.parse` +
 * `output_config.format`), which that endpoint does not document, and it has
 * rejected image blocks. So this asks for JSON mode, puts the schema in the
 * prompt, and validates the reply with the SAME Zod schemas Claude is held to
 * (lib/ai/shared.ts), retrying once with the validation error when it misses.
 *
 * Photos: `deepseek-flash` takes images. When DeepSeek can't handle one (it
 * rejects the request, or twice returns something unusable), that single call
 * is re-run on the fallback provider (Claude, when ANTHROPIC_API_KEY is set),
 * or fails with PhotoUnsupportedError asking the student to type the problem.
 * Auth, balance and rate-limit errors never fall back: those are real.
 *
 * TODO: thinking. Claude thinks on checkWork / show_solution /
 * evaluatePractice (`thinkingFor` in anthropicProvider.ts). This runs them
 * without; `npm run eval` against DeepSeek is how to tell whether that costs
 * accuracy (the false "you're wrong" rate must stay 0).
 */

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

type ChatOptions = {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  label: string;
};

/**
 * A non-2xx from DeepSeek, shaped like an Anthropic SDK error (numeric
 * `status`, string `type`) so `classify` in lib/apiError.ts reports it the
 * same way: 402 "Insufficient Balance" becomes the spend-limit message, 401
 * the bad-key one, and so on.
 */
class DeepSeekError extends Error {
  readonly status: number;
  readonly type: string;

  constructor(status: number, message: string) {
    super(`DeepSeek ${status}: ${message}`);
    this.name = "DeepSeekError";
    this.status = status;
    this.type =
      status === 401
        ? "authentication_error"
        : status === 402
          ? "billing_error"
          : status === 429
            ? "rate_limit_error"
            : status >= 500
              ? "overloaded_error"
              : "invalid_request_error";
  }
}

/** The model twice returned JSON that didn't match the schema. */
class InvalidOutputError extends Error {
  constructor(what: string, detail: string) {
    super(`DeepSeek did not return a valid ${what}: ${detail}`);
    this.name = "InvalidOutputError";
  }
}

/**
 * Statuses that mean "this request, as sent, won't work", which for a call
 * carrying a photo most likely means the photo. Only these trigger the
 * fallback; a 401/402/429/5xx is DeepSeek's real answer for every call.
 */
const PHOTO_REJECTED = new Set([400, 404, 413, 415, 422]);

function photoRejected(err: unknown): boolean {
  if (err instanceof InvalidOutputError) return true;
  return err instanceof DeepSeekError && PHOTO_REJECTED.has(err.status);
}

/** Generous, but bounded: a hung upstream must not hold the function open. */
const REQUEST_TIMEOUT_MS = 120_000;

export class DeepSeekProvider implements AIProvider {
  readonly name = "deepseek";
  readonly model: string;
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly vision: boolean;
  private readonly fallback?: AIProvider;

  constructor(config: {
    apiKey: string;
    model?: string;
    baseURL?: string;
    /** false sends every photo straight to the fallback (or the error). */
    vision?: boolean;
    /** Runs a photo call DeepSeek couldn't handle. */
    fallback?: AIProvider;
  }) {
    if (!config.apiKey) {
      throw new Error(
        "DeepSeekProvider requires an API key (set DEEPSEEK_API_KEY).",
      );
    }
    this.apiKey = config.apiKey;
    this.model = config.model ?? "deepseek-flash";
    this.baseURL = (config.baseURL ?? "https://api.deepseek.com").replace(/\/+$/, "");
    this.vision = config.vision ?? true;
    this.fallback = config.fallback;
  }

  // --- Transport -------------------------------------------------------------

  private async post(body: Record<string, unknown>): Promise<Response> {
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, ...body }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let message = raw.slice(0, 500) || res.statusText;
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: unknown } };
        if (typeof parsed.error?.message === "string") message = parsed.error.message;
      } catch {
        // Not JSON; keep the raw text.
      }
      throw new DeepSeekError(res.status, message);
    }
    return res;
  }

  /** One non-streaming completion; returns the reply text. */
  private async complete(
    messages: ChatMessage[],
    maxTokens: number,
    label: string,
    json: boolean,
  ): Promise<string> {
    const res = await this.post({
      messages,
      max_tokens: maxTokens,
      stream: false,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    });
    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: Record<string, unknown>;
    };
    logUsage(label, data.usage);
    return data.choices?.[0]?.message?.content ?? "";
  }

  /** A streaming completion, yielding the reply text as it arrives (SSE). */
  private async *completeStream(
    messages: ChatMessage[],
    maxTokens: number,
    label: string,
  ): AsyncGenerator<string> {
    const res = await this.post({
      messages,
      max_tokens: maxTokens,
      stream: true,
      stream_options: { include_usage: true },
      response_format: { type: "json_object" },
    });
    if (!res.body) return;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data:")) continue; // blank lines, keep-alives
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") return;
          const event = JSON.parse(payload) as {
            choices?: { delta?: { content?: string | null } }[];
            usage?: Record<string, unknown> | null;
          };
          if (event.usage) logUsage(label, event.usage);
          const text = event.choices?.[0]?.delta?.content;
          if (text) yield text;
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  /**
   * Ask for a JSON object matching `schema` and validate it. One repair round:
   * a reply that doesn't parse or match is sent back with the problem, which
   * fixes the usual slip (a missing field, a string where a number belongs).
   * `firstReply` lets a streamed attempt enter the repair round directly.
   */
  private async chatJson<S extends z.ZodType>(
    schema: S,
    { system, messages, maxTokens, label }: ChatOptions,
    firstReply?: string,
  ): Promise<z.infer<S>> {
    const convo: ChatMessage[] = [
      { role: "system", content: `${system}\n\n${jsonInstruction(schema)}` },
      ...messages,
    ];
    let reply = firstReply ?? (await this.complete(convo, maxTokens, label, true));
    let result = validate(schema, reply);
    if (result.ok) return result.data;

    convo.push(
      { role: "assistant", content: reply || "(empty)" },
      {
        role: "user",
        content: `That reply was not usable: ${result.error}. Reply again with ONLY the corrected JSON object.`,
      },
    );
    reply = await this.complete(convo, maxTokens, `${label}:repair`, true);
    result = validate(schema, reply);
    if (result.ok) return result.data;
    throw new InvalidOutputError(label, result.error);
  }

  /**
   * Run a call that may carry a photo. Text-only calls just run. A photo call
   * runs on DeepSeek unless vision is off, and moves to the fallback when
   * DeepSeek can't handle it.
   */
  private async withPhoto<T>(
    hasImage: boolean,
    method: string,
    run: () => Promise<T>,
    onFallback: (fallback: AIProvider) => Promise<T>,
  ): Promise<T> {
    if (!hasImage) return run();
    if (this.vision) {
      try {
        return await run();
      } catch (err) {
        if (!photoRejected(err)) throw err;
        console.warn(`[ai] deepseek could not handle a photo (${method})`, err);
      }
    }
    if (!this.fallback) throw new PhotoUnsupportedError();
    console.log(`[ai] deepseek photo fallback → ${this.fallback.name} (${method})`);
    return onFallback(this.fallback);
  }

  // --- AIProvider --------------------------------------------------------------

  async detectQuestions(
    request: DetectQuestionsRequest,
  ): Promise<QuestionDetection> {
    return this.withPhoto(
      true,
      "detectQuestions",
      async () => {
        const out = await this.chatJson(QuestionDetectionSchema, {
          system: DETECT_SYSTEM,
          messages: [
            {
              role: "user",
              content: withImage(
                `This image is exactly ${request.width} x ${request.height} pixels. Locate every question in it and give each box in pixel coordinates within those bounds.`,
                request.imageDataUrl,
              ),
            },
          ],
          maxTokens: 1200,
          label: "detectQuestions",
        });
        return normalizeDetection(out, request.width, request.height);
      },
      (fallback) => fallback.detectQuestions(request),
    );
  }

  async analyzeProblem(request: AnalyzeRequest): Promise<ProblemAnalysis> {
    return this.withPhoto(
      !!request.imageDataUrl,
      "analyzeProblem",
      () =>
        this.chatJson(ProblemAnalysisSchema, {
          system: ANALYZE_SYSTEM,
          messages: [
            {
              role: "user",
              content: request.imageDataUrl
                ? withImage("Extract and classify this problem.", request.imageDataUrl)
                : `Extract and classify this problem, typed by the student:\n\n${request.problemText ?? ""}`,
            },
          ],
          maxTokens: 1800,
          label: "analyze",
        }),
      (fallback) => fallback.analyzeProblem(request),
    );
  }

  async summarizeProgress(request: ProgressRequest): Promise<string> {
    const reply = await this.complete(
      [
        { role: "system", content: PROGRESS_SYSTEM },
        { role: "user", content: progressText(request) },
      ],
      700,
      "summarizeProgress",
      false,
    );
    return reply.trim();
  }

  /** The tutor's system prompt and conversation, in chat form. */
  private tutorContext(request: TutorRequest) {
    const parts = tutorSystemParts(request);
    return {
      memory: parts.memory,
      system: [parts.instructions, parts.problem, parts.studentModel].join("\n\n"),
      messages: tutorTurns(request) as ChatMessage[],
    };
  }

  async tutor(request: TutorRequest): Promise<TutorTurn> {
    const { memory, system, messages } = this.tutorContext(request);

    if (request.action === "show_solution") {
      const out = await this.chatJson(TutorSolutionSchema, {
        system,
        messages,
        maxTokens: 4000,
        label: "tutor:solution",
      });
      return { message: out.message, solution: out.solution, memory };
    }

    if (request.action === "similar_problem") {
      const out = await this.chatJson(TutorSimilarSchema, {
        system,
        messages,
        maxTokens: 800,
        label: "tutor:similar",
      });
      return { message: out.message, similarProblem: out.similarProblem, memory };
    }

    const out = await this.chatJson(TutorChunkSchema, {
      system,
      messages,
      maxTokens: 900,
      label: "tutor:chunk",
    });
    return { message: out.message, hasMore: out.hasMore, memory: out.memory };
  }

  /**
   * The conceptual-move turn, streamed. Deltas are display-only, decoded out
   * of the partial JSON exactly as for Claude; the `done` frame carries the
   * validated turn, and a reply that fails validation goes through the same
   * repair round as the non-streaming path.
   */
  async *tutorStream(
    request: TutorRequest,
  ): AsyncGenerator<TutorStreamEvent, void, unknown> {
    const { system, messages } = this.tutorContext(request);
    const options: ChatOptions = { system, messages, maxTokens: 900, label: "tutor:chunk" };

    let raw = "";
    const decode = createMessageFieldDecoder();
    for await (const text of this.completeStream(
      [{ role: "system", content: `${system}\n\n${jsonInstruction(TutorChunkSchema)}` }, ...messages],
      options.maxTokens,
      options.label,
    )) {
      raw += text;
      const shown = decode(text);
      if (shown) yield { type: "delta", text: shown };
    }

    const out = await this.chatJson(TutorChunkSchema, options, raw);
    yield {
      type: "done",
      turn: { message: out.message, hasMore: out.hasMore, memory: out.memory },
    };
  }

  /**
   * The diagnosis. Nothing is yielded until DeepSeek has answered, so the
   * route's "await the first event before the 200" still carries a real
   * auth, balance or rate-limit status. A photo it can't handle goes to the
   * fallback's own stream, stages included.
   */
  async *checkWorkStream(
    request: CheckWorkRequest,
  ): AsyncGenerator<CheckWorkStreamEvent, void, unknown> {
    const hasImage = !!request.attempt.imageDataUrl;
    let check: WorkCheck;
    try {
      if (hasImage && !this.vision) throw new PhotoUnsupportedError();
      check = await this.checkWorkOnce(request);
    } catch (err) {
      if (!hasImage) throw err;
      if (!(err instanceof PhotoUnsupportedError)) {
        if (!photoRejected(err)) throw err;
        console.warn("[ai] deepseek could not handle a photo (checkWork)", err);
      }
      if (!this.fallback) throw new PhotoUnsupportedError();
      console.log(`[ai] deepseek photo fallback → ${this.fallback.name} (checkWork)`);
      yield* this.fallback.checkWorkStream(request);
      return;
    }
    yield { type: "stage", stage: "writing" };
    yield { type: "done", check };
  }

  private async checkWorkOnce(request: CheckWorkRequest): Promise<WorkCheck> {
    const out = await this.chatJson(WorkCheckSchema, {
      system: CHECKWORK_SYSTEM,
      messages: [
        {
          role: "user",
          content: withImage(checkWorkText(request), request.attempt.imageDataUrl),
        },
      ],
      maxTokens: 4000,
      label: "checkWork",
    });
    return { ...out, firstError: out.firstError ?? undefined };
  }

  async checkWork(request: CheckWorkRequest): Promise<WorkCheck> {
    for await (const event of this.checkWorkStream(request)) {
      if (event.type === "done") return event.check;
    }
    throw new Error("The work check ended without a result.");
  }

  async generatePractice(
    request: GeneratePracticeRequest,
  ): Promise<PracticeProblem> {
    return this.chatJson(PracticeProblemSchema, {
      system: GENERATE_SYSTEM,
      messages: [{ role: "user", content: generatePracticeText(request) }],
      maxTokens: 800,
      label: "generatePractice",
    });
  }

  async evaluatePractice(
    request: EvaluatePracticeRequest,
  ): Promise<PracticeEvaluation> {
    return this.withPhoto(
      !!request.attempt.imageDataUrl,
      "evaluatePractice",
      () =>
        this.chatJson(PracticeEvaluationSchema, {
          system: EVALUATE_SYSTEM,
          messages: [
            {
              role: "user",
              content: withImage(
                evaluatePracticeText(request),
                request.attempt.imageDataUrl,
              ),
            },
          ],
          maxTokens: 4000,
          label: "evaluatePractice",
        }),
      (fallback) => fallback.evaluatePractice(request),
    );
  }
}

// --- Helpers ----------------------------------------------------------------

/** User content with an optional photo, image first as for Claude. */
function withImage(text: string, imageDataUrl?: string): ChatMessage["content"] {
  if (!imageDataUrl) return text;
  return [
    { type: "image_url", image_url: { url: imageDataUrl } },
    { type: "text", text },
  ];
}

/**
 * JSON mode only guarantees *some* JSON object, so the shape goes in the
 * prompt. Keys are asked for in schema order: `message` has to come first for
 * the streamed tutor text to appear before the memory blob.
 */
function jsonInstruction(schema: z.ZodType): string {
  return `Reply with a single JSON object and nothing else. It must match this JSON Schema exactly, with every required key present, written in the order the schema lists them:\n${JSON.stringify(z.toJSONSchema(schema))}`;
}

function validate<S extends z.ZodType>(
  schema: S,
  reply: string,
): { ok: true; data: z.infer<S> } | { ok: false; error: string } {
  if (!reply.trim()) return { ok: false, error: "the reply was empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply);
  } catch {
    return { ok: false, error: "the reply was not valid JSON" };
  }
  const result = schema.safeParse(parsed);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, error: `it did not match the schema (${issues})` };
}

/** Per-call token usage when DEBUG_TOKENS is set, cache hits included. */
function logUsage(label: string, usage?: Record<string, unknown> | null): void {
  if (!process.env.DEBUG_TOKENS || !usage) return;
  console.log(
    `[tokens] deepseek ${label} in=${usage.prompt_tokens ?? "?"} ` +
      `cache_hit=${usage.prompt_cache_hit_tokens ?? 0} ` +
      `out=${usage.completion_tokens ?? "?"}`,
  );
}
