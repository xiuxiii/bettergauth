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
import { normalizeWorkCheck } from "@/lib/tutor/types";
import { createMessageFieldDecoder } from "@/lib/tutor/streamText";
import { canonicalConcept } from "@/lib/tutor/concepts";
import { wantsDeepThought } from "@/lib/tutor/depth";
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
  guardNotStem,
  normalizeDetection,
  progressText,
  tutorSystemParts,
  tutorTurns,
} from "@/lib/ai/shared";
import { countFallback } from "@/lib/usageServer";

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
 * Any other call whose answer is still unusable after the repair round also
 * goes to the fallback when there is one. Auth, balance and rate-limit errors
 * never fall back: those are real.
 *
 * Thinking is sent explicitly on every call, and it is OFF except on tutor
 * turns that ask for depth ("Go deeper", "Explain why", a typed "why/how does…"
 * question; `wantsDeepThought` in lib/tutor/depth.ts), which also get a bigger
 * token cap. deepseek-flash thinks by default, and that reasoning eats
 * max_tokens (see `post`).
 *
 * Checks, solutions and practice marking run WITHOUT thinking here, unlike
 * Claude (`thinkingFor` in anthropicProvider.ts), on the bet that
 * non-thinking flash handles high-school work. `npm run eval` against
 * DeepSeek is how to tell whether that costs accuracy (the false "you're
 * wrong" rate must stay 0).
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
  /** Turn thinking on for this call (deep tutor turns only; see depth.ts). */
  think?: boolean;
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

/**
 * A tutor turn: one short message plus the whole memory blob, which grows
 * through a session. Only what is written is billed, so the cap is headroom,
 * not cost; running out mid-JSON is what fails a turn.
 */
const TURN_MAX_TOKENS = 3000;

/**
 * A deep turn thinks first, and the reasoning counts against max_tokens, so it
 * gets room for that on top of the reply. Still billed only as written.
 */
const DEEP_TURN_MAX_TOKENS = 12000;

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

  private async post(
    body: Record<string, unknown>,
    think = false,
    label = "",
  ): Promise<Response> {
    const res = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      // Thinking is always SENT, never left to the default: deepseek-flash
      // thinks by default, at high effort, and its reasoning counts against
      // max_tokens, so a 900-token turn ran out before the JSON answer was
      // written ("The tutor stopped mid-answer"). Off unless the turn asked
      // for depth; callers raise max_tokens when it's on.
      body: JSON.stringify({
        model: this.model,
        thinking: { type: think ? "enabled" : "disabled" },
        ...body,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // Thinking mode has its own rules (it has wanted earlier assistant turns'
    // reasoning passed back). If DeepSeek turns a thinking request down, the
    // student still gets an answer: the same request, without thinking.
    if (think && res.status === 400) {
      const detail = await res.text().catch(() => "");
      console.warn(
        `[ai] deepseek ${label}: thinking request rejected, retrying without: ${detail.slice(0, 200)}`,
      );
      return this.post(body, false, label);
    }
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
    think = false,
  ): Promise<string> {
    const res = await this.post(
      {
        messages,
        max_tokens: maxTokens,
        stream: false,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      },
      think,
      label,
    );
    const data = (await res.json()) as {
      choices?: { message?: { content?: string | null }; finish_reason?: string | null }[];
      usage?: Record<string, unknown>;
    };
    logUsage(label, data.usage);
    warnIfCut(label, data.choices?.[0]?.finish_reason);
    return data.choices?.[0]?.message?.content ?? "";
  }

  /** A streaming completion, yielding the reply text as it arrives (SSE). */
  private async *completeStream(
    messages: ChatMessage[],
    maxTokens: number,
    label: string,
    think = false,
  ): AsyncGenerator<string> {
    // With thinking on, the reasoning streams first as `reasoning_content`,
    // which is skipped below: the student sees "Tutor is thinking…" meanwhile.
    const res = await this.post(
      {
        messages,
        max_tokens: maxTokens,
        stream: true,
        stream_options: { include_usage: true },
        response_format: { type: "json_object" },
      },
      think,
      label,
    );
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
            choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
            usage?: Record<string, unknown> | null;
          };
          if (event.usage) logUsage(label, event.usage);
          warnIfCut(label, event.choices?.[0]?.finish_reason);
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
    { system, messages, maxTokens, label, think }: ChatOptions,
    firstReply?: string,
  ): Promise<z.infer<S>> {
    const convo: ChatMessage[] = [
      { role: "system", content: `${system}\n\n${jsonInstruction(schema)}` },
      ...messages,
    ];
    let reply = firstReply ?? (await this.complete(convo, maxTokens, label, true, think));
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
   * Run one call on DeepSeek, handing it to the fallback (Claude, when
   * configured) when DeepSeek can't do it:
   *   - a photo it rejects, or that twice gets an unusable answer;
   *   - any call whose answer is still unusable after the repair round, so a
   *     student sees Claude's reply instead of "Please try again".
   * A photo with no fallback becomes PhotoUnsupportedError. Auth, balance and
   * rate-limit errors never fall back: those are DeepSeek's real answer.
   */
  private async guarded<T>(
    hasImage: boolean,
    method: string,
    run: () => Promise<T>,
    onFallback: (fallback: AIProvider) => Promise<T>,
  ): Promise<T> {
    if (!(hasImage && !this.vision)) {
      try {
        return await run();
      } catch (err) {
        const rescuable = hasImage ? photoRejected(err) : err instanceof InvalidOutputError;
        if (!rescuable || (!hasImage && !this.fallback)) throw err;
        console.warn(`[ai] deepseek could not answer (${method})`, err);
      }
    }
    if (!this.fallback) throw new PhotoUnsupportedError();
    console.log(`[ai] deepseek fallback → ${this.fallback.name} (${method})`);
    countFallback(method);
    return onFallback(this.fallback);
  }

  // --- AIProvider --------------------------------------------------------------

  async detectQuestions(
    request: DetectQuestionsRequest,
  ): Promise<QuestionDetection> {
    return this.guarded(
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
          maxTokens: 2500,
          label: "detectQuestions",
        });
        return {
          ...normalizeDetection(out, request.width, request.height),
          // The route strips this unless the client asked for it.
          debug: {
            model: this.model,
            width: request.width,
            height: request.height,
            raw: out.questions.map(({ label, x1, y1, x2, y2 }) => ({ label, x1, y1, x2, y2 })),
            primaryIndex: out.primaryIndex,
          },
        };
      },
      (fallback) => fallback.detectQuestions(request),
    );
  }

  async analyzeProblem(request: AnalyzeRequest): Promise<ProblemAnalysis> {
    return this.guarded(
      !!request.imageDataUrl,
      "analyzeProblem",
      async () =>
        guardNotStem(
          await this.chatJson(ProblemAnalysisSchema, {
            system: ANALYZE_SYSTEM,
            messages: [
              {
                role: "user",
                content: request.imageDataUrl
                  ? withImage("Extract and classify this problem.", request.imageDataUrl)
                  : `Extract and classify this problem, typed by the student:\n\n${request.problemText ?? ""}`,
              },
            ],
            maxTokens: 3000,
            label: "analyze",
          }),
        ),
      (fallback) => fallback.analyzeProblem(request),
    );
  }

  async summarizeProgress(request: ProgressRequest): Promise<string> {
    const reply = await this.complete(
      [
        { role: "system", content: PROGRESS_SYSTEM },
        { role: "user", content: progressText(request) },
      ],
      1500,
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
    return this.guarded(
      false,
      `tutor:${request.action}`,
      () => this.tutorOnce(request),
      (fallback) => fallback.tutor(request),
    );
  }

  private async tutorOnce(request: TutorRequest): Promise<TutorTurn> {
    const { memory, system, messages } = this.tutorContext(request);

    if (request.action === "show_solution") {
      const out = await this.chatJson(TutorSolutionSchema, {
        system,
        messages,
        maxTokens: 6000,
        label: "tutor:solution",
      });
      // Declined (not a STEM problem): the fields come back empty, and an empty
      // card would render headings over nothing. Just the message, then.
      const empty = Object.values(out.solution).every((v) => !String(v).trim());
      return empty
        ? { message: out.message, memory }
        : { message: out.message, solution: out.solution, memory };
    }

    if (request.action === "similar_problem") {
      const out = await this.chatJson(TutorSimilarSchema, {
        system,
        messages,
        maxTokens: 1500,
        label: "tutor:similar",
      });
      return {
        message: out.message,
        similarProblem: out.similarProblem.trim() || undefined,
        memory,
      };
    }

    const think = wantsDeepThought(request.action, request.studentText);
    const out = await this.chatJson(TutorChunkSchema, {
      system,
      messages,
      maxTokens: think ? DEEP_TURN_MAX_TOKENS : TURN_MAX_TOKENS,
      label: think ? "tutor:chunk+think" : "tutor:chunk",
      think,
    });
    return {
      message: out.message,
      hasMore: out.hasMore,
      resolved: out.resolved,
      memory: out.memory,
    };
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
    const think = wantsDeepThought(request.action, request.studentText);
    const options: ChatOptions = {
      system,
      messages,
      maxTokens: think ? DEEP_TURN_MAX_TOKENS : TURN_MAX_TOKENS,
      label: think ? "tutor:chunk+think" : "tutor:chunk",
      think,
    };

    let raw = "";
    const decode = createMessageFieldDecoder();
    for await (const text of this.completeStream(
      [{ role: "system", content: `${system}\n\n${jsonInstruction(TutorChunkSchema)}` }, ...messages],
      options.maxTokens,
      options.label,
      think,
    )) {
      raw += text;
      const shown = decode(text);
      if (shown) yield { type: "delta", text: shown };
    }

    let out: z.infer<typeof TutorChunkSchema>;
    try {
      out = await this.chatJson(TutorChunkSchema, options, raw);
    } catch (err) {
      if (!(err instanceof InvalidOutputError) || !this.fallback) throw err;
      // The `done` frame replaces whatever deltas were shown, so the student
      // just sees Claude's reply land instead of an error card.
      console.warn("[ai] deepseek could not answer (tutor stream)", err);
      console.log(`[ai] deepseek fallback → ${this.fallback.name} (tutorStream)`);
      countFallback("tutorStream");
      yield { type: "done", turn: await this.fallback.tutor(request) };
      return;
    }
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
      const rescuable =
        err instanceof PhotoUnsupportedError ||
        (hasImage ? photoRejected(err) : err instanceof InvalidOutputError);
      if (!rescuable || (!hasImage && !this.fallback)) throw err;
      if (!(err instanceof PhotoUnsupportedError)) {
        console.warn("[ai] deepseek could not answer (checkWork)", err);
      }
      if (!this.fallback) throw new PhotoUnsupportedError();
      console.log(`[ai] deepseek fallback → ${this.fallback.name} (checkWork)`);
      countFallback("checkWork");
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
      maxTokens: 6000,
      label: "checkWork",
    });
    // Same clean-up as Claude's and as a stored check (stray quotes, a null
    // firstError), so the UI never sees raw model output.
    return normalizeWorkCheck(out);
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
    return this.guarded(
      false,
      "generatePractice",
      () =>
        this.chatJson(PracticeProblemSchema, {
          system: GENERATE_SYSTEM,
          messages: [{ role: "user", content: generatePracticeText(request) }],
          maxTokens: 2000,
          label: "generatePractice",
        }),
      (fallback) => fallback.generatePractice(request),
    );
  }

  async evaluatePractice(
    request: EvaluatePracticeRequest,
  ): Promise<PracticeEvaluation> {
    return this.guarded(
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
          maxTokens: 6000,
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
  const result = schema.safeParse(canonicalizeConcepts(parsed));
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return { ok: false, error: `it did not match the schema (${issues})` };
}

/**
 * Concept labels come from a fixed list (lib/tutor/concepts.ts), which Claude
 * is held to by constrained decoding and DeepSeek only by the prompt. A label
 * off by case or spacing is corrected; an invented one is dropped from memory
 * (losing one tracked gap) rather than failing the student's whole turn. A
 * work check's own `concept` is left for the schema, so a wrong one still
 * goes through the repair round.
 */
function canonicalizeConcepts(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const obj = { ...(value as Record<string, unknown>) };
  if (typeof obj.concept === "string") {
    obj.concept = canonicalConcept(obj.concept) ?? obj.concept;
  }
  const memory = obj.memory as Record<string, unknown> | undefined;
  if (memory && typeof memory === "object") {
    const fixed = { ...memory };
    if (Array.isArray(fixed.demonstrated)) {
      fixed.demonstrated = fixed.demonstrated
        .map((c) => (typeof c === "string" ? canonicalConcept(c) : null))
        .filter((c): c is string => c !== null);
    }
    for (const key of ["misconceptions", "errors"] as const) {
      const list = fixed[key];
      if (!Array.isArray(list)) continue;
      fixed[key] = list.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const e = entry as Record<string, unknown>;
        const concept = typeof e.concept === "string" ? canonicalConcept(e.concept) : null;
        return concept ? [{ ...e, concept }] : [];
      });
    }
    obj.memory = fixed;
  }
  return obj;
}

/** A reply that hit max_tokens is cut mid-JSON; say so, or it looks like a bad model. */
function warnIfCut(label: string, finishReason?: string | null): void {
  if (finishReason === "length") {
    console.warn(`[ai] deepseek ${label}: reply hit max_tokens and was cut off`);
  }
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
