import { NextResponse } from "next/server";
import { providerConfig } from "@/lib/ai/provider";
import { debugAllowed } from "@/lib/debugAccess";
import { rateLimitStoreKind } from "@/lib/rateLimit";

export const runtime = "nodejs";

/**
 * GET /api/health — diagnostics for "is the AI provider configured?".
 * Reads env directly (never constructs a provider, which throws without a key)
 * and never returns a key itself. Restart the server after changing env.
 *
 * The top-level fields describe the default provider. The Settings model
 * switch does NOT read this (publicly it is just up/down); it uses the gated
 * /api/providers.
 */
export async function GET(req: Request) {
  const config = providerConfig();
  const id = config.defaultProvider;
  const keyDetected = !!id && config.providers[id].configured;

  // Publicly just up/down: which provider and model the app runs on is
  // nobody's business but ours. The details show outside production, or with
  // ?code=<DEBUG_CODE>.
  const code = new URL(req.url).searchParams.get("code");
  if (!debugAllowed(code)) return NextResponse.json({ ok: keyDetected });

  if (!id) {
    return NextResponse.json({
      provider: "none",
      keyDetected: false,
      aiProviderEnv: config.aiProvider,
      model: null,
      ok: false,
      error: `Unknown AI_PROVIDER "${config.aiProvider}". Use "anthropic" or "deepseek", or unset it.`,
      providers: config.providers,
      photoFallback: config.photoFallback,
      rateLimitStore: rateLimitStoreKind(),
    });
  }

  return NextResponse.json({
    provider: keyDetected ? id : "none",
    keyDetected,
    aiProviderEnv: config.aiProvider,
    model: config.providers[id].model,
    ok: keyDetected,
    default: id,
    providers: config.providers,
    photoFallback: config.photoFallback,
    rateLimitStore: rateLimitStoreKind(),
  });
}
