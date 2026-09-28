import type { TutorPreferences } from "@/lib/tutor/types";

/**
 * Client-side persistence for the student's tutoring preferences. Stored in
 * localStorage (no database) and read/written from the setup page and the
 * in-session toggles. All access is guarded so SSR and blocked-storage contexts
 * degrade to the default.
 */

const PREFS_KEY = "mindgap:preferences";
/**
 * The key this used to live under. localStorage survives deploys, so renaming
 * the key without this would silently drop every existing student's setup and
 * march them back through the first-run page for a cosmetic rename. Migrated
 * on first read; safe to delete once no one is on a pre-rename build.
 */
const LEGACY_PREFS_KEY = "stem-tutor:preferences";

export const DEFAULT_PREFERENCES: TutorPreferences = {
  grade: null,
  assistanceStyle: "hint_first",
  goal: "both",
};

/** Read saved preferences, or null if none have been set yet. */
export function loadPreferences(): TutorPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    let raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) {
      const legacy = window.localStorage.getItem(LEGACY_PREFS_KEY);
      if (!legacy) return null;
      // Carry the old save forward, then stop reading the old key.
      window.localStorage.setItem(PREFS_KEY, legacy);
      window.localStorage.removeItem(LEGACY_PREFS_KEY);
      raw = legacy;
    }
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

/**
 * Whether localStorage works at all. With site data blocked (some private
 * modes, strict settings) every read throws or comes back empty and every write
 * is lost — so "no preferences saved" means nothing, and gating on it sent the
 * student round the welcome tour forever: finish, land on home, get sent back.
 */
export function storageAvailable(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const probe = "mindgap:probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Whether the student has completed setup at least once. */
export function hasPreferences(): boolean {
  return loadPreferences() !== null;
}
