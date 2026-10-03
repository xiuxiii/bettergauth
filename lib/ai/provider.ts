import "server-only";

import type { AIProvider } from "@/lib/ai/types";
import { AnthropicProvider } from "@/lib/ai/anthropicProvider";
import { DeepSeekProvider } from "@/lib/ai/deepseekProvider";
import { evalBypass } from "@/lib/clientId";
import { chooseDetectionProvider, chooseProvider, type ProviderId } from "@/lib/ai/choose";

/**
 * Provider factory — the single place a provider is chosen and constructed.
 * This module is server-only (see the `server-only` import), so the API keys
 * read here can never be bundled into client code.
 *
 * Two providers, chosen per request:
 *   - The client's pick arrives as the `x-ai-provider` header (the switch on
 *     Settings, lib/aiChoice.ts). It is honoured only with TUTOR_SWITCH=on
 *     or on an eval request, and only for a provider whose key is
 *     configured; anything else gets the default (lib/ai/choose.ts).
 *   - The default is `AI_PROVIDER` when set, else DeepSeek when
 *     `DEEPSEEK_API_KEY` is set (it is far cheaper), else Anthropic. An
 *     Anthropic-only deploy therefore behaves exactly as before.
 *
 * With both keys set, DeepSeek hands any photo it can't read to Claude.
 *
 * Question detection can be pinned to one provider (DETECT_PROVIDER), apart
 * from the tutor: see getDetectionProvider.
 */
export const PROVIDER_HEADER = "x-ai-provider";

const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-sonnet-5",
  deepseek: "deepseek-flash",
};

/** What is configured, read from env. Never includes a key. */
export function providerConfig() {
  const env = (name: string) => process.env[name]?.trim() || undefined;
  const aiProvider = env("AI_PROVIDER")?.toLowerCase();
  const anthropic = !!env("ANTHROPIC_API_KEY");
  const deepseek = !!env("DEEPSEEK_API_KEY");

  const detect = env("DETECT_PROVIDER")?.toLowerCase();
  const configured = { anthropic, deepseek };

  const defaultProvider: ProviderId | null =
    aiProvider === undefined
      ? deepseek
        ? "deepseek"
        : "anthropic"
      : aiProvider === "anthropic" || aiProvider === "deepseek"
        ? aiProvider
        : null;

  return {
    aiProvider: aiProvider ?? null,
    /** null when AI_PROVIDER names something unknown. */
    defaultProvider,
    providers: {
      anthropic: {
        configured: anthropic,
        model: env("ANTHROPIC_MODEL") ?? DEFAULT_MODELS.anthropic,
      },
      deepseek: {
        configured: deepseek,
        model: env("DEEPSEEK_MODEL") ?? DEFAULT_MODELS.deepseek,
        /** DEEPSEEK_VISION=off sends photos straight to the fallback. */
        vision: env("DEEPSEEK_VISION")?.toLowerCase() !== "off",
      },
    },
    /** Who reads a photo DeepSeek can't. */
    photoFallback: deepseek && anthropic ? ("anthropic" as const) : null,
    /**
     * Whether students get the DeepSeek / Claude switch in Settings and the
     * session popover. Off unless TUTOR_SWITCH=on: Claude is the expensive
     * one, so by default it is only DeepSeek's automatic backup.
     */
    tutorSwitch: env("TUTOR_SWITCH")?.toLowerCase() === "on",
    /**
     * DETECT_PROVIDER: who finds the questions on a photo, whoever tutors.
     * null (today's behaviour: the tutor's provider) when unset, unknown or
     * naming a provider with no key. Unlike AI_PROVIDER an unknown value
     * doesn't throw: this is an experiment switch, and a typo in it must not
     * take the cropper down.
     */
    detectProvider:
      (detect === "anthropic" || detect === "deepseek") && configured[detect]
        ? (detect as ProviderId)
        : null,
    /**
     * DETECT_GRID=on: the cropper draws a labelled coordinate grid on the
     * image it sends for detection (lib/detectGrid.ts) and the prompt says to
     * read coordinates off it. Off until `npm run eval -- --kind detect`
     * shows it places boxes better.
     */
    detectGrid: env("DETECT_GRID")?.toLowerCase() === "on",
  };
}

