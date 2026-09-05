import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";
import type { CheckWorkRequest } from "@/lib/tutor/types";

export const runtime = "nodejs";

/**
 * POST /api/check-work
 * Body: CheckWorkRequest
 * Returns: WorkCheck
 *
 * The provider is constructed and called only here, on the server, so no keys
 * ever reach the browser.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as CheckWorkRequest | null;

    const hasAttempt =
      !!body?.attempt &&
      (typeof body.attempt.text === "string" ||
        typeof body.attempt.imageDataUrl === "string");

    if (!body?.problem?.problemText || !hasAttempt) {
      return NextResponse.json(
        { error: "A problem and an attempted solution are required." },
        { status: 400 },
      );
    }

    const check = await getProvider().checkWork({
      problem: body.problem,
      attempt: {
        text: body.attempt.text,
        imageDataUrl: body.attempt.imageDataUrl,
      },
    });

    return NextResponse.json(check);
  } catch (err) {
    console.error("check-work failed:", err);
    return NextResponse.json(
      { error: "Could not check the work. Please try again." },
      { status: 500 },
    );
  }
}
