import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";
import { errorResponse } from "@/lib/apiError";
import { rateLimited } from "@/lib/rateLimit";
import { trackUsage, usageScope, type Usage } from "@/lib/usageServer";
import { GeneratePracticeRequestSchema, parseBody } from "@/lib/api/schemas";

export const runtime = "nodejs";

/**
 * POST /api/practice/generate
 * Body: GeneratePracticeRequest
 * Returns: PracticeProblem (WITHOUT a solution — the student solves it first)
 */
export async function POST(req: Request) {
  return usageScope(req, async () => {
    const limited = await rateLimited(req);
    if (limited) return limited;
    const usage = trackUsage(req, "practiceGenerate");
    return usage.done(await handle(req, usage));
  });
}

async function handle(req: Request, usage: Usage): Promise<Response> {
  try {
    const parsed = await parseBody(
      req,
      GeneratePracticeRequestSchema,
      "A source problem is required.",
    );
    if (!parsed.ok) return parsed.response;
    const body = parsed.data;

    const practice = await usage.provider(getProvider(req)).generatePractice({
      problem: body.problem,
      focus: body.focus,
    });
    usage.add("practice.generate");
    return NextResponse.json(practice);
  } catch (err) {
    return errorResponse(err, "Could not generate a practice problem. Please try again.");
  }
}
