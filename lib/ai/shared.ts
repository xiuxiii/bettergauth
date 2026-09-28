import "server-only";

import { z } from "zod";

import type {
  CheckWorkRequest,
  EvaluatePracticeRequest,
  GeneratePracticeRequest,
  ProgressRequest,
  QuestionDetection,
  SessionMemory,
  TutorPreferences,
  TutorRequest,
} from "@/lib/tutor/types";
import { emptySessionMemory, normalizeAnalysis } from "@/lib/tutor/types";
import { SYSTEM_INSTRUCTIONS } from "@/lib/tutor/engine";

/**
 * What every provider asks the model, independent of how it is asked.
 *
 * The schemas, system prompts and prompt helpers live here so Claude
 * (anthropicProvider.ts) and DeepSeek (deepseekProvider.ts) send the same
 * instructions and are validated against the same shapes. Only the transport
 * differs: Claude enforces the schema natively through structured outputs,
 * DeepSeek gets it in the prompt and is validated after the fact.
 */
// --- Domain-mirroring schemas (validated model output) ----------------------

export const SubjectSchema = z.enum([
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
export const STEM_CONTENT_NOTE = `First decide hasStemContent: does this photo contain ANY study material at all — printed or handwritten text, an equation or expression, a diagram, graph, table, or worked steps? A photo of food, a room, a person, a pet, a screen showing something unrelated, a blank page, or a blurred accidental shot does NOT: set hasStemContent false. When in doubt (faint pencil, a partial page, an unusual diagram), set it TRUE — wrongly turning away a real problem is worse than analyzing a poor photo.`;

export const QuestionDetectionSchema = z.object({
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

export const ProblemAnalysisSchema = z.object({
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
  /** The session's opening nudge. Free: it rides along on this same call. */
  openingHint: z.string(),
});

export const StructuredSolutionSchema = z.object({
  understanding: z.string(),
  keyConcept: z.string(),
  reasoning: z.string(),
  solution: z.string(),
  finalAnswer: z.string(),
  takeaway: z.string(),
});

/** The tutor's compact cross-turn memory (mirrors SessionMemory). */
export const SessionMemorySchema = z.object({
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
export const TutorChunkSchema = z.object({
  message: z.string(),
  hasMore: z.boolean(),
  memory: SessionMemorySchema,
});
export const TutorSolutionSchema = z.object({
  message: z.string(),
  solution: StructuredSolutionSchema,
});
export const TutorSimilarSchema = z.object({
  message: z.string(),
  similarProblem: z.string(),
});

export const WorkErrorSchema = z.object({
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
export const WorkCheckSchema = z.object({
  verdict: z.enum(["correct", "partially_correct", "error_found"]),
  headline: z.string(),
  strength: z.string(),
  firstError: WorkErrorSchema.nullable(),
  continueFrom: z.string(),
});

export const PracticeProblemSchema = z.object({
  problemText: z.string(),
  subject: SubjectSchema,
  topic: z.string(),
  concept: z.string(),
  difficulty: z.enum(["same", "slightly_harder"]),
});

export const RubricResultSchema = z.object({
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

export const PracticeEvaluationSchema = z.object({
  verdict: z.enum(["correct", "partially_correct", "incorrect"]),
  rubric: z.array(RubricResultSchema),
  focus: z.string(),
  summary: z.string(),
  solution: StructuredSolutionSchema,
});

// --- Task system prompts ----------------------------------------------------

export const MATH_NOTE =
  "Write all mathematics as LaTeX: $...$ for inline and $$...$$ for block equations.";

export const STYLE_NOTE =
  "Formatting: write for a phone screen. Keep every paragraph to 1-3 short sentences separated by a blank line. Use \"- \" bullets for parallel items and \"1. \" for ordered steps, one idea per line, and put key equations on their own line. Avoid em-dashes: use a period, comma, or colon instead. Never return a dense wall of text.";

export const PROGRESS_SYSTEM = `You write a short, honest read on what a high-school STEM student keeps getting wrong, from a ranked list of concepts and the mistakes logged against each.

Write to the student, in second person. Two or three short paragraphs at most.

Lead with the pattern ACROSS concepts, not a restatement of the list: the list is already on screen above you, and repeating it back is wasted words. If several concepts share a root cause (sign errors under pressure, skipping the diagram, trusting a memorised formula over the setup), say that. If there is genuinely no pattern beyond "these two are unrelated gaps", say that instead of inventing a connection.

Then give ONE concrete thing to do next. Not a study plan, not a list: the single next action.

Never guess at causes you cannot see, never speculate about their effort, attitude or ability, and never be discouraging. A student reading this should feel like they have been given a specific, fixable target. ${STYLE_NOTE}`;

export const DETECT_SYSTEM = `You locate the individual questions in a photo of a worksheet, textbook page or screen so an app can crop to one of them.

${STEM_CONTENT_NOTE} If it is false, return no questions.

Return the bounding box of each question as ABSOLUTE PIXEL coordinates in the image you were given: x1, y1 is the top-left corner and x2, y2 is the bottom-right corner, with (0, 0) at the top-left of the image, x increasing right and y increasing down. The user message states the image's exact pixel dimensions; every coordinate must fall inside them. Do not return fractions or percentages.

Getting the box on the RIGHT question matters more than getting its edges perfect. Before you emit each entry, check that the question number printed inside that box is the number you are about to use as its label. If they disagree, fix the box.

What counts as a question: one numbered problem together with all of its parts, sub-parts, figures and answer options. Its box must fully contain it with a small margin and must not overlap a neighbouring question.

A question's box must ALSO contain any handwritten working the student has already done for it, usually below or beside the printed question. They often photograph a problem they have already attempted, and work left outside the box is lost. Stop before the next numbered question even when working runs close to it, and never extend a box ABOVE its own printed number: working written above that number belongs to the question before it, not this one. Set hasWorking true for a question whose box contains the student's own HANDWRITTEN working; printed text, a printed answer or a worked example never counts.

Ignore everything that is not printed exercise content. Photos are taken on a desk, so a calculator, phone, pen, ruler, hand or any other object lying on the page is NEVER a question, and neither is a running header, a page number, a chapter title or a section heading on its own.

Pages photographed as a two-page spread have independent columns: read each column top to bottom, left-hand page before right-hand page.

Label each entry with the number printed at the start of that question ("Question 5", "Q5", "3(b)"). If a region has no printed number of its own, do not return it. Return only questions you can actually see a number for; five correct boxes are far better than eight with three in the wrong place.

If the photo shows a single problem, or only a fragment of one, return exactly one box around it. Set primaryIndex to the question most likely intended: the most complete, central one, or the only one.`;

export const ANALYZE_SYSTEM = `You extract a single high-school STEM problem from a photo and classify it.

${STEM_CONTENT_NOTE} If it is false, leave the other fields empty or minimal; nothing downstream will read them.

Read the problem exactly as written (including all parts), identify the subject and a specific topic. Set confidence in 0..1 for how sure the extraction+classification is.

Two fields describe the idea, and they are shown at very different times:
- \`concept\` is shown on screen BEFORE the student has worked anything, so it must not give anything away. 2 to 5 words naming the idea AREA, like a textbook section title: "Friction on an incline", "Limiting reagent", "Chain rule". Never the method, never which quantity to use, never the fix. "Friction using the normal force mg cos θ" is WRONG: that is the answer to the most common mistake. Use the same wording you would for any other problem on this idea, because it is also how this student's gaps are grouped across problems.
- \`keyIdea\` is the governing insight the problem hinges on, one sentence ("On an incline the normal force is only the perpendicular part of the weight, so friction is μmg cos θ."). It is kept hidden until the student has closed the gap or asked for the solution, so state it plainly.

The photo often ALSO contains the student's own handwritten attempt, because they
photograph problems they have already worked on. Separate the two:
- \`problemText\` is the PRINTED question ONLY. Never fold handwriting into it. This text is shown to the tutor as the problem itself every turn, so a student's wrong working leaking into it would be read as part of the question.
- Set \`studentWork.present\` true ONLY for HANDWRITTEN working that is this student's own attempt at this problem. Printed text never counts: a worked example, a textbook solution, an answer key or the question's own printed answer options are all part of the page, not an attempt. Stray doodles, labels on a diagram, and a lone underlined final answer with no reasoning are not an attempt either.
- Do NOT transcribe the working. Only say whether it is there; something else reads it.

\`openingHint\` is the first thing the student reads, so make it worth reading:
ONE short sentence that points at where to start, and nothing else. Name the move
or the thing to notice, never the answer and never the full method. "Every root
divides 6, so start there." or "Resolve the weight along the incline first." Never
state the keyIdea: the hint points them toward it, it does not hand it over. Talk
like a person: contractions, "you", no preamble, no sign-off, no restating the
question, no mention of buttons or what the app can do. If the photo already
contains the student's working, still write it, but aimed at the next step from
where they are. ${MATH_NOTE}`;

export const CHECKWORK_SYSTEM = `You are an expert STEM tutor diagnosing a student's attempt.

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

If the message says this is a RETRY of a flagged step, judge that step first. If it is now right and nothing after it breaks, the verdict is "correct" and the headline says so.

You are reading their ACTUAL HANDWRITING off a photo, so read it carefully and honestly:
- Diagnose only steps you can genuinely see. NEVER invent a line that would explain their answer, and never fill in a step they did not write. If something is illegible, leave line empty and say in locate that the line is hard to read.
- Printed text on the page is not theirs. Textbooks print the answer next to the question, e.g. "(ans: 42.4 N)", and that is the book talking, not the student. Never treat a printed answer, worked example or answer key as a step they wrote, and never reverse-engineer working to reach it.
- The photo may also catch working for a NEIGHBOURING question. Use only what belongs to the stated problem.
- Units here are almost always N, m, s, kg, J or degrees. A mark after a force value that looks like V or Y is nearly always N; a scrawled greek letter next to an angle is nearly always theta.
${MATH_NOTE} ${STYLE_NOTE}`;

export const GENERATE_SYSTEM = `You generate ONE fresh practice problem testing the SAME concept as the given problem, with different numbers and context so memorization is useless, at matching or slightly higher difficulty, avoiding unnecessary complexity. Do NOT include or reveal a solution — the student solves it first. ${MATH_NOTE}`;

export const EVALUATE_SYSTEM = `You evaluate a student's attempt at a practice problem across five axes: concept selection, reasoning, setup, execution, final answer — each correct | minor_issue | incorrect | not_shown, with a short note. Give "focus": the single most important thing to fix or reinforce. Include the worked solution. If the student submitted no attempt (they asked to just see the solution), set every rubric status to "not_shown" and still provide the solution. ${MATH_NOTE} ${STYLE_NOTE}`;

/** Turn a button/free-form action into the user turn that drives the tutor. */
export function actionPrompt(request: TutorRequest): string {
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
export function preferencesBlock(prefs?: TutorPreferences): string {
  if (!prefs) return "";
  const grade =
    prefs.grade && prefs.grade !== "other"
      ? `Student is in grade ${prefs.grade}. Use it ONLY to calibrate vocabulary and assumed baseline — do NOT assume any specific courses, topics, or techniques from it.`
      : "";
  const style =
    prefs.assistanceStyle === "direct"
      ? "Default lean: explain directly rather than making them guess, while still leaving the final connection to them."
      : "Default lean: hints first. When they ASSERT something that reveals a misconception (including a '…right?' seeking confirmation of a wrong claim), reply with one targeted question or a partial step before explaining, and explain directly once they ask for it or are still stuck after that one try. Anything they explicitly request — why, a hint, the answer, the solution — is honoured at once.";
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

/**
 * Convert the model's pixel corners into normalised rects, clamp them into the
 * image, drop degenerate ones, and keep `primaryIndex` valid. The cropper
 * treats an empty list as "whole photo".
 */
export function normalizeDetection(
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

/** Assert the model returned a validly-parsed structured object. */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value == null) {
    throw new Error(`Model did not return a valid ${what}.`);
  }
  return value;
}

// --- Per-call message text --------------------------------------------------
//
// The user-side text of each call, shared so both providers ask the same thing.
// Claude's cache_control prefix depends on these staying byte-identical.

/** The tutor's system prompt, in the pieces Claude caches separately. */
export function tutorSystemParts(request: TutorRequest): {
  memory: SessionMemory;
  /** The big frozen instructions: identical across every turn and problem. */
  instructions: string;
  /** The current problem plus this student's preferences. */
  problem: string;
  /** The running student model the tutor reads and returns updated. */
  studentModel: string;
} {
  const memory = request.memory ?? emptySessionMemory();
  // A session reopened from history may predate the concept/keyIdea split.
  const problem = normalizeAnalysis(request.problem);
  return {
    memory,
    instructions: SYSTEM_INSTRUCTIONS,
    problem: `# Current problem\n${problem.problemText}\nSubject: ${problem.subject}. Topic: ${problem.topic}. Concept: ${problem.concept}.${problem.keyIdea ? `\nKey idea (for you, not the student — never state it outright until they have closed the gap themselves or asked for the solution): ${problem.keyIdea}` : ""}${preferencesBlock(request.preferences)}`,
    studentModel: `# Running student model (your cross-turn memory)
Use this, and RETURN it updated as \`memory\` this turn:
${JSON.stringify(memory)}

Maintain it honestly from evidence:
- Add a concept to \`demonstrated\` once the student has PROVEN they know it — never re-explain those.
- Log each classified mistake in \`errors\` with the concept it belongs to.
- Record a wrong mental model in \`misconceptions\`; advance status suspected → confirmed → resolving → resolved as you address it and re-verify it stuck.
- Set \`bottleneck\` to the single thing blocking progress right now ("" if none).
- If one concept shows up in \`errors\`/\`misconceptions\` more than once, treat it as a RECURRING gap: name it plainly, raise depth, and have the student retry it rather than moving on.`,
  };
}

/**
 * The tutor conversation. The problem already lives in the system prompt, so
 * the first turn is just a tiny anchor — no need to resend the full problem
 * text every turn.
 */
export function tutorTurns(
  request: TutorRequest,
): { role: "user" | "assistant"; content: string }[] {
  return [
    { role: "user", content: "Let's work on this problem." },
    ...request.history.map((m) => ({
      role: m.role === "student" ? ("user" as const) : ("assistant" as const),
      content: m.content,
    })),
    { role: "user", content: actionPrompt(request) },
  ];
}

export function progressText(request: ProgressRequest): string {
  const lines = request.concepts.map((c) => {
    const bits = [
      `${c.concept}: ${c.errors} error${c.errors === 1 ? "" : "s"} across ${c.problems} problem${c.problems === 1 ? "" : "s"}`,
      c.types.length ? `types: ${c.types.join(", ")}` : "",
      c.studentBelief ? `they believe: ${c.studentBelief}` : "",
      c.correctModel ? `correct: ${c.correctModel}` : "",
    ].filter(Boolean);
    return `- ${bits.join(" | ")}`;
  });
  return `Concepts I keep missing, worst first:\n${lines.join("\n")}`;
}

export function checkWorkText(request: CheckWorkRequest): string {
  const retry = request.retryOf
    ? `\n\nThis is a RETRY. Earlier I got this step wrong — ${request.retryOf.locate}${request.retryOf.line ? ` (I had written: ${request.retryOf.line})` : ""}. Judge that step first.`
    : "";
  return `Problem:\n${request.problem.problemText}\n\nMy attempt:\n${request.attempt.text ?? "(see image)"}${retry}`;
}

export function generatePracticeText(request: GeneratePracticeRequest): string {
  return `Original problem:\n${request.problem.problemText}\nSubject: ${request.problem.subject}. Concept: ${request.problem.concept}.${request.problem.keyIdea ? ` Key idea: ${request.problem.keyIdea}.` : ""}\n\n${
    request.focus
      ? `The student has a RECURRING misconception on "${request.focus.concept}": ${request.focus.studentBelief ?? "they keep applying it incorrectly"}.${request.focus.correctModel ? ` The correct model: ${request.focus.correctModel}.` : ""}\nEngineer ONE problem that specifically probes this: it must be solvable correctly ONLY by applying the correct model, so that this exact misconception would lead to a wrong answer. Keep it at matching difficulty and do NOT hint at the misconception in the problem text.`
      : "Generate one similar practice problem."
  }`;
}

export function evaluatePracticeText(request: EvaluatePracticeRequest): string {
  const hasAttempt = !!(request.attempt.text?.trim() || request.attempt.imageDataUrl);
  return `Practice problem:\n${request.practice.problemText}\nConcept: ${request.practice.concept}.\n\n${
    hasAttempt
      ? `My attempt:\n${request.attempt.text ?? "(see image)"}`
      : "I'd like to see the worked solution without attempting."
  }`;
}
