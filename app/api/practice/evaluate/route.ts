import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";
import { errorResponse } from "@/lib/apiError";
import { rateLimited } from "@/lib/rateLimit";
import { trackUsage, usageScope, type Usage } from "@/lib/usageServer";
import { EvaluatePracticeRequestSchema, parseBody } from "@/lib/api/schemas";

export const runtime = "nodejs";

/**
 * POST /api/practice/evaluate
 * Body: EvaluatePracticeRequest
 * Returns: PracticeEvaluation (five-axis rubric, focused feedback, and the
 * now-revealed worked solution). An empty attempt means "just show me the
 * solution".
 */
export async function POST(req: Request) {
  return usageScope(req, async () => {
    const limited = await rateLimited(req);
    if (limited) return limited;
    const usage = trackUsage(req, "practiceEvaluate");
    return usage.done(await handle(req, usage));
  });
}

async function handle(req: Request, usage: Usage): Promise<Response> {
  try {
    const parsed = await parseBody(
      req,
      EvaluatePracticeRequestSchema,
      "A practice problem and an attempt are required.",
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const evaluation = await usage.provider(getProvider(req)).evaluatePractice({
      practice: body.practice,
      attempt: {
        text: body.attempt.text,
        imageDataUrl: body.attempt.imageDataUrl,
      },
    });
    usage.add(`practice.${evaluation.verdict}`);
    return NextResponse.json(evaluation);
  } catch (err) {
    return errorResponse(err, "Could not evaluate the attempt. Please try again.");
  }
}
