import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import type { AIProvider } from "@/lib/ai/types";
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
  SessionMemory,
  TutorPreferences,
  TutorStreamEvent,
  TutorTurn,
  TutorRequest,
  WorkCheck,
} from "@/lib/tutor/types";
import { emptySessionMemory } from "@/lib/tutor/types";
import { SYSTEM_INSTRUCTIONS } from "@/lib/tutor/engine";
import { createMessageFieldDecoder } from "@/lib/tutor/streamText";

/**
 * Real vision-capable provider (Claude). Turns each request into a Claude call
 * and maps the structured response back into the app's domain types. The
 * frontend and API routes never see anything below this file.
 *
 * Structured outputs: every method constrains the model to the exact domain
 * shape with a Zod schema via `client.messages.parse` + `zodOutputFormat`, so
 * the parsed result is validated before it leaves this module.
 */

// --- Domain-mirroring schemas (validated model output) ----------------------

const SubjectSchema = z.enum([
  "Physics",
  "Chemistry",
  "Biology",
  "Mathematics",
  "Unknown",
]);

/**
 * Question locations on a page, as ABSOLUTE PIXEL corners in the image that was
 * sent: [x1, y1] top-left, [x2, y2] bottom-right.
 *
 * Pixels rather than 0..1 fractions on purpose. The vision docs are explicit
 * that Claude "does not work well when you ask for normalized coordinates" and
 * to "always ask for pixel coordinates and normalize in your own code" — asking
 * for fractions was putting boxes on the wrong questions entirely.
 * `normalizeDetection` does the conversion.
 */
const QuestionDetectionSchema = z.object({
  questions: z.array(
    z.object({
      label: z.string(),
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
    }),
  ),
  primaryIndex: z.number(),
});

const ProblemAnalysisSchema = z.object({
  problemText: z.string(),
  subject: SubjectSchema,
  topic: z.string(),
  concept: z.string(),
  confidence: z.number(),
  /**
   * Whether the photo already contains the student's own handwritten attempt.
   * Only a flag: noticing that handwriting exists is a far easier call than
   * reading it, and transcribing here made every OCR slip a "fact" the
   * diagnosis then reasoned from. The diagnosis reads the photo itself.
   */
  studentWork: z.object({
    present: z.boolean(),
  }),
  /** The session's opening nudge. Free: it rides along on this same call. */
  openingHint: z.string(),
});

const StructuredSolutionSchema = z.object({
  understanding: z.string(),
  keyConcept: z.string(),
  reasoning: z.string(),
  solution: z.string(),
  finalAnswer: z.string(),
  takeaway: z.string(),
});

/** The tutor's compact cross-turn memory (mirrors SessionMemory). */
const SessionMemorySchema = z.object({
  demonstrated: z.array(z.string()),
  misconceptions: z.array(
    z.object({
      concept: z.string(),
      studentBelief: z.string(),
      correctModel: z.string(),
      status: z.enum(["suspected", "confirmed", "resolving", "resolved"]),
    }),
  ),
  errors: z.array(
    z.object({
      type: z.enum([
        "careless",
        "arithmetic",
        "algebraic",
        "notation",
        "procedural",
        "conceptual",
        "strategic",
      ]),
      concept: z.string(),
    }),
  ),
  bottleneck: z.string(),
});

/** Conceptual moves: one small piece, whether more remains, updated memory. */
const TutorChunkSchema = z.object({
  message: z.string(),
  hasMore: z.boolean(),
  memory: SessionMemorySchema,
});
const TutorSolutionSchema = z.object({
  message: z.string(),
  solution: StructuredSolutionSchema,
});
const TutorSimilarSchema = z.object({
  message: z.string(),
  similarProblem: z.string(),
});

const WorkErrorSchema = z.object({
  category: z.enum([
    "conceptual",
    "model_selection",
    "setup",
    "procedural",
    "arithmetic",
    "units_notation",
  ]),
  severity: z.enum(["minor", "significant"]),
  location: z.string(),
  explanation: z.string(),
  correction: z.string(),
  conceptCorrect: z.boolean(),
});

const WorkCheckSchema = z.object({
  verdict: z.enum(["correct", "partially_correct", "error_found"]),
  strengths: z.string(),
  firstError: WorkErrorSchema.nullable(),
  continueFrom: z.string(),
  summary: z.string(),
});

