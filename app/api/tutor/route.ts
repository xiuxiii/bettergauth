import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";
import { errorResponse } from "@/lib/apiError";
import { rateLimited } from "@/lib/rateLimit";
import type { TutorAction, TutorRequest } from "@/lib/tutor/types";

export const runtime = "nodejs";

const ACTIONS: TutorAction[] = [
  "ask",
  "continue",
  "hint",
  "explain",
  "go_deeper",
  "show_solution",
  "similar_problem",
];

/**
 * POST /api/tutor
 * Body: TutorRequest
 * Returns: TutorTurn
 */
export async function POST(req: Request) {
  const limited = rateLimited(req);
  if (limited) return limited;

  try {
    const body = (await req.json().catch(() => null)) as TutorRequest | null;

    if (!body?.problem?.problemText || !ACTIONS.includes(body.action)) {
      return NextResponse.json(
        { error: "A valid problem and action are required." },
        { status: 400 },
      );
    }

    const turn = await getProvider().tutor({
      problem: body.problem,
      history: Array.isArray(body.history) ? body.history : [],
      action: body.action,
      studentText: body.studentText,
      preferences: body.preferences,
      memory: body.memory,
    });

    return NextResponse.json(turn);
  } catch (err) {
    return errorResponse(err, "The tutor could not respond. Please try again.");
  }
}
