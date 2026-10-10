"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  ChevronLeft,
  CircleUser,
  GraduationCap,
  Lightbulb,
  Sparkles,
  SunMoon,
  Target,
} from "lucide-react";
import type { TutorPreferences } from "@/lib/tutor/types";
import { DEFAULT_PREFERENCES, loadPreferences, savePreferences } from "@/lib/preferences";
import { useAiChoice } from "@/lib/aiChoice";
import { useAccount } from "@/lib/account/useAccount";
import { clearAll, listSessions } from "@/lib/history/db";
import { safeBackPath } from "@/lib/safePath";
import {
  CURRICULUM_OPTIONS,
  GOAL_OPTIONS,
  GRADE_OPTIONS,
  LABELS,
  STYLE_OPTIONS,
  THEME_OPTIONS,
  gradeSummary,
  gradeValue,
  optionOf,
  useThemeChoice,
  withGrade,
} from "@/components/PreferenceFields";
import SettingsGroup from "@/components/ui/SettingsGroup";
import SettingsRow from "@/components/ui/SettingsRow";
import SegmentedControl from "@/components/ui/SegmentedControl";
import ChoiceSheet from "@/components/ui/ChoiceSheet";
import Toast from "@/components/ui/Toast";
import { useUndoable } from "@/components/ui/useUndoable";
import ClearHistoryConfirm from "@/components/ClearHistoryConfirm";

const SAVED_MS = 1600;

/** In the sheet, the numbers read the way the row shows them: "Grade 11". */
const GRADE_CHOICES = GRADE_OPTIONS.map((o) =>
  /^\d+$/.test(o.value) ? { ...o, label: `Grade ${o.label}` } : o,
);

/**
 * Settings: one row per setting, grouped, and every change saved the moment
 * it's made (with a "Saved" toast), so there is no submit button and nothing
 * to lose by leaving. First-run visitors get the guided version of the same
 * questions at /welcome.
 */