const PracticeProblemSchema = z.object({
  problemText: z.string(),
  subject: SubjectSchema,
  topic: z.string(),
  concept: z.string(),
  difficulty: z.enum(["same", "slightly_harder"]),
});

const RubricResultSchema = z.object({
  axis: z.enum([
    "concept_selection",
    "reasoning",
    "setup",
    "execution",
    "final_answer",
  ]),
  status: z.enum(["correct", "minor_issue", "incorrect", "not_shown"]),
  note: z.string(),
});

const PracticeEvaluationSchema = z.object({
  verdict: z.enum(["correct", "partially_correct", "incorrect"]),
  rubric: z.array(RubricResultSchema),
  focus: z.string(),
  summary: z.string(),
  solution: StructuredSolutionSchema,
});

// --- Task system prompts ----------------------------------------------------

const MATH_NOTE =
  "Write all mathematics as LaTeX: $...$ for inline and $$...$$ for block equations.";

const STYLE_NOTE =
  "Formatting: write for a phone screen. Keep every paragraph to 1-3 short sentences separated by a blank line. Use \"- \" bullets for parallel items and \"1. \" for ordered steps, one idea per line, and put key equations on their own line. Avoid em-dashes: use a period, comma, or colon instead. Never return a dense wall of text.";

const DETECT_SYSTEM = `You locate the individual questions in a photo of a worksheet, textbook page or screen so an app can crop to one of them.

Return the bounding box of each question as ABSOLUTE PIXEL coordinates in the image you were given: x1, y1 is the top-left corner and x2, y2 is the bottom-right corner, with (0, 0) at the top-left of the image, x increasing right and y increasing down. The user message states the image's exact pixel dimensions; every coordinate must fall inside them. Do not return fractions or percentages.

Getting the box on the RIGHT question matters more than getting its edges perfect. Before you emit each entry, check that the question number printed inside that box is the number you are about to use as its label. If they disagree, fix the box.

What counts as a question: one numbered problem together with all of its parts, sub-parts, figures and answer options. Its box must fully contain it with a small margin and must not overlap a neighbouring question.

A question's box must ALSO contain any handwritten working the student has already done for it, usually below or beside the printed question. They often photograph a problem they have already attempted, and work left outside the box is lost. Stop before the next numbered question even when working runs close to it, and never extend a box ABOVE its own printed number: working written above that number belongs to the question before it, not this one.

Ignore everything that is not printed exercise content. Photos are taken on a desk, so a calculator, phone, pen, ruler, hand or any other object lying on the page is NEVER a question, and neither is a running header, a page number, a chapter title or a section heading on its own.

Pages photographed as a two-page spread have independent columns: read each column top to bottom, left-hand page before right-hand page.

Label each entry with the number printed at the start of that question ("Question 5", "Q5", "3(b)"). If a region has no printed number of its own, do not return it. Return only questions you can actually see a number for; five correct boxes are far better than eight with three in the wrong place.

If the photo shows a single problem, or only a fragment of one, return exactly one box around it. Set primaryIndex to the question most likely intended: the most complete, central one, or the only one.`;

const ANALYZE_SYSTEM = `You extract a single high-school STEM problem from a photo and classify it.
Read the problem exactly as written (including all parts), identify the subject, a specific topic, and the single governing concept/principle the problem hinges on. Set confidence in 0..1 for how sure the extraction+classification is.

The photo often ALSO contains the student's own handwritten attempt, because they
photograph problems they have already worked on. Separate the two:
- \`problemText\` is the PRINTED question ONLY. Never fold handwriting into it. This text is shown to the tutor as the problem itself every turn, so a student's wrong working leaking into it would be read as part of the question.
- Set \`studentWork.present\` true ONLY for HANDWRITTEN working that is this student's own attempt at this problem. Printed text never counts: a worked example, a textbook solution, an answer key or the question's own printed answer options are all part of the page, not an attempt. Stray doodles, labels on a diagram, and a lone underlined final answer with no reasoning are not an attempt either.
- Do NOT transcribe the working. Only say whether it is there; something else reads it.

\`openingHint\` is the first thing the student reads, so make it worth reading:
ONE short sentence that points at where to start, and nothing else. Name the move
or the thing to notice, never the answer and never the full method. "Every root
divides 6, so start there." or "Resolve the weight along the incline first." Talk
like a person: contractions, "you", no preamble, no sign-off, no restating the
question, no mention of buttons or what the app can do. If the photo already
contains the student's working, still write it, but aimed at the next step from
where they are. ${MATH_NOTE}`;

