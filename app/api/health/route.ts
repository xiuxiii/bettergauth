import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";

export const runtime = "nodejs";

/**
 * GET /api/health — diagnostics for "which AI provider is actually running?".
 * Never returns the key itself, only whether one was detected. Reflects the
 * provider the server process settled on (it's cached at first use, so restart
 * the server after changing env).
 */
export async function GET() {
  return NextResponse.json({
    provider: getProvider().name, // "anthropic" or "mock"
    keyDetected: !!process.env.ANTHROPIC_API_KEY?.trim(),
    aiProviderEnv: process.env.AI_PROVIDER?.trim() || null,
    model: process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5",
  });
}
