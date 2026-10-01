import { NextResponse } from "next/server";
import { providerConfig } from "@/lib/ai/provider";

export const runtime = "nodejs";

/**
 * GET /api/providers — what the DeepSeek / Claude switch in Settings needs:
 * whether to show it at all (TUTOR_SWITCH=on and both set up), which of the
 * two can be picked, and which runs when nothing is picked.
 *
 * Behind the access gate (it is not in middleware's open paths), unlike
 * /api/health, and it names no models: a student choosing between the two
 * options on screen learns nothing the screen doesn't already say.
 */
export async function GET() {
  const config = providerConfig();
  return NextResponse.json({
    default: config.defaultProvider,
    switchable:
      config.tutorSwitch &&
      config.providers.deepseek.configured &&
      config.providers.anthropic.configured,
    available: {
      deepseek: config.providers.deepseek.configured,
      anthropic: config.providers.anthropic.configured,
    },
  });
}