export default function SettingsView() {
  const router = useRouter();
  const [prefs, setPrefs] = useState<TutorPreferences>(DEFAULT_PREFERENCES);
  const [theme, chooseTheme] = useThemeChoice();
  const ai = useAiChoice();
  const account = useAccount();
  const [sheet, setSheet] = useState<"goal" | "grade" | null>(null);

  // Loaded after mount: reading storage during render would disagree with the
  // server-rendered defaults and trip a hydration mismatch.
  useEffect(() => {
    const saved = loadPreferences();
    if (saved) setPrefs(saved);
  }, []);

  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);
  const flashSaved = useCallback(() => {
    setSaved(true);
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), SAVED_MS);
  }, []);
  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    [],
  );

  function update(next: TutorPreferences) {
    setPrefs(next);
    savePreferences(next);
    flashSaved();
  }

  // History: the footer link shows only when there is something to clear.
  const [historyCount, setHistoryCount] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const { pending, schedule, undo } = useUndoable();
  useEffect(() => {
    listSessions()
      .then((rows) => setHistoryCount(rows.length))
      .catch(() => setHistoryCount(0));
  }, []);

  function clearHistory() {
    setConfirmClear(false);
    void schedule("all", "History cleared", async () => {
      await clearAll();
      setHistoryCount(0);
    });
  }

  // Back to wherever "More settings" was opened from (a session), else home.
  // Same-origin paths only (safeBackPath).
  function back() {
    router.push(safeBackPath(new URLSearchParams(window.location.search).get("back")));
  }

  const goal = optionOf(GOAL_OPTIONS, prefs.goal);
  const style = optionOf(STYLE_OPTIONS, prefs.assistanceStyle);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md animate-rise px-4 pb-24 pt-[max(1rem,calc(env(safe-area-inset-top,0px)+0.5rem))] md:max-w-lg md:pt-10">
      <header className="mb-5 flex items-center gap-1">
        <button
          type="button"
          onClick={back}
          aria-label="Back"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
        >
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <h1 className="font-serif text-2xl font-normal leading-[1.15] tracking-tight text-ink">
          Settings
        </h1>
      </header>

      <div className="space-y-6">
        {/* Only when accounts are set up, and once the session is known. */}
        {(account.status === "signedIn" || account.status === "signedOut") && (
          <SettingsGroup title="Account">
            <SettingsRow
              icon={CircleUser}
              label={account.status === "signedIn" ? (account.email ?? "Your account") : "Sign in"}
              description={
                account.status === "signedIn"
                  ? "Signed in"
                  : "Keep your problems and progress on every device"
              }
              value=""
              onClick={() => router.push(account.status === "signedIn" ? "/account" : "/signin?next=/settings")}
            />
          </SettingsGroup>
        )}

        <SettingsGroup title="Tutoring">
          <SettingsRow
            icon={Lightbulb}
            label={LABELS.style}
            description={style?.description}
            control={(id) => (
              <SegmentedControl
                labelledBy={id}
                value={prefs.assistanceStyle}
                options={STYLE_OPTIONS}
                onChange={(v) => update({ ...prefs, assistanceStyle: v })}
              />
            )}
          />
          <div className="relative">
            <SettingsRow
              icon={Target}
              label={LABELS.goal}
              description={goal?.description}
              value={goal?.label ?? ""}
              expanded={sheet === "goal"}
              onClick={() => setSheet(sheet === "goal" ? null : "goal")}
            />
            {sheet === "goal" && (
              <ChoiceSheet
                title={LABELS.goal}
                value={prefs.goal}
                options={GOAL_OPTIONS}
                onSelect={(v) => update({ ...prefs, goal: v })}
                onClose={() => setSheet(null)}
              />
            )}
          </div>
          {/* Only when there is a choice to make: never a disabled option. */}
          {ai.switchable && (
            <SettingsRow
              icon={Sparkles}
              label={LABELS.tutor}
              control={(id) => (
                <SegmentedControl
                  labelledBy={id}
                  value={ai.choice}
                  options={ai.options}
                  onChange={(v) => {
                    ai.choose(v);
                    flashSaved();
                  }}
                />
              )}
            />
          )}
        </SettingsGroup>

        <SettingsGroup title="About you">
          <div className="relative">
            <SettingsRow
              icon={GraduationCap}
              label={LABELS.grade}
              value={gradeSummary(prefs)}
              expanded={sheet === "grade"}
              onClick={() => setSheet(sheet === "grade" ? null : "grade")}
            />
            {sheet === "grade" && (
              <ChoiceSheet
                title={LABELS.grade}
                value={gradeValue(prefs)}
                options={GRADE_CHOICES}
                onSelect={(v) => update(withGrade(prefs, v))}
                onClose={() => setSheet(null)}
              />
            )}
          </div>
          <SettingsRow
            icon={BookOpen}
            label={LABELS.curriculum}
            control={(id) => (
              <SegmentedControl
                labelledBy={id}
                value={prefs.curriculum ?? "standard"}
                options={CURRICULUM_OPTIONS}
                onChange={(v) => update({ ...prefs, curriculum: v })}
              />
            )}
          />
        </SettingsGroup>

        <SettingsGroup title="App">
          <SettingsRow
            icon={SunMoon}
            label={LABELS.theme}
            control={(id) => (
              <SegmentedControl
                labelledBy={id}
                value={theme}
                options={THEME_OPTIONS}
                onChange={(v) => {
                  chooseTheme(v);
                  flashSaved();
                }}
              />
            )}
          />
        </SettingsGroup>

        <div className="flex flex-col items-center gap-1 pt-2">
          <Link
            href="/welcome"
            className="flex h-11 items-center rounded-md px-3 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-ink"
          >
            Replay welcome tour
          </Link>
          <Link
            href="/privacy?back=/settings"
            className="flex h-11 items-center rounded-md px-3 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-ink"
          >
            Privacy
          </Link>
          {historyCount > 0 && pending?.key !== "all" &&
            (confirmClear ? (
              <div className="mt-1 w-full">
                <ClearHistoryConfirm
                  count={historyCount}
                  onConfirm={clearHistory}
                  onCancel={() => setConfirmClear(false)}
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="h-11 rounded-md px-3 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-ink"
              >
                Clear history
              </button>
            ))}
        </div>
      </div>

      <Toast
        message={pending?.message ?? (saved ? "Saved" : null)}
        action={pending ? { label: "Undo", onClick: undo } : undefined}
      />
    </main>
  );
}
