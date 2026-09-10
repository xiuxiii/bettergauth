import "server-only";

import type { AIProvider } from "@/lib/ai/types";
import { MockProvider } from "@/lib/ai/mockProvider";
import { AnthropicProvider } from "@/lib/ai/anthropicProvider";

/**
 * Provider factory — the single place a provider is chosen and constructed.
 * This module is server-only (see the `server-only` import), so any real API
 * keys read here can never be bundled into client code.
 *
 * Selection:
 *   - `AI_PROVIDER` set to "anthropic" or "mock" wins (explicit).
 *   - Otherwise: "anthropic" when `ANTHROPIC_API_KEY` is present, else "mock".
 * An empty/blank `AI_PROVIDER=` is treated as unset (not as "").
 *
 * On first use it logs the decision (provider + why, key never printed) so a
 * "why is it still the mock?" is answerable from the server terminal.
 */
let cached: AIProvider | null = null;

export function getProvider(): AIProvider {
  if (cached) return cached;

  const explicit = process.env.AI_PROVIDER?.trim().toLowerCase();
  const hasKey = !!process.env.ANTHROPIC_API_KEY?.trim();
  const name = explicit || (hasKey ? "anthropic" : "mock");

  const why = explicit
    ? `AI_PROVIDER=${explicit}`
    : hasKey
      ? "auto-detected from ANTHROPIC_API_KEY"
      : "no ANTHROPIC_API_KEY set";

  switch (name) {
    case "anthropic":
      if (!hasKey) {
        // Explicitly asked for anthropic but no key — make it obvious.
        console.error(
          "[ai] AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing/blank. " +
            "Set the key in .env.local and restart the server.",
        );
      }
      console.log(
        `[ai] provider=anthropic (${why}); model=${process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5"}`,
      );
      cached = new AnthropicProvider({
        apiKey: process.env.ANTHROPIC_API_KEY?.trim() ?? "",
        model: process.env.ANTHROPIC_MODEL?.trim() || undefined,
      });
      break;

    case "mock":
      if (hasKey && explicit === "mock") {
        // Most common gotcha: a stale `AI_PROVIDER=mock` line (copied from an
        // old .env.example) overriding a real key that IS present.
        console.warn(
          "[ai] Using the MOCK even though ANTHROPIC_API_KEY is set, because " +
            "AI_PROVIDER=mock is set. Remove that line from .env.local (or set " +
            "AI_PROVIDER=anthropic) and restart to use the real model.",
        );
      }
      console.log(`[ai] provider=mock (${why})`);
      cached = new MockProvider();
      break;

    default:
      console.warn(
        `[ai] Unknown AI_PROVIDER="${explicit}", falling back to ` +
          `${hasKey ? "anthropic (key present)" : "mock"}.`,
      );
      cached = hasKey
        ? new AnthropicProvider({
            apiKey: process.env.ANTHROPIC_API_KEY?.trim() ?? "",
            model: process.env.ANTHROPIC_MODEL?.trim() || undefined,
          })
        : new MockProvider();
  }
  return cached;
}