const CHECKWORK_SYSTEM = `You are an expert STEM tutor diagnosing a student's attempt.
Trace the student's OWN reasoning and find the FIRST point where it diverges from correct reasoning — not just a wrong final answer. Diagnose that divergence in terms of THEIR mental model: what their work assumes or treats as true, and why that is the real problem. Do NOT replace their reasoning with a fresh solution of your own. When their approach is internally consistent but rests on a wrong assumption, say exactly that — e.g. "your calculation is consistent with using the total velocity, but this equation needs the vertical component $v_y$". Classify the error by category and severity. If the underlying concept/method is right, say so and keep any arithmetic/notation correction to one line — do NOT nitpick. If the attempt is actually correct, set verdict "correct", leave firstError null, and say why their reasoning holds. Always name briefly what the student did right and how to continue from the corrected point.

You are reading their ACTUAL HANDWRITING off a photo, so read it carefully and honestly:
- Diagnose only steps you can genuinely see. NEVER invent a line that would explain their answer, and never fill in a step they did not write. If something is illegible, say that line is hard to read and ask what it says, rather than guessing.
- Printed text on the page is not theirs. Textbooks print the answer next to the question, e.g. "(ans: 42.4 N)", and that is the book talking, not the student. Never treat a printed answer, worked example or answer key as a step they wrote, and never reverse-engineer working to reach it.
- The photo may also catch working for a NEIGHBOURING question. Use only what belongs to the stated problem.
- Units here are almost always N, m, s, kg, J or degrees. A mark after a force value that looks like V or Y is nearly always N; a scrawled greek letter next to an angle is nearly always theta.
${MATH_NOTE} ${STYLE_NOTE}`;

const GENERATE_SYSTEM = `You generate ONE fresh practice problem testing the SAME concept as the given problem, with different numbers and context so memorization is useless, at matching or slightly higher difficulty, avoiding unnecessary complexity. Do NOT include or reveal a solution — the student solves it first. ${MATH_NOTE}`;

const EVALUATE_SYSTEM = `You evaluate a student's attempt at a practice problem across five axes: concept selection, reasoning, setup, execution, final answer — each correct | minor_issue | incorrect | not_shown, with a short note. Give "focus": the single most important thing to fix or reinforce. Include the worked solution. If the student submitted no attempt (they asked to just see the solution), set every rubric status to "not_shown" and still provide the solution. ${MATH_NOTE} ${STYLE_NOTE}`;

// --- Provider ---------------------------------------------------------------

