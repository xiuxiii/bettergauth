/**
 * Light / dark theming.
 *
 * Three states, not two: "system" keeps today's behaviour (follow the phone)
 * and stays the default, while "light" and "dark" are explicit overrides for
 * people who want one regardless of their OS setting.
 *
 * This deliberately does NOT live in lib/preferences.ts. Those are loaded in a
 * `useEffect` after hydration, which is far too late to colour the first paint —
 * a light-mode student would get a dark flash on every single load. The theme
 * is read synchronously by THEME_INIT_SCRIPT before the page renders, and so it
 * needs its own key and its own storage read.
 */

export type Theme = "system" | "light" | "dark";
/** What the page is actually painted as, once "system" has been resolved. */
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "mindgap:theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function isTheme(value: unknown): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

/** The stored choice, or "system" when nothing is saved or storage is blocked. */
export function loadTheme(): Theme {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    return isTheme(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

export function saveTheme(theme: Theme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* storage blocked — the choice just won't survive a reload */
  }
}

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "dark" || theme === "light") return theme;
  return systemPrefersDark() ? "dark" : "light";
}

/**
 * Paint the resolved theme. `data-theme` drives the CSS variables in
 * globals.css and the `dark:` variant configured in tailwind.config.ts;
 * `color-scheme` is what makes native scrollbars and form controls match,
 * which CSS variables cannot do on their own.
 */
export function applyTheme(theme: Theme): ResolvedTheme {
  const resolved = resolveTheme(theme);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    root.style.colorScheme = resolved;
  }
  return resolved;
}

/**
 * While the choice is "system", track live OS changes — someone flipping their
 * phone to dark at sunset should see the app follow without a reload.
 * Returns an unsubscribe function.
 */
export function watchSystemTheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  try {
    const mq = window.matchMedia(DARK_QUERY);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  } catch {
    return () => {};
  }
}

/**
 * Runs inline in <head>, before any markup, so the very first painted frame is
 * already the right colour. It must stay dependency-free and synchronous:
 * anything deferred or bundled arrives after the first paint, which is the
 * flash this exists to prevent.
 *
 * The two reads are guarded separately on purpose — if localStorage throws
 * (private window, blocked site data) we can still honour the OS preference
 * rather than dumping everyone into light.
 */
export const THEME_INIT_SCRIPT = `(function(){var r=document.documentElement,s="system";
try{var v=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(v==="light"||v==="dark"||v==="system")s=v}catch(e){}
var d=s==="dark";
if(s==="system"){try{d=matchMedia(${JSON.stringify(DARK_QUERY)}).matches}catch(e){d=false}}
r.setAttribute("data-theme",d?"dark":"light");r.style.colorScheme=d?"dark":"light";})();`;
