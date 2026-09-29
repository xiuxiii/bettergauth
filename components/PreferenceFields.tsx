"use client";

import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Contrast, Moon, Sun } from "lucide-react";
import type { TutorPreferences } from "@/lib/tutor/types";
import {
  applyTheme,
  loadTheme,
  saveTheme,
  watchSystemTheme,
  type Theme,
} from "@/lib/theme";

/**
 * The preference options, once, for every place that shows them: the Settings
 * page, the session popover and the welcome tour. They share this data, not a
 * component: the tour shows big cards, Settings shows rows. Two copies of a
 * list let the tour save a value Settings can't display, and let the two
 * screens call the same setting different things.
 */

export type Option<T extends string = string> = {
  value: T;
  label: string;
  /** For tight spots: the header pill reads "Hints · Both". */
  short?: string;
  /** One line, shown under the label. */
  description?: string;
  icon?: LucideIcon;
};

/** "skip" stands for a null grade; the stored value stays null. */
export type GradeChoice = NonNullable<TutorPreferences["grade"]> | "skip";

export const GRADE_OPTIONS: Option<GradeChoice>[] = [
  { value: "9", label: "9" },
  { value: "10", label: "10" },
  { value: "11", label: "11" },
  { value: "12", label: "12" },
  { value: "other", label: "Other" },
  { value: "skip", label: "Prefer not to say" },
];

export const CURRICULUM_OPTIONS: Option<NonNullable<TutorPreferences["curriculum"]>>[] = [
  { value: "standard", label: "Standard" },
  { value: "ib", label: "IB" },
  { value: "ap", label: "AP" },
];

export const STYLE_OPTIONS: Option<TutorPreferences["assistanceStyle"]>[] = [
  { value: "hint_first", label: "Hints first", short: "Hints", description: "Nudges before answers" },
  { value: "direct", label: "Direct", description: "Explains straight away" },
];

export const GOAL_OPTIONS: Option<TutorPreferences["goal"]>[] = [
  { value: "both", label: "Both", description: "Exam-ready and deep" },
  { value: "understand", label: "Understand", description: "The why" },
  { value: "exam", label: "Exam prep", description: "Drills and traps" },
];

export const THEME_OPTIONS: Option<Theme>[] = [
  { value: "system", label: "Auto", icon: Contrast, description: "Follows your device" },
  { value: "light", label: "Light", icon: Sun, description: "Always light" },
  { value: "dark", label: "Dark", icon: Moon, description: "Always dark" },
];

/** The setting names, the same on every screen. */
export const LABELS = {
  style: "Help style",
  goal: "Focus",
  tutor: "Tutor",
  grade: "Grade",
  curriculum: "Curriculum",
  theme: "Appearance",
} as const;

export function optionOf<T extends string>(options: Option<T>[], value: T): Option<T> | undefined {
  return options.find((o) => o.value === value);
}

export function gradeValue(prefs: TutorPreferences): GradeChoice {
  return prefs.grade ?? "skip";
}
export function withGrade(prefs: TutorPreferences, v: GradeChoice): TutorPreferences {
  return { ...prefs, grade: v === "skip" ? null : v };
}
/** "Grade 11", "Other", or "Not set". */
export function gradeSummary(prefs: TutorPreferences): string {
  if (!prefs.grade) return "Not set";
  return prefs.grade === "other" ? "Other" : `Grade ${prefs.grade}`;
}

/**
 * The theme choice, applied the moment it's picked. Theme is stored separately
 * from preferences (see lib/theme.ts) and starts at the SSR-safe default:
 * reading storage during render would disagree with the server markup and trip
 * a hydration mismatch on the selected option.
 */
export function useThemeChoice(): [Theme, (next: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("system");
  useEffect(() => setThemeState(loadTheme()), []);

  // While on "system", follow the OS live rather than waiting for a reload.
  useEffect(() => {
    if (theme !== "system") return;
    return watchSystemTheme(() => applyTheme("system"));
  }, [theme]);

  // Applied immediately: a colour choice you cannot see is one you cannot judge.
  function chooseTheme(next: Theme) {
    setThemeState(next);
    applyTheme(next);
    saveTheme(next);
  }
  return [theme, chooseTheme];
}
