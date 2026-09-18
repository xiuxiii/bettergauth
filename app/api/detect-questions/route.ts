import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";
import { errorResponse } from "@/lib/apiError";
import { rateLimited } from "@/lib/rateLimit";

export const runtime = "nodejs";

/**
 * POST /api/detect-questions
 * Body: { image: string }  // data URL of the full photographed page
 * Returns: QuestionDetection — normalised boxes for each question found
 *
 * Powers the capture-time crop step. The client treats a failure here as
 * "no detection" and falls back to a local ink bounding box, so this route is
 * never on the critical path for analysis itself.
 */
export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => null);
    const image = body?.image;

    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "A page image (data URL) is required." },
        { status: 400 },
      );
    }

    const detection = await getProvider().detectQuestions({ imageDataUrl: image });
    return NextResponse.json(detection);
  } catch (err) {
    return errorResponse(err, "Could not detect questions in the photo.");
  }
}
