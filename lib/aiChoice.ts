/**
 * Which AI answers: DeepSeek or Claude, picked on the setup page.
 *
 * Its own storage key, NOT part of lib/preferences.ts: preferences are folded
 * into the tutor's prompt, and the model's name has no business there. The
 * choice rides on every AI request as the `x-ai-provider` header (added by
 * `apiFetch` in lib/apiClient.ts); the server honours it only when that
 * provider is configured and otherwise uses its own default.
 */

export type AiChoice = "deepseek" | "anthropic";

export const AI_CHOICE_KEY = "mindgap:ai";
/** Must match PROVIDER_HEADER in lib/ai/provider.ts. */
export const AI_CHOICE_HEADER = "x-ai-provider";

export function isAiChoice(value: unknown): value is AiChoice {
  return value === "deepseek" || value === "anthropic";
}

/** The saved choice, or null for "the server's default". */
export function loadAiChoice(): AiChoice | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(AI_CHOICE_KEY);
    return isAiChoice(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveAiChoice(choice: AiChoice): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AI_CHOICE_KEY, choice);
  } catch {
    /* storage blocked — requests just use the server's default */
  }
}
