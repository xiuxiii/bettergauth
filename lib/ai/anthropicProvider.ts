import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

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
  TutorPreferences,
  TutorStreamEvent,
  TutorTurn,
  TutorRequest,
  WorkCheck,
} from "@/lib/tutor/types";
import { emptySessionMemory,
  normalizeAnalysis } from "@/lib/tutor/types";
import { SYSTEM_INSTRUCTIONS } from "@/lib/tutor/engine";
import { ALL_CONCEPTS, conceptsFor } from "@/lib/tutor/concepts";
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
/**
 * "Is there anything here to tutor at all?" — decided BEFORE anything else, so
 * a photo of dinner stops at one cheap boolean instead of paying for a full
 * analysis and then failing. Defined by content, not by a printed question
 * number: in Ask mode the photo is often just a diagram, and that must pass.
 */
const STEM_CONTENT_NOTE = `First decide hasStemContent: is there a maths or science problem here — mathematics, physics, chemistry or biology? That means an equation or expression, a diagram, graph or table, worked steps, or a question in one of those subjects. The same rule applies whether the input is a photo or typed text. It is FALSE for: a photo of food, a room, a person, a pet, a screen showing something unrelated, a blank page or a blurred accidental shot; homework in any other subject (an essay, a book report, history, a language exercise); and requests that aren't a problem at all (write me something, chat). When a PHOTO is merely hard to read (faint pencil, a partial page, an unusual diagram), set it TRUE — wrongly turning away a real problem is worse than analyzing a poor photo. Doubt about the SUBJECT is not that kind of doubt: an essay prompt is not STEM however it is phrased.`;

const QuestionDetectionSchema = z.object({
  hasStemContent: z.boolean(),
  questions: z.array(
    z.object({
      label: z.string(),
      hasWorking: z.boolean(),
      x1: z.number(),
      y1: z.number(),
      x2: z.number(),
      y2: z.number(),
    }),
  ),
  primaryIndex: z.number(),
});

