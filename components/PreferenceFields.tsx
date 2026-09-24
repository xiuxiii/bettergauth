"use client";

import { useEffect, useState } from "react";
import type { TutorPreferences } from "@/lib/tutor/types";
import {
  applyTheme,
  loadTheme,
  saveTheme,
  watchSystemTheme,
  type Theme,
} from "@/lib/theme";

/**
 * The preference controls shared by the full settings page (SetupForm) and the
 * first-run welcome tour (Onboarding). Both ask the same questions, so the
 * option lists live here once — adding a curriculum in one place and not the
 * other would let the tour save a value the settings page can't display.
 */

export type Option = { value: string; label: string; sub?: string; className?: string };

export const GRADE_OPTIONS: Option[] = [
  { value: "9", label: "9", className: "text-center sm:px-2" },
  { value: "10", label: "10", className: "text-center sm:px-2" },
  { value: "11", label: "11", className: "text-center sm:px-2" },
  { value: "12", label: "12", className: "text-center sm:px-2" },
  { value: "other", label: "Other", className: "text-center sm:px-2" },
  { value: "skip", label: "Prefer not to say", className: "col-span-3 text-center sm:col-span-2 sm:px-2" },
];

export const CURRICULUM_OPTIONS: Option[] = [
  { value: "standard", label: "Standard", className: "text-center" },
  { value: "ib", label: "IB", className: "text-center" },
  { value: "ap", label: "AP", className: "text-center" },
];

export const STYLE_OPTIONS: Option[] = [
  { value: "hint_first", label: "Hints first", sub: "Make me work" },
  { value: "direct", label: "Direct", sub: "Explain it to me" },
];

export const GOAL_OPTIONS: Option[] = [
  { value: "both", label: "Both", sub: "Exam-ready + deep" },
  { value: "understand", label: "Understand", sub: "The why" },
  { value: "exam", label: "Exam prep", sub: "Drill + traps" },
];

export const THEME_OPTIONS: Option[] = [
  { value: "system", label: "System", sub: "Match my phone" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** "skip" is the chip for a null grade; the stored value stays null. */
export function gradeValue(prefs: TutorPreferences): string {
  return prefs.grade ?? "skip";
}
export function withGrade(prefs: TutorPreferences, v: string): TutorPreferences {
  return { ...prefs, grade: v === "skip" ? null : (v as TutorPreferences["grade"]) };
}

/**
 * The theme choice, applied the moment it's picked. Theme is stored separately
 * from preferences (see lib/theme.ts) and starts at the SSR-safe default:
 * reading storage during render would disagree with the server markup and trip
 * a hydration mismatch on the selected chip.
 */
export function useThemeChoice(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("system");
  useEffect(() => setThemeState(loadTheme()), []);

  // While on "system", follow the OS live rather than waiting for a reload.
  useEffect(() => {
    if (theme !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [theme]);

  // Applied immediately, not on save: a colour choice you cannot see until you
  // submit the form is a choice you cannot judge.
  function chooseTheme(next: Theme) {
    setThemeState(next);
    applyTheme(next);
    saveTheme(next);
  }
  return [theme, chooseTheme];
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="text-sm font-semibold text-slate-800">{label}</p>
      {hint && <p className="mb-2 mt-0.5 text-xs text-slate-500">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function Options({
  value,
  onChange,
  options,
  className = "",
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  /** Extra layout classes for the group (e.g. a grid on wider screens). */
  className?: string;
  /** Accessible name for the group, when no visible label is tied to it. */
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`gap-2 ${className || "flex flex-wrap"}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={
              "min-h-[44px] rounded-md border px-3 py-2 text-left text-sm transition active:scale-[0.98] sm:px-4 " +
              (active
                ? "border-brand-500 bg-brand-50 text-brand-800"
                : "border-slate-300 bg-surface text-slate-700 hover:border-brand-400") +
              (o.className ? ` ${o.className}` : "")
            }
          >
            <span className="block font-medium">{o.label}</span>
            {o.sub && (
              <span className={"block text-xs " + (active ? "text-brand-600" : "text-slate-500")}>
                {o.sub}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
