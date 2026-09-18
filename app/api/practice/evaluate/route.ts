import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";
import { errorResponse } from "@/lib/apiError";
import { rateLimited } from "@/lib/rateLimit";
import type { EvaluatePracticeRequest } from "@/lib/tutor/types";

export const runtime = "nodejs";

/**
 * POST /api/practice/evaluate
 * Body: EvaluatePracticeRequest
 * Returns: PracticeEvaluation (five-axis rubric, focused feedback, and the
 * now-revealed worked solution). An empty attempt means "just show me the
 * solution".
 */
export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;

  try {
    const body = (await req
      .json()
      .catch(() => null)) as EvaluatePracticeRequest | null;

    if (!body?.practice?.problemText || !body.attempt) {
      return NextResponse.json(
        { error: "A practice problem and an attempt are required." },
        { status: 400 },
      );
    }

    const evaluation = await getProvider().evaluatePractice({
      practice: body.practice,
      attempt: {
        text: body.attempt.text,
        imageDataUrl: body.attempt.imageDataUrl,
      },
    });
    return NextResponse.json(evaluation);
  } catch (err) {
    return errorResponse(err, "Could not evaluate the attempt. Please try again.");
  }
}
