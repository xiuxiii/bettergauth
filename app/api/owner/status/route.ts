import { NextResponse } from "next/server";
import { providerConfig } from "@/lib/ai/provider";
import { debugAllowed } from "@/lib/debugAccess";
import { rateLimitStoreKind } from "@/lib/rateLimit";
import { usageStoreKind } from "@/lib/usageServer";
import { NO_STORE, notFound } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/owner/status?code=<DEBUG_CODE> — how the deploy is set up, for the
 * owner page: which providers have a key, who tutors, the detection switches,
 * where the limits and usage are counted, whether evals can skip the limiter.
 * Never a key, a model name or the bypass token. 404 without the code.
 */
export async function GET(req: Request) {
  if (!debugAllowed(new URL(req.url).searchParams.get("code"))) return notFound();

  const config = providerConfig();
  const id = config.defaultProvider;
  return NextResponse.json(
    {
      providers: {
        anthropic: config.providers.anthropic.configured,
        deepseek: config.providers.deepseek.configured,
      },
      // null: no key for the default provider, or AI_PROVIDER names an unknown one.
      tutor: id && config.providers[id].configured ? id : null,
      // null: DETECT_PROVIDER unset (or not configured), so detection follows the tutor.
      detectProvider: config.detectProvider,
      detectGrid: config.detectGrid,
      tutorSwitch: config.tutorSwitch,
      deepseekVision: config.providers.deepseek.vision,
      rateLimitStore: rateLimitStoreKind(),
      usageStore: usageStoreKind(),
      evalBypass: !!process.env.EVAL_BYPASS_TOKEN?.trim(),
    },
    { headers: NO_STORE },
  );
}
