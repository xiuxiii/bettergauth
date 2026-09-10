import "server-only";

import type { AIProvider } from "@/lib/ai/types";
import { AnthropicProvider } from "@/lib/ai/anthropicProvider";

/**
 * Provider factory — the single place a provider is chosen and constructed.
 * This module is server-only (see the `server-only` import), so the API key
 * read here can never be bundled into client code.
 *
 * The app runs on a real vision-capable model. `ANTHROPIC_API_KEY` is required;
 * `ANTHROPIC_MODEL` optionally pins the model (defaults to claude-opus-5). The
 * `AIProvider` interface and this factory stay provider-agnostic, so a
 * different backend can be added later as another `case`.
 */
let cached: AIProvider | null = null;

export function getProvider(): AIProvider {
  if (cached) return cached;

  const provider = (process.env.AI_PROVIDER?.trim() || "anthropic").toLowerCase();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  const model = process.env.ANTHROPIC_MODEL?.trim() || undefined;

  if (provider !== "anthropic") {
    throw new Error(
      `Unknown AI_PROVIDER "${provider}". The only implemented provider is "anthropic".`,
    );
  }
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is missing or blank. Set it in .env.local (or your host's " +
        "server env) and restart. See /api/health and docs/ai-provider-integration.md.",
    );
  }

  console.log(`[ai] provider=anthropic; model=${model ?? "claude-opus-5"}`);
  cached = new AnthropicProvider({ apiKey, model });
  return cached;
}