export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: { apiKey: string; model?: string }) {
    if (!config.apiKey) {
      throw new Error(
        "AnthropicProvider requires an API key (set ANTHROPIC_API_KEY).",
      );
    }
    this.client = new Anthropic({ apiKey: config.apiKey });
    // Sonnet 5 is ~2.5x cheaper than Opus 5 and plenty for this workload.
    // Override with ANTHROPIC_MODEL if you want more headroom (e.g. claude-opus-5).
    this.model = config.model ?? "claude-sonnet-5";
  }

  async detectQuestions(
    request: DetectQuestionsRequest,
  ): Promise<QuestionDetection> {
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 1200,
      thinking: { type: "disabled" },
      system: DETECT_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            imageBlock(request.imageDataUrl),
            {
              type: "text",
              text: `This image is exactly ${request.width} x ${request.height} pixels. Locate every question in it and give each box in pixel coordinates within those bounds.`,
            },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(QuestionDetectionSchema) },
    });
    logUsage("detectQuestions", res);
    const out = required(res.parsed_output, "question detection");
    return normalizeDetection(out, request.width, request.height);
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
          content: [
            imageBlock(request.imageDataUrl),
            { type: "text", text: "Extract and classify this problem." },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(ProblemAnalysisSchema) },
    });
    logUsage("analyze", res);
    return required(res.parsed_output, "problem analysis");
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
    const memory = request.memory ?? emptySessionMemory();
    const system: Anthropic.TextBlockParam[] = [
      {
        type: "text",
        text: SYSTEM_INSTRUCTIONS,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: `# Current problem\n${request.problem.problemText}\nSubject: ${request.problem.subject}. Topic: ${request.problem.topic}. Governing concept: ${request.problem.concept}.${preferencesBlock(request.preferences)}`,
      },
      {
        type: "text",
        text: `# Running student model (your cross-turn memory)
Use this, and RETURN it updated as \`memory\` this turn:
${JSON.stringify(memory)}

Maintain it honestly from evidence:
- Add a concept to \`demonstrated\` once the student has PROVEN they know it — never re-explain those.
- Log each classified mistake in \`errors\` with the concept it belongs to.
- Record a wrong mental model in \`misconceptions\`; advance status suspected → confirmed → resolving → resolved as you address it and re-verify it stuck.
- Set \`bottleneck\` to the single thing blocking progress right now ("" if none).
- If one concept shows up in \`errors\`/\`misconceptions\` more than once, treat it as a RECURRING gap: name it plainly, raise depth, and have the student retry it rather than moving on.`,
      },
    ];

    // The problem already lives in the (cached) system block, so messages[0] is
    // just a tiny anchor — no need to resend the full problem text every turn.
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "Let's work on this problem." },
      ...request.history.map(
        (m): Anthropic.MessageParam => ({
          role: m.role === "student" ? "user" : "assistant",
          content: m.content,
        }),
      ),
      { role: "user", content: actionPrompt(request) },
    ];

    return { memory, system, messages };
  }

  async tutor(request: TutorRequest): Promise<TutorTurn> {
    const { memory, system, messages } = this.tutorContext(request);

    if (request.action === "show_solution") {
      const res = await this.client.messages.parse({
        model: this.model,
        max_tokens: 1500,
        thinking: { type: "disabled" },
        system,
        messages,
        output_config: { format: zodOutputFormat(TutorSolutionSchema) },
      });
      logUsage("tutor:solution", res);
      const out = required(res.parsed_output, "solution");
      return { message: out.message, solution: out.solution, memory };
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
      return { message: out.message, similarProblem: out.similarProblem, memory };
    }

    // Conceptual moves (ask / continue / hint / explain / go_deeper): one small
    // piece + hasMore, so the UI can offer "Continue". Kept short on purpose.
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 900,
      thinking: { type: "disabled" },
      system,
      messages,
      output_config: { format: zodOutputFormat(TutorChunkSchema) },
    });
    logUsage("tutor:chunk", res);
    const out = required(res.parsed_output, "tutor reply");
    return { message: out.message, hasMore: out.hasMore, memory: out.memory };
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

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 900,
      thinking: { type: "disabled" },
      system,
      messages,
      output_config: { format: zodOutputFormat(TutorChunkSchema) },
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
      turn: { message: out.message, hasMore: out.hasMore, memory: out.memory },
    };
  }

  async checkWork(request: CheckWorkRequest): Promise<WorkCheck> {
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 1200,
      thinking: { type: "disabled" },
      system: CHECKWORK_SYSTEM,
      messages: [
        {
          role: "user",
          content: attemptContent(
            `Problem:\n${request.problem.problemText}\n\nMy attempt:\n${request.attempt.text ?? "(see image)"}`,
            request.attempt.imageDataUrl,
          ),
        },
      ],
      output_config: { format: zodOutputFormat(WorkCheckSchema) },
    });
    logUsage("checkWork", res);
    const out = required(res.parsed_output, "work check");
    return { ...out, firstError: out.firstError ?? undefined };
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
          content: `Original problem:\n${request.problem.problemText}\nSubject: ${request.problem.subject}. Concept: ${request.problem.concept}.\n\n${
            request.focus
              ? `The student has a RECURRING misconception on "${request.focus.concept}": ${request.focus.studentBelief ?? "they keep applying it incorrectly"}.${request.focus.correctModel ? ` The correct model: ${request.focus.correctModel}.` : ""}\nEngineer ONE problem that specifically probes this: it must be solvable correctly ONLY by applying the correct model, so that this exact misconception would lead to a wrong answer. Keep it at matching difficulty and do NOT hint at the misconception in the problem text.`
              : "Generate one similar practice problem."
          }`,
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
    const hasAttempt = !!(request.attempt.text?.trim() || request.attempt.imageDataUrl);
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 1800,
      thinking: { type: "disabled" },
      system: EVALUATE_SYSTEM,
      messages: [
        {
          role: "user",
          content: attemptContent(
            `Practice problem:\n${request.practice.problemText}\nConcept: ${request.practice.concept}.\n\n${
              hasAttempt
                ? `My attempt:\n${request.attempt.text ?? "(see image)"}`
                : "I'd like to see the worked solution without attempting."
            }`,
            request.attempt.imageDataUrl,
          ),
        },
      ],
      output_config: { format: zodOutputFormat(PracticeEvaluationSchema) },
    });
    logUsage("evaluatePractice", res);
    return required(res.parsed_output, "practice evaluation");
  }
}

