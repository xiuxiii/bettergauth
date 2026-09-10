import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * GET /api/health — diagnostics for "is the AI provider configured?".
 * Reads env directly (never constructs the provider, which throws without a
 * key) and never returns the key itself. Restart the server after changing env.
 */
export async function GET() {
  const keyDetected = !!process.env.ANTHROPIC_API_KEY?.trim();
  const aiProviderEnv = process.env.AI_PROVIDER?.trim() || null;
  const provider =
    aiProviderEnv?.toLowerCase() === "anthropic" || (keyDetected && !aiProviderEnv)
      ? "anthropic"
      : keyDetected
        ? aiProviderEnv
        : "none";

  return NextResponse.json({
    provider,
    keyDetected,
    aiProviderEnv,
    model: process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5",
    ok: keyDetected,
  });
}
