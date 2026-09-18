import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";
import { errorResponse } from "@/lib/apiError";
import { rateLimited } from "@/lib/rateLimit";
import type { Subject } from "@/lib/tutor/types";

/** Subjects the capture step lets the student pick (see QuestionCropper). */
const SUBJECT_HINTS: readonly Subject[] = ["Mathematics", "Physics", "Chemistry"];

export const runtime = "nodejs";

/**
 * POST /api/analyze
 * Body: { image: string, subject?: "Mathematics" | "Physics" | "Chemistry" }
 *   image   — data URL of the uploaded/photographed (and cropped) problem
 *   subject — optional hint from the capture step's subject selector
 * Returns: ProblemAnalysis
 *
 * The AI provider is constructed and called only here, on the server, so no
 * keys ever reach the browser.
 */
export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => null);
    const image = body?.image;

    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "A problem image (data URL) is required." },
        { status: 400 },
      );
    }

    const subjectHint = SUBJECT_HINTS.find((s) => s === body?.subject);
    const analysis = await getProvider().analyzeProblem({
      imageDataUrl: image,
      subjectHint,
    });
    return NextResponse.json(analysis);
  } catch (err) {
    return errorResponse(err, "Could not analyze the problem. Please try again.");
  }
}
