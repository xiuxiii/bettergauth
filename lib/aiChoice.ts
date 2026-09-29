/**
 * Which AI answers: DeepSeek or Claude, picked in Settings or the session
 * popover.
 *
 * Its own storage key, NOT part of lib/preferences.ts: preferences are folded
 * into the tutor's prompt, and the model's name has no business there. The
 * choice rides on every AI request as the `x-ai-provider` header (added by
 * `apiFetch` in lib/apiClient.ts); the server honours it only when that
 * provider is configured and otherwise uses its own default.
 */

import { useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/apiClient";

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

// ---------------------------------------------------------------------------
// One live copy of the choice for every control on the page (Settings, the
// session popover), plus what the server can run. `useSyncExternalStore`
// keeps them in step: a switch in one re-renders the other, and a switch in
// another tab arrives through the `storage` event.
// ---------------------------------------------------------------------------


/** What /api/providers reports. */
export type ProviderStatus = {
  default: AiChoice | null;
  available: Record<AiChoice, boolean>;
};

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key === AI_CHOICE_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** undefined until the one fetch per page load has answered (or failed). */
let providers: ProviderStatus | null | undefined;
let providersRequest: Promise<void> | null = null;

function loadProviders() {
  if (providersRequest) return;
  providersRequest = apiFetch("/api/providers")
    .then((res) => (res.ok ? (res.json() as Promise<ProviderStatus>) : null))
    .catch(() => null) // offline or blocked: the server picks, and no switch is offered
    .then((status) => {
      providers = status;
      notify();
    });
}

/** Save the choice and tell every mounted control. */
export function chooseAiChoice(choice: AiChoice): void {
  saveAiChoice(choice);
  notify();
}

export const AI_LABELS: Record<AiChoice, string> = {
  deepseek: "DeepSeek",
  anthropic: "Claude",
};

/**
 * The DeepSeek / Claude switch.
 *   - `options` lists only providers the server has a key for.
 *   - `switchable` is true only when both are available; otherwise the control
 *     is not shown at all (never a disabled "Not set up" option).
 *   - `choice` is what will actually run: the saved pick if the server can
 *     honour it, else the server's default, never a stale saved value.
 * A switch applies from the next request: `apiFetch` reads the saved value on
 * every call.
 */
export function useAiChoice(): {
  choice: AiChoice | null;
  options: { value: AiChoice; label: string }[];
  switchable: boolean;
  choose: (next: AiChoice) => void;
} {
  const saved = useSyncExternalStore(subscribe, loadAiChoice, () => null);
  const status = useSyncExternalStore(
    (l) => {
      loadProviders();
      return subscribe(l);
    },
    () => providers,
    () => undefined,
  );

  const available = (id: AiChoice) => status?.available?.[id] === true;
  const options = (["deepseek", "anthropic"] as const)
    .filter(available)
    .map((value) => ({ value, label: AI_LABELS[value] }));
  const choice = saved && available(saved) ? saved : (status?.default ?? null);

  return {
    choice,
    options,
    switchable: options.length === 2,
    choose: chooseAiChoice,
  };
}