// --- Helpers ----------------------------------------------------------------

/** Turn a button/free-form action into the user turn that drives the tutor. */
function actionPrompt(request: TutorRequest): string {
  switch (request.action) {
    case "continue":
      return "Continue: give the next single small piece that builds on what you just said, then stop.";
    case "hint":
      return "Give me just a hint: the smallest nudge toward the next step from where I am right now. One sentence. Don't give the full method.";
    case "explain":
      return "Explain the key idea behind this problem — but one small piece at a time, then stop.";
    case "go_deeper":
      return "Go one level deeper, starting from a more fundamental concept — one small piece, then stop.";
    case "show_solution":
      return "Show me the complete worked solution, concept first.";
    case "similar_problem":
      return "Give me a similar practice problem that tests the same concept with different numbers.";
    case "ask":
    default: {
      const text = request.studentText?.trim();
      return text
        ? text
        : "Start the session: give a brief, concept-first opener for this problem — one small piece, then stop.";
    }
  }
}

/** A short personalization block appended to the tutor's system prompt. */
function preferencesBlock(prefs?: TutorPreferences): string {
  if (!prefs) return "";
  const grade =
    prefs.grade && prefs.grade !== "other"
      ? `Student is in grade ${prefs.grade}. Use it ONLY to calibrate vocabulary and assumed baseline — do NOT assume any specific courses, topics, or techniques from it.`
      : "";
  const style =
    prefs.assistanceStyle === "direct"
      ? "Default lean: explain directly rather than making them guess, while still leaving the final connection to them."
      : "Default lean: hints first — make the student do the thinking; only explain outright when a hint won't unblock them.";
  const goal =
    prefs.goal === "exam"
      ? "Emphasis: exam readiness — highlight the exam-relevant reasoning and the traps, while still building real understanding."
      : prefs.goal === "understand"
        ? "Emphasis: deep understanding — prioritize the why and the connections; keep exam-relevance in view."
        : "Emphasis: both exam readiness and deep understanding — exam-relevant reasoning grounded in the underlying why.";
  return `\n\n# This student\n${[grade, style, goal].filter(Boolean).join("\n")}`;
}

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

/**
 * Convert the model's pixel corners into normalised rects, clamp them into the
 * image, drop degenerate ones, and keep `primaryIndex` valid. The cropper
 * treats an empty list as "whole photo".
 */
function normalizeDetection(
  raw: z.infer<typeof QuestionDetectionSchema>,
  width: number,
  height: number,
): QuestionDetection {
  // A bad width/height would silently place every box wrong, so refuse rather
  // than divide by it.
  if (!(width > 0) || !(height > 0)) return { questions: [], primaryIndex: 0 };

  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  const questions = raw.questions
    .map((q, i) => {
      // Tolerate corners handed back in either order.
      const left = clamp01(Math.min(q.x1, q.x2) / width);
      const right = clamp01(Math.max(q.x1, q.x2) / width);
      const top = clamp01(Math.min(q.y1, q.y2) / height);
      const bottom = clamp01(Math.max(q.y1, q.y2) / height);
      return {
        label: q.label.trim() || `Question ${i + 1}`,
        rect: { x: left, y: top, w: right - left, h: bottom - top },
      };
    })
    .filter((q) => q.rect.w > 0.02 && q.rect.h > 0.01);
  const primaryIndex =
    Number.isInteger(raw.primaryIndex) &&
    raw.primaryIndex >= 0 &&
    raw.primaryIndex < questions.length
      ? raw.primaryIndex
      : 0;
  return { questions, primaryIndex };
}

/** Assert the model returned a validly-parsed structured object. */
function required<T>(value: T | null | undefined, what: string): T {
  if (value == null) {
    throw new Error(`Model did not return a valid ${what}.`);
  }
  return value;
}