const cache: Partial<Record<ProviderId, AIProvider>> = {};

/** What chooseProvider / chooseDetectionProvider need to know about a request. */
function chooseOptions(req: Request | undefined, config: ReturnType<typeof providerConfig>) {
  return {
    requested: req?.headers.get(PROVIDER_HEADER),
    configured: {
      anthropic: config.providers.anthropic.configured,
      deepseek: config.providers.deepseek.configured,
    },
    defaultProvider: config.defaultProvider,
    tutorSwitch: config.tutorSwitch,
    evalRequest: !!req && evalBypass(req),
  };
}

function unknownProvider(config: ReturnType<typeof providerConfig>): Error {
  return new Error(
    `Unknown AI_PROVIDER "${config.aiProvider}". Use "anthropic" or "deepseek", or unset it.`,
  );
}

/**
 * The provider for this request. A student's pick (the x-ai-provider header)
 * counts only with TUTOR_SWITCH=on, or on an eval request; otherwise the
 * default runs (chooseProvider, lib/ai/choose.ts).
 */
export function getProvider(req?: Request): AIProvider {
  const config = providerConfig();
  const id = chooseProvider(chooseOptions(req, config));
  if (!id) throw unknownProvider(config);
  return build(id);
}

/**
 * The provider for question detection (/api/detect-questions).
 *
 *   1. An eval request (valid x-eval-bypass) naming a configured provider in
 *      x-ai-provider gets that one, so `npm run eval -- --provider X` can
 *      still compare the two even with DETECT_PROVIDER set. A student's pick
 *      is NOT honoured here when DETECT_PROVIDER is set: detection is a
 *      measured layout task, not the tutor they chose to talk to.
 *   2. DETECT_PROVIDER, when set and configured.
 *   3. Otherwise exactly what the tutor uses (the getProvider rule).
 *
 * DeepSeek's own photo fallback to Claude still applies inside it.
 */
export function getDetectionProvider(req: Request): AIProvider {
  const config = providerConfig();
  const id = chooseDetectionProvider({
    ...chooseOptions(req, config),
    detectProvider: config.detectProvider,
  });
  if (!id) throw unknownProvider(config);
  return build(id);
}

function build(id: ProviderId): AIProvider {
  const cached = cache[id];
  if (cached) return cached;
  const provider = id === "anthropic" ? buildAnthropic() : buildDeepSeek();
  cache[id] = provider;
  return provider;
}

function buildAnthropic(): AIProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  const model = process.env.ANTHROPIC_MODEL?.trim() || undefined;
  // Optional: run question detection on a different (faster/cheaper) model
  // than the tutoring calls. Unset means "same model", so this changes nothing
  // until someone deliberately sets it.
  const detectionModel = process.env.DETECTION_MODEL?.trim() || undefined;

  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is missing or blank. Set it in .env.local (or your host's " +
        "server env) and restart. See /api/health and docs/ai-provider-integration.md.",
    );
  }

  console.log(
    `[ai] provider=anthropic; model=${model ?? DEFAULT_MODELS.anthropic}` +
      (detectionModel ? `; detection=${detectionModel}` : ""),
  );
  return new AnthropicProvider({ apiKey, model, detectionModel });
}

function buildDeepSeek(): AIProvider {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
  const model = process.env.DEEPSEEK_MODEL?.trim() || undefined;
  const baseURL = process.env.DEEPSEEK_BASE_URL?.trim() || undefined;
  const vision = process.env.DEEPSEEK_VISION?.trim().toLowerCase() !== "off";

  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is missing or blank (AI_PROVIDER=deepseek). Set it in " +
        ".env.local (or your host's server env) and restart, or set " +
        "AI_PROVIDER=anthropic.",
    );
  }

  // Claude reads the photos DeepSeek can't, when there is a key for it.
  const fallback = process.env.ANTHROPIC_API_KEY?.trim()
    ? build("anthropic")
    : undefined;

  console.log(
    `[ai] provider=deepseek; model=${model ?? DEFAULT_MODELS.deepseek}; ` +
      `photos=${vision ? "deepseek" : "skipped"}; fallback=${fallback ? "anthropic" : "none"}`,
  );
  return new DeepSeekProvider({ apiKey, model, baseURL, vision, fallback });
}
