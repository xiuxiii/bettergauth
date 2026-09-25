import "server-only";

import type { AIProvider } from "@/lib/ai/types";
import { AnthropicProvider } from "@/lib/ai/anthropicProvider";
import { DeepSeekProvider } from "@/lib/ai/deepseekProvider";

/**
 * Provider factory — the single place a provider is chosen and constructed.
 * This module is server-only (see the `server-only` import), so the API key
 * read here can never be bundled into client code.
 *
 * `AI_PROVIDER` picks the backend:
 *   - `anthropic` (default) — the real provider. `ANTHROPIC_API_KEY` is
 *     required; `ANTHROPIC_MODEL` optionally pins the model (defaults to
 *     claude-sonnet-5).
 *   - `deepseek` — a reserved slot. `DEEPSEEK_API_KEY` is required;
 *     `DEEPSEEK_MODEL` / `DEEPSEEK_BASE_URL` are optional. Every call currently
 *     fails with a 501 (see lib/ai/deepseekProvider.ts).
 * Both keys can be set at once; only the selected provider's key is read.
 */
let cached: AIProvider | null = null;

export function getProvider(): AIProvider {
  if (cached) return cached;

  const provider = (process.env.AI_PROVIDER?.trim() || "anthropic").toLowerCase();

  switch (provider) {
    case "anthropic": {
      const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
      const model = process.env.ANTHROPIC_MODEL?.trim() || undefined;
      // Optional: run question detection on a different (faster/cheaper) model
      // than the tutoring calls. Unset means "same model", so this changes
      // nothing until someone deliberately sets it.
      const detectionModel = process.env.DETECTION_MODEL?.trim() || undefined;

      if (!apiKey) {
        throw new Error(
          "ANTHROPIC_API_KEY is missing or blank. Set it in .env.local (or your host's " +
            "server env) and restart. See /api/health and docs/ai-provider-integration.md.",
        );
      }

      console.log(
        `[ai] provider=anthropic; model=${model ?? "claude-sonnet-5"}` +
          (detectionModel ? `; detection=${detectionModel}` : ""),
      );
      cached = new AnthropicProvider({ apiKey, model, detectionModel });
      return cached;
    }

    case "deepseek": {
      const apiKey = process.env.DEEPSEEK_API_KEY?.trim() ?? "";
      const model = process.env.DEEPSEEK_MODEL?.trim() || undefined;
      const baseURL = process.env.DEEPSEEK_BASE_URL?.trim() || undefined;

      if (!apiKey) {
        throw new Error(
          "DEEPSEEK_API_KEY is missing or blank (AI_PROVIDER=deepseek). Set it in " +
            ".env.local (or your host's server env) and restart, or unset AI_PROVIDER " +
            "to use Anthropic.",
        );
      }

      console.log(
        `[ai] provider=deepseek; model=${model ?? "deepseek-chat"} (stub — not implemented)`,
      );
      cached = new DeepSeekProvider({ apiKey, model, baseURL });
      return cached;
    }

    default:
      throw new Error(
        `Unknown AI_PROVIDER "${provider}". Use "anthropic" (default) or "deepseek".`,
      );
  }
}
