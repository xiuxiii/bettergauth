"use client";

import type { TutorPreferences } from "@/lib/tutor/types";

/**
 * Compact in-session toggles for the two preferences the student may want to
 * flip mid-problem: how much help (hints vs. direct) and the goal emphasis.
 * Changes persist and apply to the next tutor turn.
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
    <div className="flex items-center gap-3 overflow-x-auto border-t border-slate-200 bg-white/95 px-3 py-2 text-xs backdrop-blur">
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
    <div className="flex flex-shrink-0 items-center gap-1.5">
      <span className="text-slate-400">{label}</span>
      <div className="flex rounded-full border border-slate-200 bg-slate-50 p-0.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              disabled={disabled}
              onClick={() => onChange(o.value)}
              className={
                "whitespace-nowrap rounded-full px-2.5 py-1 font-medium transition disabled:opacity-50 " +
                (active
                  ? "bg-brand-600 text-white shadow-sm"
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
