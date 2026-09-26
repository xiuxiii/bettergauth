"use client";

import { useEffect } from "react";
import { applyTheme, loadTheme, watchSystemTheme } from "@/lib/theme";

/**
 * Follows the OS light/dark switch live, on every page, while the choice is
 * "system". It used to run only on the settings page, so a phone flipping to
 * dark at sunset left every other screen in the old theme until a reload.
 *
 * The choice is re-read on each change rather than captured once, so picking
 * Light or Dark in settings stops the following without a remount.
 */
export default function ThemeWatcher() {
  useEffect(
    () =>
      watchSystemTheme(() => {
        if (loadTheme() === "system") applyTheme("system");
      }),
    [],
  );
  return null;
}
