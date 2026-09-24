"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { TutorPreferences } from "@/lib/tutor/types";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
} from "@/lib/preferences";
import MindGapMark from "@/components/MindGapMark";
import type { Theme } from "@/lib/theme";
import {
  CURRICULUM_OPTIONS,
  Field,
  GOAL_OPTIONS,
  GRADE_OPTIONS,
  Options,
  STYLE_OPTIONS,
  THEME_OPTIONS,
  gradeValue,
  useThemeChoice,
  withGrade,
} from "@/components/PreferenceFields";

/**
 * The editable preferences page. First-run visitors get the guided version of
 * these same questions at /welcome (components/Onboarding.tsx). Captures a light calibration — grade,
 * how much help to lean on, and the goal — that gets folded into the tutor's
 * system prompt. Subject is intentionally not asked (the model detects it).
 */
export default function SetupForm() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<TutorPreferences>(
    () => loadPreferences() ?? DEFAULT_PREFERENCES,
  );

  const [theme, chooseTheme] = useThemeChoice();

  function save() {
    savePreferences(prefs);
    router.push("/");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-[max(3rem,calc(env(safe-area-inset-top,0px)+2rem))] md:max-w-lg md:justify-center md:px-0 md:py-12">
      <div className="flex flex-1 animate-rise flex-col md:flex-none md:rounded-lg md:border md:border-hairline md:bg-surface md:p-10 md:shadow-card">
        <header className="mb-8">
          <MindGapMark className="mb-4 h-8 w-8" />
          <h1 className="font-serif text-3xl font-normal leading-[1.15] tracking-tight text-ink">
            Set up your tutor
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            A few quick settings. You can change the last two any time during a
            session.
          </p>
        </header>

        <div className="flex-1 space-y-8">
          <Field
            label="Your grade"
            hint="Just a light calibration of vocabulary — it won't assume specific courses."
          >
            <Options
              value={gradeValue(prefs)}
              onChange={(v) => setPrefs(withGrade(prefs, v))}
              className="grid grid-cols-3 sm:grid-cols-6"
              options={GRADE_OPTIONS}
            />
          </Field>

          <Field label="Curriculum" hint="Matches the terms your course uses.">
            <Options
              value={prefs.curriculum ?? "standard"}
              onChange={(v) =>
                setPrefs({ ...prefs, curriculum: v as TutorPreferences["curriculum"] })
              }
              className="grid grid-cols-3"
              options={CURRICULUM_OPTIONS}
            />
          </Field>

          <Field
            label="How should it help?"
            hint="You can flip this mid-session."
          >
            <Options
              value={prefs.assistanceStyle}
              onChange={(v) =>
                setPrefs({ ...prefs, assistanceStyle: v as TutorPreferences["assistanceStyle"] })
              }
              className="grid grid-cols-2"
              options={STYLE_OPTIONS}
            />
          </Field>

          <Field label="Your goal" hint="You can flip this mid-session.">
            <Options
              value={prefs.goal}
              onChange={(v) => setPrefs({ ...prefs, goal: v as TutorPreferences["goal"] })}
              className="grid grid-cols-3"
              options={GOAL_OPTIONS}
            />
          </Field>

          <Field label="Appearance" hint="Applies right away.">
            <Options
              value={theme}
              onChange={(v) => chooseTheme(v as Theme)}
              options={THEME_OPTIONS}
            />
          </Field>
        </div>

        {/* On phones the CTA sits in a sticky footer so it is reachable on a
            667px screen without scrolling; the gradient lets content pass under. */}
        <div className="mt-8 max-md:sticky max-md:bottom-0 max-md:-mx-5 max-md:bg-gradient-to-t max-md:from-paper max-md:via-paper max-md:to-transparent max-md:px-5 max-md:pb-[calc(env(safe-area-inset-bottom,0px)+16px)] max-md:pt-6">
          <button
            onClick={save}
            className="h-14 w-full rounded-md bg-brand-600 px-5 text-base font-semibold text-white shadow-raised transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep"
          >
            Start tutoring
          </button>
          <Link
            href="/welcome"
            className="mt-3 block text-center text-sm text-slate-500 underline-offset-4 transition hover:text-ink hover:underline"
          >
            Replay the welcome tour
          </Link>
        </div>
      </div>
    </main>
  );
}
