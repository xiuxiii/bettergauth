/**
 * Request validation for the AI routes.
 *
 * Every field here is client-supplied text on its way into a prompt, so each
 * route parses its body against these schemas before a model is called: the
 * wrong shape gets a 400, and every string and list has a size cap. Before this
 * the routes checked little more than "problemText is truthy", so `history:
 * "nope"`, a numeric problemText or a 10,000-character message went straight
 * through to a paid call.
 *
 * Unknown keys are dropped (zod's default), so only what the prompts use
 * survives.
 */

import { z } from "zod";
import { NextResponse } from "next/server";

/** Longest single piece of text a student reasonably sends: a long problem. */
const TEXT = 4000;
/** A photo as a data URL, after client-side normalizing (~0.5 MB). */
const IMAGE_CHARS = 6_000_000;

const text = (max = TEXT) => z.string().max(max);

export const SubjectSchema = z
  .enum(["Physics", "Chemistry", "Biology", "Mathematics", "Unknown"])
  // Records from older builds carry other spellings; they mean "not sure".
  .catch("Unknown");

export const ProblemSchema = z.object({
  problemText: z.string().trim().min(1).max(TEXT),
  subject: SubjectSchema,
  topic: text(200).default(""),
  concept: text(200).default(""),
  keyIdea: text(1000).optional(),
  confidence: z.number().min(0).max(1).catch(0),
  openingHint: text(1000).default(""),
  hasStemContent: z.boolean().optional(),
  studentWork: z.object({ present: z.boolean() }).default({ present: false }),
  attemptText: text().optional(),
});

/**
 * Only the most recent turns are kept: the tutor needs the recent thread, and
 * a long session must keep working rather than start failing validation.
 */
const HISTORY_KEEP = 80;
export const HistorySchema = z
  .array(
    z.object({
      id: text(100).default(""),
      role: z.enum(["student", "tutor"]),
      content: text(),
      createdAt: z.number().catch(0),
    }),
  )
  .max(1000)
  .transform((h) => h.slice(-HISTORY_KEEP));

export const PreferencesSchema = z.object({
  grade: z.enum(["9", "10", "11", "12", "other"]).nullable().optional().catch(null),
  assistanceStyle: z.enum(["hint_first", "direct"]).catch("hint_first"),
  goal: z.enum(["understand", "exam", "both"]).catch("both"),
  curriculum: z.enum(["standard", "ib", "ap"]).nullable().optional().catch(null),
});

export const MemorySchema = z.object({
  demonstrated: z.array(text(120)).max(100),
  misconceptions: z
    .array(
      z.object({
        concept: text(120),
        studentBelief: text(600),
        correctModel: text(600),
        status: z.enum(["suspected", "confirmed", "resolving", "resolved"]),
      }),
    )
    .max(50),
  errors: z
    .array(
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
        concept: text(120),
      }),
    )
    .max(300),
  bottleneck: text(600).catch(""),
});

/**
 * A photo as the model accepts it: JPEG, PNG, WebP or GIF, base64. Anything
 * else (an SVG, a PDF, a malformed URL) is a 400 here rather than a 500 when
 * the model's API rejects it.
 */
export const IMAGE_DATA_URL = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=\s]+$/;
export const ImageDataUrlSchema = z.string().max(IMAGE_CHARS).regex(IMAGE_DATA_URL);
export const UNSUPPORTED_IMAGE =
  "That file type isn't supported. Send a photo (JPEG or PNG).";

/** An attempt as sent; may be empty (practice's "show me the solution"). */
export const AttemptSchema = z.object({
  text: text(8000).optional(),
  imageDataUrl: ImageDataUrlSchema.optional(),
});

/** An attempt that has something in it to check: text or a photo. */
export const NonEmptyAttemptSchema = AttemptSchema.refine(
  (a) => !!a.text?.trim() || !!a.imageDataUrl,
  { message: "empty attempt" },
);

export const TutorRequestSchema = z.object({
  problem: ProblemSchema,
  history: HistorySchema.default([]),
  action: z.enum([
    "ask",
    "question",
    "continue",
    "hint",
    "explain",
    "go_deeper",
    "show_solution",
    "similar_problem",
  ]),
  studentText: text(2000).optional(),
  preferences: PreferencesSchema.optional(),
  memory: MemorySchema.optional(),
});

export const CheckWorkRequestSchema = z.object({
  problem: ProblemSchema,
  // An empty attempt used to run a full (thinking) check and invent a
  // "no attempt" error. There is nothing to check, so it's a 400.
  attempt: NonEmptyAttemptSchema,
  retryOf: z
    .object({
      line: text(300).default(""),
      locate: text(300),
      category: z.enum([
        "conceptual",
        "model_selection",
        "setup",
        "procedural",
        "arithmetic",
        "units_notation",
      ]),
    })
    .optional(),
});

export const PracticeFocusSchema = z.object({
  concept: text(120),
  studentBelief: text(600).optional(),
  correctModel: text(600).optional(),
});

export const GeneratePracticeRequestSchema = z.object({
  problem: ProblemSchema,
  focus: PracticeFocusSchema.optional(),
});

export const EvaluatePracticeRequestSchema = z.object({
  practice: z.object({
    problemText: z.string().trim().min(1).max(TEXT),
    subject: SubjectSchema,
    topic: text(200).default(""),
    concept: text(200).default(""),
    difficulty: z.enum(["same", "slightly_harder"]).catch("same"),
  }),
  attempt: AttemptSchema,
});

/**
 * Parse a request body, or produce the 400 to return. A body that isn't JSON
 * at all gets the same answer as a wrong shape.
 */
export async function parseBody<S extends z.ZodTypeAny>(
  req: Request,
  schema: S,
  message: string,
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: NextResponse }> {
  const raw = await req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, response: NextResponse.json({ error: message }, { status: 400 }) };
}
