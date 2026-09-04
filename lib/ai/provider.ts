import "server-only";

import type { AIProvider } from "@/lib/ai/types";
import { MockProvider } from "@/lib/ai/mockProvider";

/**
 * Provider factory. This module is server-only (see the `server-only` import),
 * so any real API keys read here can never be bundled into client code.
 *
 * To add a real provider later:
 *   1. Implement AIProvider in e.g. lib/ai/anthropicProvider.ts, reading its
 *      key from process.env inside the constructor.
 *   2. Add a case below keyed on AI_PROVIDER.
 * No UI or route changes are required.
 */
let cached: AIProvider | null = null;

export function getProvider(): AIProvider {
  if (cached) return cached;

  const name = (process.env.AI_PROVIDER ?? "mock").toLowerCase();
  switch (name) {
    case "mock":
      cached = new MockProvider();
      break;
    // case "anthropic":
    //   cached = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!);
    //   break;
    default:
      // Fail soft to the mock so the prototype always runs.
      console.warn(`Unknown AI_PROVIDER "${name}", falling back to mock.`);
      cached = new MockProvider();
  }
  return cached;
}
