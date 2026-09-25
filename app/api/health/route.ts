import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Per-provider env: which key it needs, its model override and default. */
const PROVIDERS = {
  anthropic: {
    keyEnv: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_MODEL",
    defaultModel: "claude-sonnet-5",
    implemented: true,
  },
  deepseek: {
    keyEnv: "DEEPSEEK_API_KEY",
    modelEnv: "DEEPSEEK_MODEL",
    defaultModel: "deepseek-chat",
    // A reserved slot: see lib/ai/deepseekProvider.ts.
    implemented: false,
  },
} as const;

/**
 * GET /api/health — diagnostics for "is the AI provider configured?".
 * Reads env directly (never constructs the provider, which throws without a
 * key) and never returns the key itself. Restart the server after changing env.
 */
export async function GET() {
  const aiProviderEnv = process.env.AI_PROVIDER?.trim() || null;
  const selected = (aiProviderEnv ?? "anthropic").toLowerCase();
  const config = PROVIDERS[selected as keyof typeof PROVIDERS];

  if (!config) {
    return NextResponse.json({
      provider: "none",
      keyDetected: false,
      aiProviderEnv,
      model: null,
      implemented: false,
      ok: false,
      error: `Unknown AI_PROVIDER "${aiProviderEnv}". Use "anthropic" or "deepseek".`,
    });
  }

  const keyDetected = !!process.env[config.keyEnv]?.trim();

  return NextResponse.json({
    provider: keyDetected ? selected : "none",
    keyDetected,
    aiProviderEnv,
    model: process.env[config.modelEnv]?.trim() || config.defaultModel,
    implemented: config.implemented,
    ok: keyDetected && config.implemented,
  });
}
