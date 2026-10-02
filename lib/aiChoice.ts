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
  /** Whether students may pick (TUTOR_SWITCH=on and both set up). */
  switchable?: boolean;
  available: Record<AiChoice, boolean>;
  /** DETECT_GRID=on: draw the coordinate grid on the detection image. */
  detectGrid?: boolean;
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

/** Subscribe to the provider status, starting its one fetch if needed. */
function subscribeProviders(listener: () => void) {
  loadProviders();
  return subscribe(listener);
}

/**
 * Start the /api/providers fetch now, ahead of anything that needs it. The
 * home page calls this so the cropper's detection call doesn't wait on it.
 */
export function prefetchProviders(): void {
  if (typeof window !== "undefined") loadProviders();
}

/** Whether question detection should send the gridded image. False until known. */
export function useDetectGrid(): boolean {
  const status = useSyncExternalStore(
    subscribeProviders,
    () => providers,
    () => undefined,
  );
  return status?.detectGrid === true;
}

/**
 * The same flag, for code that must decide once rather than re-render: the
 * cropper's detection call. Resolves as soon as the status is known, or with
 * false after `ms`, so a slow /api/providers costs at most that delay and a
 * failed one means "no grid" (today's behaviour).
 */
export function detectGridWithin(ms: number): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  loadProviders();
  if (providers !== undefined) return Promise.resolve(providers?.detectGrid === true);
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      listeners.delete(onChange);
      resolve(providers?.detectGrid === true);
    };
    // notify() also fires for a Tutor switch; only the status arriving counts.
    const onChange = () => {
      if (providers !== undefined) finish();
    };
    const timer = setTimeout(finish, ms);
    listeners.add(onChange);
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
 *   - `switchable` is true only when the owner turned the switch on
 *     (TUTOR_SWITCH=on) and both are available; otherwise the control is not
 *     shown at all (never a disabled "Not set up" option).
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
    subscribeProviders,
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
    switchable: options.length === 2 && status?.switchable === true,
    choose: chooseAiChoice,
  };
}
