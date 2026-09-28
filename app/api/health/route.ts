import { NextResponse } from "next/server";
import { providerConfig } from "@/lib/ai/provider";

export const runtime = "nodejs";

/**
 * GET /api/health — diagnostics for "is the AI provider configured?".
 * Reads env directly (never constructs a provider, which throws without a key)
 * and never returns a key itself. Restart the server after changing env.
 *
 * The top-level fields describe the default provider, as they always have;
 * `providers` is what the setup page's model switch reads.
 */
export async function GET() {
  const config = providerConfig();
  const id = config.defaultProvider;

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
    });
  }

  const keyDetected = config.providers[id].configured;
  return NextResponse.json({
    provider: keyDetected ? id : "none",
    keyDetected,
    aiProviderEnv: config.aiProvider,
    model: config.providers[id].model,
    ok: keyDetected,
    default: id,
    providers: config.providers,
    photoFallback: config.photoFallback,
  });
}
