import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";

export const runtime = "nodejs";

/**
 * POST /api/analyze
 * Body: { image: string }  // data URL of the uploaded/photographed problem
 * Returns: ProblemAnalysis
 *
 * The AI provider is constructed and called only here, on the server, so no
 * keys ever reach the browser.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const image = body?.image;

    if (typeof image !== "string" || !image.startsWith("data:image/")) {
      return NextResponse.json(
        { error: "A problem image (data URL) is required." },
        { status: 400 },
      );
    }

    const analysis = await getProvider().analyzeProblem({ imageDataUrl: image });
    return NextResponse.json(analysis);
  } catch (err) {
    console.error("analyze failed:", err);
    return NextResponse.json(
      { error: "Could not analyze the problem. Please try again." },
      { status: 500 },
    );
  }
}
