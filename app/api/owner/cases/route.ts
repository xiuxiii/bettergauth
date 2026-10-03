import { NextResponse } from "next/server";
import { debugGate } from "@/lib/rateLimit";
import { kindOf } from "@/evals/runCase.mjs";
import { loadCases } from "../evalCases";
import { NO_STORE, notFound } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/owner/cases?code=<DEBUG_CODE> — the eval cases (evals/cases/*.json)
 * in file order, for the owner page to run one at a time through
 * /api/owner/eval. hasGrid: a detect case with a gridImage. 404 without the code.
 */
export async function GET(req: Request) {
  const debug = await debugGate(req, new URL(req.url).searchParams.get("code"));
  if (debug.limited) return debug.limited;
  if (!debug.allowed) return notFound();
  try {
    const cases = (await loadCases()).map((c) => ({
      id: c.id,
      kind: kindOf(c),
      hasGrid: !!c.gridImage,
    }));
    return NextResponse.json({ cases }, { headers: NO_STORE });
  } catch (err) {
    console.error("[owner/cases] couldn't read the cases", err);
    return NextResponse.json({ error: "Couldn't read the eval cases." }, { status: 500, headers: NO_STORE });
  }
}
