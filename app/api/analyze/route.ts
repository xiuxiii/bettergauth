import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";
import { errorResponse } from "@/lib/apiError";
import { rateLimited } from "@/lib/rateLimit";

export const runtime = "nodejs";

/** Longest typed/pasted problem accepted, in characters. */
const MAX_TEXT = 4000;

/**
 * POST /api/analyze
 * Body: { image: string }  // data URL of the cropped problem
 *    or { text: string }   // a problem typed or pasted instead
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
    const text = typeof body?.text === "string" ? body.text.trim() : "";

    // A photo, or a problem typed / pasted on the home screen. Text is capped
    // because it goes straight into a prompt; a real problem fits easily.
    const hasImage = typeof image === "string" && image.startsWith("data:image/");
    if (!hasImage && !text) {
      return NextResponse.json(
        { error: "A problem photo or the problem's text is required." },
        { status: 400 },
      );
    }
    if (!hasImage && text.length > MAX_TEXT) {
      return NextResponse.json(
        { error: "That problem is too long. Paste just the one question." },
        { status: 400 },
      );
    }

    const analysis = await getProvider().analyzeProblem(
      hasImage ? { imageDataUrl: image } : { problemText: text },
    );
    return NextResponse.json(analysis);
  } catch (err) {
    return errorResponse(err, "Could not analyze the problem. Please try again.");
  }
}
