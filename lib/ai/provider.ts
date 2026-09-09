import "server-only";

import type { AIProvider } from "@/lib/ai/types";
import { MockProvider } from "@/lib/ai/mockProvider";
import { AnthropicProvider } from "@/lib/ai/anthropicProvider";

/**
 * Provider factory — the single place a provider is chosen and constructed.
 * This module is server-only (see the `server-only` import), so any real API
 * keys read here can never be bundled into client code.
 *
 * Selection is by the `AI_PROVIDER` env var. If it's unset, we use the real
 * Anthropic provider when `ANTHROPIC_API_KEY` is present, otherwise the mock —
 * so dropping in a key is all it takes to go live. No UI or route changes are
 * required (see .env.example and docs/ai-provider-integration.md).
 */
let cached: AIProvider | null = null;

export function getProvider(): AIProvider {
  if (cached) return cached;

  const name = (
    process.env.AI_PROVIDER ??
    (process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock")
  ).toLowerCase();
  switch (name) {
    case "mock":
      cached = new MockProvider();
      break;
    case "anthropic":
      // Real vision-capable provider. Its methods currently throw until
      // implemented — selecting it before then surfaces a clear error per call.
      cached = new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY ?? "",
        model: process.env.ANTHROPIC_MODEL, // optional; defaults to claude-opus-5
      });
      break;
    default:
      // Fail soft to the mock so the prototype always runs.
      console.warn(`Unknown AI_PROVIDER "${name}", falling back to mock.`);
      cached = new MockProvider();
  }
  return cached;
}
