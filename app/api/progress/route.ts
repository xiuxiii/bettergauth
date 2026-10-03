import { NextResponse } from "next/server";
import type { ProgressConcept } from "@/lib/tutor/types";
import { getProvider } from "@/lib/ai/provider";
import { errorResponse } from "@/lib/apiError";
import { rateLimited } from "@/lib/rateLimit";
import { trackUsage, usageScope, type Usage } from "@/lib/usageServer";

export const runtime = "nodejs";

/** Enough to see a pattern; past this it is noise the student won't read. */
const MAX_CONCEPTS = 8;

/**
 * POST /api/progress
 * Body: { concepts: ProgressConcept[] }
 * Returns: { summary: string }
 *
 * The ranking itself is computed on-device (lib/tutor/progress.ts) and costs
 * nothing, so this route exists only to add the prose and is called on demand.
 * It receives text only — no images, no transcripts — which is what keeps it
 * cheap enough to offer as a button.
 */
export async function POST(req: Request) {
  return usageScope(req, async () => {
    const limited = await rateLimited(req);
    if (limited) return limited;
    const usage = trackUsage(req, "progress");
    return usage.done(await handle(req, usage));
  });
}

async function handle(req: Request, usage: Usage): Promise<Response> {
  try {
    const body = await req.json().catch(() => null);
    const raw = body?.concepts;

    if (!Array.isArray(raw) || raw.length === 0) {
      return NextResponse.json(
        { error: "Nothing to summarize yet." },
        { status: 400 },
      );
    }

    // Rebuild each entry field by field rather than trusting the body: this is
    // client-supplied text heading straight into a prompt, so only the fields
    // the prompt actually uses should survive, clamped to sane lengths.
    const concepts: ProgressConcept[] = raw
      .slice(0, MAX_CONCEPTS)
      .filter((c: unknown): c is Record<string, unknown> => !!c && typeof c === "object")
      .map((c) => ({
        concept: str(c.concept, 120),
        errors: num(c.errors),
        problems: num(c.problems),
        types: Array.isArray(c.types)
          ? c.types.slice(0, 6).map((t) => str(t, 32)).filter(Boolean)
          : [],
        studentBelief: str(c.studentBelief, 300) || undefined,
        correctModel: str(c.correctModel, 300) || undefined,
      }))
      .filter((c) => c.concept);

    if (concepts.length === 0) {
      return NextResponse.json(
        { error: "Nothing to summarize yet." },
        { status: 400 },
      );
    }

    const summary = await usage.provider(getProvider(req)).summarizeProgress({ concepts });
    return NextResponse.json({ summary });
  } catch (err) {
    return errorResponse(err, "Could not build a summary. Please try again.");
  }
}

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0
    ? Math.min(Math.floor(v), 9999)
    : 0;
}
