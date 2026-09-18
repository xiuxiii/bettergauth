"use client";

import type { TutorPreferences } from "@/lib/tutor/types";

/**
 * Compact in-session toggles for the two preferences the student may want to
 * flip mid-problem: how much help (hints vs. direct) and the goal emphasis.
 * Changes persist and apply to the next tutor turn. Rendered inside the
 * preferences popover in the workspace TopBar.
 */
export default function SessionToggles({
  prefs,
  onChange,
  disabled,
}: {
  prefs: TutorPreferences;
  onChange: (next: TutorPreferences) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <Segment
        label="Help"
        disabled={disabled}
        value={prefs.assistanceStyle}
        onChange={(v) => onChange({ ...prefs, assistanceStyle: v as TutorPreferences["assistanceStyle"] })}
        options={[
          { value: "hint_first", label: "Hints" },
          { value: "direct", label: "Direct" },
        ]}
      />
      <Segment
        label="Goal"
        disabled={disabled}
        value={prefs.goal}
        onChange={(v) => onChange({ ...prefs, goal: v as TutorPreferences["goal"] })}
        options={[
          { value: "both", label: "Both" },
          { value: "understand", label: "Understand" },
          { value: "exam", label: "Exam" },
        ]}
      />
    </div>
  );
}

function Segment({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-500">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex rounded-full bg-slate-100 p-0.5"
      >
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={
                "h-8 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors duration-200 active:scale-95 disabled:opacity-50 " +
                (active
                  ? "bg-brand-600 text-white"
                  : "text-slate-600 hover:text-brand-700")
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
