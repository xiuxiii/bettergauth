import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

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
import { SYSTEM_INSTRUCTIONS } from "@/lib/tutor/engine";

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

const ProblemAnalysisSchema = z.object({
  problemText: z.string(),
  subject: SubjectSchema,
  topic: z.string(),
  concept: z.string(),
  confidence: z.number(),
});

const StructuredSolutionSchema = z.object({
  understanding: z.string(),
  keyConcept: z.string(),
  reasoning: z.string(),
  solution: z.string(),
  finalAnswer: z.string(),
  takeaway: z.string(),
});

const TutorMessageSchema = z.object({ message: z.string() });
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

const ANALYZE_SYSTEM = `You extract a single high-school STEM problem from a photo and classify it.
Read the problem exactly as written (including all parts), identify the subject, a specific topic, and the single governing concept/principle the problem hinges on. Set confidence in 0..1 for how sure the extraction+classification is. ${MATH_NOTE}`;

const CHECKWORK_SYSTEM = `You are an expert STEM tutor checking a student's attempt.
Find the FIRST meaningful error, not just a wrong final answer. Classify it by category and severity. If the underlying concept/method is right, say so and keep any arithmetic/notation correction to one line — do NOT nitpick. If the whole attempt is correct, set verdict "correct" and leave firstError null. Always say briefly what the student did right and how to continue from the corrected point. ${MATH_NOTE}`;

const GENERATE_SYSTEM = `You generate ONE fresh practice problem testing the SAME concept as the given problem, with different numbers and context so memorization is useless, at matching or slightly higher difficulty, avoiding unnecessary complexity. Do NOT include or reveal a solution — the student solves it first. ${MATH_NOTE}`;

const EVALUATE_SYSTEM = `You evaluate a student's attempt at a practice problem across five axes: concept selection, reasoning, setup, execution, final answer — each correct | minor_issue | incorrect | not_shown, with a short note. Give "focus": the single most important thing to fix or reinforce. Include the worked solution. If the student submitted no attempt (they asked to just see the solution), set every rubric status to "not_shown" and still provide the solution. ${MATH_NOTE}`;

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
    this.model = config.model ?? "claude-opus-5";
  }

  async analyzeProblem(request: AnalyzeRequest): Promise<ProblemAnalysis> {
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2000,
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
    return required(res.parsed_output, "problem analysis");
  }

  async tutor(request: TutorRequest): Promise<TutorTurn> {
    const system = `${SYSTEM_INSTRUCTIONS}

# Current problem
${request.problem.problemText}
Subject: ${request.problem.subject}. Topic: ${request.problem.topic}. Governing concept: ${request.problem.concept}.`;

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: `Here is the problem I'm working on:\n${request.problem.problemText}` },
      ...request.history.map(
        (m): Anthropic.MessageParam => ({
          role: m.role === "student" ? "user" : "assistant",
          content: m.content,
        }),
      ),
      { role: "user", content: actionPrompt(request) },
    ];

    if (request.action === "show_solution") {
      const res = await this.client.messages.parse({
        model: this.model,
        max_tokens: 4000,
        system,
        messages,
        output_config: { format: zodOutputFormat(TutorSolutionSchema) },
      });
      const out = required(res.parsed_output, "solution");
      return { message: out.message, solution: out.solution };
    }

    if (request.action === "similar_problem") {
      const res = await this.client.messages.parse({
        model: this.model,
        max_tokens: 2000,
        system,
        messages,
        output_config: { format: zodOutputFormat(TutorSimilarSchema) },
      });
      const out = required(res.parsed_output, "similar problem");
      return { message: out.message, similarProblem: out.similarProblem };
    }

    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2000,
      system,
      messages,
      output_config: { format: zodOutputFormat(TutorMessageSchema) },
    });
    return { message: required(res.parsed_output, "tutor reply").message };
  }

  async checkWork(request: CheckWorkRequest): Promise<WorkCheck> {
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2500,
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
    const out = required(res.parsed_output, "work check");
    return { ...out, firstError: out.firstError ?? undefined };
  }

  async generatePractice(
    request: GeneratePracticeRequest,
  ): Promise<PracticeProblem> {
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 1500,
      system: GENERATE_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Original problem:\n${request.problem.problemText}\nSubject: ${request.problem.subject}. Concept: ${request.problem.concept}.\n\nGenerate one similar practice problem.`,
        },
      ],
      output_config: { format: zodOutputFormat(PracticeProblemSchema) },
    });
    return required(res.parsed_output, "practice problem");
  }

  async evaluatePractice(
    request: EvaluatePracticeRequest,
  ): Promise<PracticeEvaluation> {
    const hasAttempt = !!(request.attempt.text?.trim() || request.attempt.imageDataUrl);
    const res = await this.client.messages.parse({
      model: this.model,
      max_tokens: 4000,
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
    return required(res.parsed_output, "practice evaluation");
  }
}

// --- Helpers ----------------------------------------------------------------

/** Turn a button/free-form action into the user turn that drives the tutor. */
function actionPrompt(request: TutorRequest): string {
  switch (request.action) {
    case "hint":
      return "Give me just a hint — the smallest possible nudge toward the next step. Don't give the full method.";
    case "explain":
      return "Explain the key idea and the reasoning behind this problem, directly and concisely.";
    case "go_deeper":
      return "Go one level deeper: build the explanation from a more fundamental concept, then end with a quick check question.";
    case "show_solution":
      return "Show me the complete worked solution, concept first.";
    case "similar_problem":
      return "Give me a similar practice problem that tests the same concept with different numbers.";
    case "ask":
    default: {
      const text = request.studentText?.trim();
      return text
        ? text
        : "Start the session: give a brief, concept-first opener for this problem, per your instructions.";
    }
  }
}

/** User content that carries a text block plus an optional work image. */
function attemptContent(
  text: string,
  imageDataUrl?: string,
): Anthropic.MessageParam["content"] {
  if (!imageDataUrl) return text;
  return [{ type: "text", text }, imageBlock(imageDataUrl)];
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

/** Assert the model returned a validly-parsed structured object. */
function required<T>(value: T | null | undefined, what: string): T {
  if (value == null) {
    throw new Error(`Model did not return a valid ${what}.`);
  }
  return value;
}
