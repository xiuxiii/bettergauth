"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether a media query matches, kept live. Reads false on the server and on
 * the first client render, so markup never mismatches on hydration; callers
 * should render the mobile variant by default.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind's `md` breakpoint: the sheet becomes a popover from here up. */
export const DESKTOP_QUERY = "(min-width: 768px)";
