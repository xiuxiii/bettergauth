"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, Lightbulb, Sparkles, Target } from "lucide-react";
import type { TutorPreferences } from "@/lib/tutor/types";
import { useAiChoice } from "@/lib/aiChoice";
import { GOAL_OPTIONS, LABELS, STYLE_OPTIONS, optionOf } from "@/components/PreferenceFields";
import SettingsRow from "@/components/ui/SettingsRow";
import SegmentedControl from "@/components/ui/SegmentedControl";

/**
 * The session popover in the workspace TopBar: the settings a student may want
 * to flip mid-problem, with the same rows, labels and descriptions as the
 * Tutoring group in Settings.
 *
 * Every change applies to the next request and nothing else: the transcript,
 * memory and reveal state stay as they are. So the controls are disabled while
 * a request is in flight, and a Tutor switch can never split one reply across
 * two providers. The only feedback is the selected segment moving.
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
  const router = useRouter();
  const ai = useAiChoice();

  return (
    <div>
      <div className="divide-y divide-hairline">
        <SettingsRow
          stacked
          icon={Lightbulb}
          label={LABELS.style}
          description={optionOf(STYLE_OPTIONS, prefs.assistanceStyle)?.description}
          control={(id) => (
            <SegmentedControl
              labelledBy={id}
              disabled={disabled}
              value={prefs.assistanceStyle}
              options={STYLE_OPTIONS}
              onChange={(v) => onChange({ ...prefs, assistanceStyle: v })}
            />
          )}
        />
        <SettingsRow
          stacked
          icon={Target}
          label={LABELS.goal}
          description={optionOf(GOAL_OPTIONS, prefs.goal)?.description}
          control={(id) => (
            <SegmentedControl
              labelledBy={id}
              disabled={disabled}
              value={prefs.goal}
              options={GOAL_OPTIONS}
              onChange={(v) => onChange({ ...prefs, goal: v })}
            />
          )}
        />
        {ai.switchable && (
          <SettingsRow
            stacked
            icon={Sparkles}
            label={LABELS.tutor}
            control={(id) => (
              <SegmentedControl
                labelledBy={id}
                disabled={disabled}
                value={ai.choice}
                options={ai.options}
                onChange={ai.choose}
              />
            )}
          />
        )}
      </div>
      <Link
        href="/settings"
        onClick={(e) => {
          // Settings' back arrow returns to this session.
          e.preventDefault();
          const here = window.location.pathname + window.location.search;
          router.push(`/settings?back=${encodeURIComponent(here)}`);
        }}
        className="flex h-11 items-center justify-between rounded-b-lg border-t border-hairline px-4 text-sm font-medium text-brand-700 transition hover:bg-slate-50"
      >
        More settings
        <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
      </Link>
    </div>
  );
}