const ProblemAnalysisSchema = z.object({
  hasStemContent: z.boolean(),
  problemText: z.string(),
  subject: SubjectSchema,
  topic: z.string(),
  /** Safe label, shown before any work. Also the concept-tracking key. */
  concept: z.string(),
  /** The insight. Hidden from the student until the gap is resolved. */
  keyIdea: z.string(),
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
  /** Typed input only: the student's own working, verbatim. "" for photos. */
  attemptText: z.string(),
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
/** The canonical gap labels (lib/tutor/concepts.ts), so memory merges. */
const ConceptSchema = z.enum(ALL_CONCEPTS);

const SessionMemorySchema = z.object({
  demonstrated: z.array(ConceptSchema),
  misconceptions: z.array(
    z.object({
      concept: ConceptSchema,
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
      concept: ConceptSchema,
    }),
  ),
  bottleneck: z.string(),
});

/** Conceptual moves: one small piece, whether more remains, updated memory. */
const TutorChunkSchema = z.object({
  message: z.string(),
  hasMore: z.boolean(),
  /** The student has just solved it / fixed the flagged step, confirmed. */
  resolved: z.boolean(),
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
  line: z.string(),
  locate: z.string(),
  nudge: z.string(),
  diagnosis: z.string(),
  fix: z.string(),
});

/**
 * Field order is the reveal order. Each piece is its own field, written to
 * stand alone, so the UI shows one per tap instead of hiding parts of prose
 * that gave everything away in its first sentence.
 */
const WorkCheckSchema = z.object({
  verdict: z.enum(["correct", "partially_correct", "error_found"]),
  headline: z.string(),
  strength: z.string(),
  firstError: WorkErrorSchema.nullable(),
  continueFrom: z.string(),
  concept: ConceptSchema,
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

const PROGRESS_SYSTEM = `You write a short, honest read on what a high-school STEM student keeps getting wrong, from a ranked list of concepts and the mistakes logged against each.

Write to the student, in second person. Two or three short paragraphs at most.

Lead with the pattern ACROSS concepts, not a restatement of the list: the list is already on screen above you, and repeating it back is wasted words. If several concepts share a root cause (sign errors under pressure, skipping the diagram, trusting a memorised formula over the setup), say that. If there is genuinely no pattern beyond "these two are unrelated gaps", say that instead of inventing a connection.

Then give ONE concrete thing to do next. Not a study plan, not a list: the single next action.

Never guess at causes you cannot see, never speculate about their effort, attitude or ability, and never be discouraging. A student reading this should feel like they have been given a specific, fixable target. ${STYLE_NOTE}`;

const DETECT_SYSTEM = `You locate the individual questions in a photo of a worksheet, textbook page or screen so an app can crop to one of them.

${STEM_CONTENT_NOTE} If it is false, return no questions.

Return the bounding box of each question as ABSOLUTE PIXEL coordinates in the image you were given: x1, y1 is the top-left corner and x2, y2 is the bottom-right corner, with (0, 0) at the top-left of the image, x increasing right and y increasing down. The user message states the image's exact pixel dimensions; every coordinate must fall inside them. Do not return fractions or percentages.

Getting the box on the RIGHT question matters more than getting its edges perfect. Before you emit each entry, check that the question number printed inside that box is the number you are about to use as its label. If they disagree, fix the box.

What counts as a question: one numbered problem together with all of its parts, sub-parts, figures and answer options. Its box must fully contain it with a small margin and must not overlap a neighbouring question.

A question's box must ALSO contain any handwritten working the student has already done for it, usually below or beside the printed question. They often photograph a problem they have already attempted, and work left outside the box is lost. Stop before the next numbered question even when working runs close to it, and never extend a box ABOVE its own printed number: working written above that number belongs to the question before it, not this one. Set hasWorking true for a question whose box contains the student's own HANDWRITTEN working; printed text, a printed answer or a worked example never counts.

Ignore everything that is not printed exercise content. Photos are taken on a desk, so a calculator, phone, pen, ruler, hand or any other object lying on the page is NEVER a question, and neither is a running header, a page number, a chapter title or a section heading on its own.

Pages photographed as a two-page spread have independent columns: read each column top to bottom, left-hand page before right-hand page.

Label each entry with the number printed at the start of that question ("Question 5", "Q5", "3(b)"). If a region has no printed number of its own, do not return it. Return only questions you can actually see a number for; five correct boxes are far better than eight with three in the wrong place.

If the photo shows a single problem, or only a fragment of one, return exactly one box around it. Set primaryIndex to the question most likely intended: the most complete, central one, or the only one.`;

const ANALYZE_SYSTEM = `You extract a single high-school STEM problem from a photo and classify it.

${STEM_CONTENT_NOTE} If it is false, leave the other fields empty or minimal; nothing downstream will read them.

Read the problem exactly as written (including all parts), identify the subject and a specific topic. Set confidence in 0..1 for how sure the extraction+classification is.

Two fields describe the idea, and they are shown at very different times:
- \`concept\` is shown on screen BEFORE the student has worked anything, so it must not give anything away. 2 to 5 words naming the idea AREA, like a textbook section title: "Friction on an incline", "Limiting reagent", "Chain rule". Never the method, never which quantity to use, never the fix. "Friction using the normal force mg cos θ" is WRONG: that is the answer to the most common mistake. Use the same wording you would for any other problem on this idea, because it is also how this student's gaps are grouped across problems.
- \`keyIdea\` is the governing insight the problem hinges on, one sentence ("On an incline the normal force is only the perpendicular part of the weight, so friction is μmg cos θ."). It is kept hidden until the student has closed the gap or asked for the solution, so state it plainly.

The photo often ALSO contains the student's own handwritten attempt, because they
photograph problems they have already worked on. Separate the two:
- \`problemText\` is the PRINTED question ONLY. Never fold handwriting into it. This text is shown to the tutor as the problem itself every turn, so a student's wrong working leaking into it would be read as part of the question.
- Set \`studentWork.present\` true ONLY for HANDWRITTEN working that is this student's own attempt at this problem. Printed text never counts: a worked example, a textbook solution, an answer key or the question's own printed answer options are all part of the page, not an attempt. Stray doodles, labels on a diagram, and a lone underlined final answer with no reasoning are not an attempt either.
- For a PHOTO, do NOT transcribe the working. Only say whether it is there; something else reads it. Leave \`attemptText\` empty.
- For TYPED input, the student sometimes types their own working after the question ("My work: 5x = 18 + 3 …"). Then \`problemText\` is the question alone, \`studentWork.present\` is true, and \`attemptText\` is their working copied VERBATIM — every step exactly as typed, nothing fixed or added. With no working typed, \`attemptText\` is empty.

\`openingHint\` is the first thing the student reads, so make it worth reading:
ONE short sentence that points at where to start, and nothing else. Name the move
or the thing to notice, never the answer and never the full method. "Every root
divides 6, so start there." or "Resolve the weight along the incline first." Never
state the keyIdea: the hint points them toward it, it does not hand it over. Talk
like a person: contractions, "you", no preamble, no sign-off, no restating the
question, no mention of buttons or what the app can do. If the photo already
contains the student's working, still write it, but aimed at the next step from
where they are. ${MATH_NOTE}`;

const CHECKWORK_SYSTEM = `You are an expert STEM tutor diagnosing a student's attempt.

Trace the student's OWN reasoning and find the FIRST point where it diverges from correct reasoning — not just a wrong final answer. Diagnose it in terms of THEIR mental model: what their work assumes or treats as true. Do not replace their reasoning with a fresh solution of your own.

The worst thing you can do is tell a correct student they are wrong. Before flagging anything, check whether their approach is a valid alternative: an unconventional method that is sound (completing the square instead of the formula, doubling the time to the top instead of using the full-flight equation, a different but valid sign convention) is CORRECT. If you cannot point to a specific line that is actually wrong, the verdict is "correct".

The student reveals your diagnosis one piece at a time, so each field must stand on its own and must not leak the next one:
- headline: ONE sentence on where things stand. No fix, no answer. "Your setup holds until the friction step."
- strength: one short line on what is genuinely right. Empty if nothing is. Never praise for its own sake.
- firstError.line: the flagged line quoted exactly as they wrote it, e.g. "f = μmg". Empty string if you cannot read it.
- firstError.locate: WHERE the error is and WHAT KIND of thing is off, never the fix. "Line 3: something's off with which force the friction depends on." Do not name the correct quantity.
- firstError.nudge: ONE question that would let them find it themselves. It must not contain the correction, the right quantity or the right formula. "On a slope, what is the surface actually pushing back against?"
- firstError.diagnosis: what their work assumes, in their terms. "Your working treats the block as if it sat on flat ground, so the normal force is its full weight."
- firstError.fix: the corrected idea or step, stated plainly. It must NOT contain the final numeric answer.
- continueFrom: the remaining steps from the corrected point to the end. This is the ONLY field that may contain the final answer. For a correct attempt, say briefly why their reasoning holds.

Category — pick the one that names the ROOT cause:
- conceptual: a wrong model of a quantity or idea. Using a whole vector where a component belongs, treating equilibrium as equal amounts, thinking constant velocity needs a net force.
- model_selection: the wrong principle or equation for the situation, e.g. constant-acceleration equations when the acceleration varies.
- setup: the right principle and the right model, but the problem translated into equations wrongly, e.g. a value copied wrong or a missing term.
- procedural: a step of an otherwise right method executed wrongly.
- arithmetic: a number or algebra slip. Severity minor.
- units_notation: units, significant figures or notation only. Severity minor.
If the concept is sound and the slip is minor, keep every field short. Do not nitpick.

concept: ONE label, copied exactly from the list in the message, naming the idea the attempt hinges on. For an error it is the idea the FIRST error is about, not the problem's chapter: a height used as a time in a free-fall problem is "Variables and symbols"; the whole speed used where a component belongs is "Vector components". For a correct attempt it is the main idea the attempt got right. Use the same label every time the same gap appears, so it adds up across problems.

If the message says this is a RETRY of a flagged step, judge that step first. If it is now right and nothing after it breaks, the verdict is "correct" and the headline says so.

You are reading their ACTUAL HANDWRITING off a photo, so read it carefully and honestly:
- Diagnose only steps you can genuinely see. NEVER invent a line that would explain their answer, and never fill in a step they did not write. If something is illegible, leave line empty and say in locate that the line is hard to read.
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
              text: `This image is exactly ${request.width} x ${request.height} pixels. Locate every question in it and give each box in pixel coordinates within those bounds.`,
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
      },
    };
  }

  async summarizeProgress(request: ProgressRequest): Promise<string> {
    const lines = request.concepts.map((c) => {
      const bits = [
        `${c.concept}: ${c.errors} error${c.errors === 1 ? "" : "s"} across ${c.problems} problem${c.problems === 1 ? "" : "s"}`,
        c.types.length ? `types: ${c.types.join(", ")}` : "",
        c.studentBelief ? `they believe: ${c.studentBelief}` : "",
        c.correctModel ? `correct: ${c.correctModel}` : "",
      ].filter(Boolean);
      return `- ${bits.join(" | ")}`;
    });

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
          content: `Concepts I keep missing, worst first:\n${lines.join("\n")}`,
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
    const memory = request.memory ?? emptySessionMemory();
    // A session reopened from history may predate the concept/keyIdea split.
    const problem = normalizeAnalysis(request.problem);
    const system: Anthropic.TextBlockParam[] = [
      {
        type: "text",
        text: SYSTEM_INSTRUCTIONS,
        cache_control: { type: "ephemeral" },
      },
      {
        type: "text",
        text: `# Current problem\n${problem.problemText}\nSubject: ${problem.subject}. Topic: ${problem.topic}. Concept: ${problem.concept}.${problem.keyIdea ? `\nKey idea (for you, not the student — never state it outright until they have closed the gap themselves or asked for the solution): ${problem.keyIdea}` : ""}${preferencesBlock(request.preferences)}`,
      },
      {
        type: "text",
        text: `# Running student model (your cross-turn memory)
Use this, and RETURN it updated as \`memory\` this turn:
${JSON.stringify(memory)}

Maintain it honestly from evidence:
- Add a concept to \`demonstrated\` once the student has PROVEN they know it — never re-explain those.
- Every concept in memory is one label copied exactly from this list, naming the idea a mistake is ABOUT (not the problem's chapter), so the same gap merges across problems: ${conceptsFor(problem.subject).join("; ")}.
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
    const retry = request.retryOf
      ? `\n\nThis is a RETRY. Earlier I got this step wrong — ${request.retryOf.locate}${request.retryOf.line ? ` (I had written: ${request.retryOf.line})` : ""}. Judge that step first.`
      : "";

    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: THINKING_MAX_TOKENS,
      thinking,
      system: CHECKWORK_SYSTEM,
      messages: [
        {
          role: "user",
          content: attemptContent(
            `Problem:\n${request.problem.problemText}\n\nMy attempt:\n${request.attempt.text ?? "(see image)"}${retry}\n\nConcept labels to choose from: ${conceptsFor(request.problem.subject).join("; ")}.`,
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
    yield {
      type: "done",
      check: { ...out, firstError: out.firstError ?? undefined },
    };
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
          content: `Original problem:\n${request.problem.problemText}\nSubject: ${request.problem.subject}. Concept: ${request.problem.concept}.${request.problem.keyIdea ? ` Key idea: ${request.problem.keyIdea}.` : ""}\n\n${
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
              `Practice problem:\n${request.practice.problemText}\nConcept: ${request.practice.concept}.\n\n${
                hasAttempt
                  ? `My attempt:\n${request.attempt.text ?? "(see image)"}`
                  : "I'd like to see the worked solution without attempting."
              }`,
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
    case "question": {
      // Ask mode. The student photographed something and asked a specific
      // question about it, so the value is in the explanation itself. Under a
      // hint-first preference the plain "ask" path could reasonably answer
      // "why is T equal to Fg?" with a counter-question, which is exactly what
      // they came here to avoid.
      const q = request.studentText?.trim() || "What is going on here?";
      return `I photographed this and my question is: "${q}"\n\nAnswer that question directly. Explain the concept behind it, tied to what is actually in the photo, the way a good teacher would at the board. Do not turn it into a hint or answer with a question of your own. Keep it short enough for a phone.`;
    }
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
      : "Default lean: hints first. When they ASSERT something, first check it against the problem. If it is right, confirm it plainly (and own it if it corrects something you said). If, once checked, it is actually wrong and reveals a misconception (including a '…right?' seeking confirmation of a wrong claim), reply with one targeted question or a partial step before explaining, and explain directly once they ask for it or are still stuck after that one try. Anything they explicitly request — why, a hint, the answer, the solution — is honoured at once.";
  const goal =
    prefs.goal === "exam"
      ? "Emphasis: exam readiness — highlight the exam-relevant reasoning and the traps, while still building real understanding."
      : prefs.goal === "understand"
        ? "Emphasis: deep understanding — prioritize the why and the connections; keep exam-relevance in view."
        : "Emphasis: both exam readiness and deep understanding — exam-relevant reasoning grounded in the underlying why.";
  // No line for "standard": that is the model's default register already, and
  // naming it would only nudge the wording somewhere it didn't need to go.
  const curriculum =
    prefs.curriculum === "ib"
      ? "Curriculum: IB. Use IB terminology and notation, and IB command terms (determine, deduce, show that, explain) where they fit naturally."
      : prefs.curriculum === "ap"
        ? "Curriculum: AP. Use College Board AP terminology and notation where it fits naturally."
        : "";
  return `\n\n# This student\n${[grade, curriculum, style, goal].filter(Boolean).join("\n")}`;
}

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
  const hasStemContent = raw.hasStemContent !== false;
  if (!(width > 0) || !(height > 0)) {
    return { hasStemContent, questions: [], primaryIndex: 0 };
  }

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
        hasWorking: q.hasWorking === true,
      };
    })
    .filter((q) => q.rect.w > 0.02 && q.rect.h > 0.01);
  const primaryIndex =
    Number.isInteger(raw.primaryIndex) &&
    raw.primaryIndex >= 0 &&
    raw.primaryIndex < questions.length
      ? raw.primaryIndex
      : 0;
  return { hasStemContent, questions, primaryIndex };
}

/**
 * Server-side backstop for the not-STEM gate. The model has been seen to answer
 * an essay request with hasStemContent TRUE while labelling it subject
 * "Unknown", topic "Not applicable" — it knew, and said so in the wrong field.
 * Those two together mean there is nothing to tutor, whatever the flag says.
 */
function guardNotStem(a: ProblemAnalysis): ProblemAnalysis {
  const notApplicable = /not applicable|^n\/?a$|not a stem|not stem|^none$/i;
  if (
    a.hasStemContent !== false &&
    a.subject === "Unknown" &&
    (notApplicable.test(a.topic.trim()) || notApplicable.test(a.concept.trim()))
  ) {
    return { ...a, hasStemContent: false };
  }
  return a;
}

/** Assert the model returned a validly-parsed structured object. */
function required<T>(value: T | null | undefined, what: string): T {
  if (value == null) {
    throw new Error(`Model did not return a valid ${what}.`);
  }
  return value;
}
