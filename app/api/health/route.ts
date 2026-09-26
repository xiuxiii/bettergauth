import { NextResponse } from "next/server";
import { debugAllowed } from "@/lib/debugAccess";

export const runtime = "nodejs";

/**
 * GET /api/health — diagnostics for "is the AI provider configured?".
 * Reads env directly (never constructs the provider, which throws without a
 * key) and never returns the key itself. Restart the server after changing env.
 */
export async function GET(req: Request) {
  const keyDetected = !!process.env.ANTHROPIC_API_KEY?.trim();
  const aiProviderEnv = process.env.AI_PROVIDER?.trim() || null;
  const provider =
    aiProviderEnv?.toLowerCase() === "anthropic" || (keyDetected && !aiProviderEnv)
      ? "anthropic"
      : keyDetected
        ? aiProviderEnv
        : "none";

  // Publicly just up/down: which provider and model the app runs on is
  // nobody's business but ours. The details show outside production, or with
  // ?code=<DEBUG_CODE>.
  const code = new URL(req.url).searchParams.get("code");
  if (!debugAllowed(code)) return NextResponse.json({ ok: keyDetected });

  return NextResponse.json({
    provider,
    keyDetected,
    aiProviderEnv,
    model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5",
    ok: keyDetected,
  });
}
