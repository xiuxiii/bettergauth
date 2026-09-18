"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TutorPreferences } from "@/lib/tutor/types";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
} from "@/lib/preferences";
import MindGapMark from "@/components/MindGapMark";

/**
 * First-run (and editable) preferences. Captures a light calibration — grade,
 * how much help to lean on, and the goal — that gets folded into the tutor's
 * system prompt. Subject is intentionally not asked (the model detects it).
 */
export default function SetupForm() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<TutorPreferences>(
    () => loadPreferences() ?? DEFAULT_PREFERENCES,
  );

  function save() {
    savePreferences(prefs);
    router.push("/");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-10 pt-12 md:justify-center md:py-12">
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
              value={prefs.grade ?? "skip"}
              onChange={(v) =>
                setPrefs({ ...prefs, grade: v === "skip" ? null : (v as TutorPreferences["grade"]) })
              }
              className="sm:grid sm:grid-cols-6"
              options={[
                { value: "9", label: "9", className: "sm:text-center" },
                { value: "10", label: "10", className: "sm:text-center" },
                { value: "11", label: "11", className: "sm:text-center" },
                { value: "12", label: "12", className: "sm:text-center" },
                { value: "other", label: "Other", className: "sm:text-center" },
                { value: "skip", label: "Prefer not to say", className: "sm:col-span-2 sm:text-center" },
              ]}
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
              options={[
                { value: "hint_first", label: "Hints first", sub: "Make me work" },
                { value: "direct", label: "Direct", sub: "Explain it to me" },
              ]}
            />
          </Field>

          <Field label="Your goal" hint="You can flip this mid-session.">
            <Options
              value={prefs.goal}
              onChange={(v) => setPrefs({ ...prefs, goal: v as TutorPreferences["goal"] })}
              options={[
                { value: "both", label: "Both", sub: "Exam-ready + deep" },
                { value: "understand", label: "Understand", sub: "The why" },
                { value: "exam", label: "Exam prep", sub: "Drill + traps" },
              ]}
            />
          </Field>
        </div>

        <button
          onClick={save}
          className="mt-8 h-14 w-full rounded-md bg-brand-600 px-5 text-base font-semibold text-white shadow-raised transition hover:bg-brand-700 active:scale-[0.98] active:bg-brand-700"
        >
          Start tutoring
        </button>
      </div>
    </main>
  );
}

function Field({
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

function Options({
  value,
  onChange,
  options,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; sub?: string; className?: string }[];
  /** Extra layout classes for the group (e.g. a grid on wider screens). */
  className?: string;
}) {
  return (
    <div role="radiogroup" className={`flex flex-wrap gap-2 ${className}`}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={
              "min-h-[44px] rounded-md border px-4 py-2 text-left text-sm transition " +
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
