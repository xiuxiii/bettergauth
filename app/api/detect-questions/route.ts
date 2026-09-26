import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";
import { errorResponse } from "@/lib/apiError";
import { rateLimited } from "@/lib/rateLimit";
import { debugAllowed } from "@/lib/debugAccess";
import { IMAGE_DATA_URL, UNSUPPORTED_IMAGE } from "@/lib/api/schemas";

export const runtime = "nodejs";

/**
 * POST /api/detect-questions
 * Body: { image: string, width: number, height: number,
 *         debug?: true, debugCode?: string }
 *   image          — data URL of the full photographed page
 *   width, height  — that image's pixel dimensions; the model is asked for
 *                    boxes in absolute pixels and they are converted back here
 * Returns: QuestionDetection — normalised boxes for each question found, plus
 *   the model's raw pixel output under `debug` when the body asks for it
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

    const width = Number(body?.width);
    const height = Number(body?.height);

    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "A page image (data URL) is required." },
        { status: 400 },
      );
    }
    if (!IMAGE_DATA_URL.test(image)) {
      return NextResponse.json({ error: UNSUPPORTED_IMAGE }, { status: 400 });
    }
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return NextResponse.json(
        { error: "The image's pixel dimensions are required." },
        { status: 400 },
      );
    }

    const detection = await getProvider().detectQuestions({
      imageDataUrl: image,
      width,
      height,
    });
    // The raw model output rides along only for the ?debug=boxes view, and
    // only where debugging is allowed (see debugAllowed).
    const { debug, ...result } = detection;
    const wantsDebug = body?.debug === true;
    const allowed = wantsDebug && debugAllowed(body?.debugCode);
    return NextResponse.json(
      allowed ? { ...result, debug } : wantsDebug ? { ...result, debugDenied: true } : result,
    );
  } catch (err) {
    return errorResponse(err, "Could not detect questions in the photo.");
  }
}
