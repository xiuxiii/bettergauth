import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";
import type { GeneratePracticeRequest } from "@/lib/tutor/types";

export const runtime = "nodejs";

/**
 * POST /api/practice/generate
 * Body: GeneratePracticeRequest
 * Returns: PracticeProblem (WITHOUT a solution — the student solves it first)
 */
export async function POST(req: Request) {
  try {
    const body = (await req
      .json()
      .catch(() => null)) as GeneratePracticeRequest | null;

    if (!body?.problem?.problemText) {
      return NextResponse.json(
        { error: "A source problem is required." },
        { status: 400 },
      );
    }

    const practice = await getProvider().generatePractice({
      problem: body.problem,
    });
    return NextResponse.json(practice);
  } catch (err) {
    console.error("practice/generate failed:", err);
    return NextResponse.json(
      { error: "Could not generate a practice problem. Please try again." },
      { status: 500 },
    );
  }
}
