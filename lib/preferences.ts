import type { TutorPreferences } from "@/lib/tutor/types";

/**
 * Client-side persistence for the student's tutoring preferences. Stored in
 * localStorage (no database) and read/written from the setup page and the
 * in-session toggles. All access is guarded so SSR and blocked-storage contexts
 * degrade to the default.
 */

const PREFS_KEY = "stem-tutor:preferences";

export const DEFAULT_PREFERENCES: TutorPreferences = {
  grade: null,
  assistanceStyle: "hint_first",
  goal: "both",
};

/** Read saved preferences, or null if none have been set yet. */
export function loadPreferences(): TutorPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TutorPreferences>;
    // Merge over defaults so older/partial saves stay valid.
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return null;
  }
}

/** Persist preferences. No-op if storage is unavailable. */
export function savePreferences(prefs: TutorPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage blocked — preferences simply won't persist */
  }
}

/** Whether the student has completed setup at least once. */
export function hasPreferences(): boolean {
  return loadPreferences() !== null;
}
