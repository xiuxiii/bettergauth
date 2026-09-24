"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Camera,
  ChartLine,
  Crosshair,
  Dumbbell,
  Lightbulb,
  MessageCircleQuestion,
  ScanSearch,
} from "lucide-react";
import type { TutorPreferences } from "@/lib/tutor/types";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  savePreferences,
} from "@/lib/preferences";
import type { Theme } from "@/lib/theme";
import Wordmark from "@/components/Wordmark";
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
 * The first-run welcome tour: a short introduction to MindGap, then the setup
 * questions from SetupForm broken into three small slides. New visitors land
 * here from the home page's first-run gate; anyone can replay it from the
 * settings page. Preferences are saved when the last question is answered, so
 * leaving halfway means the tour simply runs again next time.
 */

const STEPS = ["welcome", "purpose", "how", "features", "you", "style", "look", "done"] as const;
type Step = (typeof STEPS)[number];

/** The intro slides; everything after is a question or the finish. */
const INTRO: readonly Step[] = ["welcome", "purpose", "how", "features"];
const FIRST_QUESTION = STEPS.indexOf("you");
const LAST_QUESTION = STEPS.indexOf("look");
/** "done" is a destination, not a step to count. */
const COUNTED = STEPS.length - 1;

const CTA: Record<Step, string> = {
  welcome: "Get started",
  purpose: "Next",
  how: "Next",
  features: "Set up my tutor",
  you: "Next",
  style: "Next",
  look: "Finish",
  done: "Take your first photo",
};

/** Stagger helper: the reveal classes fill backwards, so a delay just waits. */
const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });

export default function Onboarding() {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<"next" | "prev" | null>(null);
  const [prefs, setPrefs] = useState<TutorPreferences>(DEFAULT_PREFERENCES);
  const [theme, chooseTheme] = useThemeChoice();
  const slideRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const step = STEPS[index];
  const isIntro = INTRO.includes(step);

  // Loaded after mount, not in the initial state: the question slides are
  // server-rendered with defaults, and reading storage during render would
  // mismatch them on hydration. A replaying student starts from their answers.
  useEffect(() => {
    const saved = loadPreferences();
    if (saved) setPrefs(saved);
  }, []);

  // Each slide is a new "page": move focus to its heading so screen readers
  // announce it, and bring a tall slide back to the top on phones.
  useEffect(() => {
    if (direction === null) return;
    slideRef.current?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [index, direction]);

  function goTo(next: number) {
    if (next < 0 || next >= STEPS.length || next === index) return;
    setDirection(next > index ? "next" : "prev");
    setIndex(next);
  }

  function advance() {
    if (step === "done") {
      router.push("/");
      return;
    }
    // The last question commits. Theme is already saved as it's picked.
    if (index === LAST_QUESTION) savePreferences(prefs);
    goTo(index + 1);
  }

  const canGoBack = index > 0 && step !== "done";
  // Arrow keys and swipes only browse; finishing always takes a deliberate tap.
  const canBrowseForward = index < LAST_QUESTION;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Leave arrow keys alone inside the option groups.
      const t = e.target as HTMLElement | null;
      if (t?.closest("[role=radiogroup], input, textarea")) return;
      if (e.key === "ArrowRight" && canBrowseForward) goTo(index + 1);
      if (e.key === "ArrowLeft" && canGoBack) goTo(index - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function onTouchStart(e: React.TouchEvent) {
    const p = e.touches[0];
    touchStart.current = { x: p.clientX, y: p.clientY };
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const p = e.changedTouches[0];
    const dx = p.clientX - start.x;
    const dy = p.clientY - start.y;
    // Clearly horizontal only, so scrolling a tall slide never flips it.
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && canBrowseForward) goTo(index + 1);
    if (dx > 0 && canGoBack) goTo(index - 1);
  }

  const slideAnim =
    direction === "next"
      ? "animate-slide-in-next"
      : direction === "prev"
        ? "animate-slide-in-prev"
        : "animate-rise";

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-[max(1.25rem,calc(env(safe-area-inset-top,0px)+0.75rem))] md:max-w-lg md:justify-center md:px-0 md:py-12">
      <div className="flex flex-1 flex-col md:min-h-[680px] md:flex-none md:overflow-hidden md:rounded-lg md:border md:border-hairline md:bg-surface md:p-10 md:shadow-card">
        {/* Top bar: back, progress, skip. Fixed-width ends keep the bar centred. */}
        <div className="flex h-11 items-center gap-3">
          <div className="w-16">
            {canGoBack && (
              <button
                type="button"
                onClick={() => goTo(index - 1)}
                aria-label="Back"
                className="-ml-2 flex h-11 w-11 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-ink active:scale-95"
              >
                <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
              </button>
            )}
          </div>
          <Progress index={index} />
          <div className="flex w-16 justify-end">
            {isIntro && (
              <button
                type="button"
                onClick={() => goTo(FIRST_QUESTION)}
                className="-mr-2 h-11 rounded-md px-2 text-sm text-slate-500 transition hover:text-ink"
              >
                Skip
              </button>
            )}
          </div>
        </div>

        <div
          ref={slideRef}
          key={step}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className={`flex flex-1 flex-col pb-4 pt-6 ${slideAnim}`}
        >
          {step === "welcome" && <WelcomeSlide />}
          {step === "purpose" && <PurposeSlide />}
          {step === "how" && <HowSlide />}
          {step === "features" && <FeaturesSlide />}
          {step === "you" && (
            <QuestionSlide
              n={1}
              title="Where are you at?"
              body="Just a light calibration, so the tutor matches your vocabulary and course terms. It never assumes what you've covered."
            >
              <Field label="Your grade">
                <Options
                  label="Your grade"
                  value={gradeValue(prefs)}
                  onChange={(v) => setPrefs(withGrade(prefs, v))}
                  className="grid grid-cols-3 sm:grid-cols-6"
                  options={GRADE_OPTIONS}
                />
              </Field>
              <Field label="Curriculum" hint="Matches the terms your course uses.">
                <Options
                  label="Curriculum"
                  value={prefs.curriculum ?? "standard"}
                  onChange={(v) =>
                    setPrefs({ ...prefs, curriculum: v as TutorPreferences["curriculum"] })
                  }
                  className="grid grid-cols-3"
                  options={CURRICULUM_OPTIONS}
                />
              </Field>
            </QuestionSlide>
          )}
          {step === "style" && (
            <QuestionSlide
              n={2}
              title="How should it teach you?"
              body="Both of these can be flipped mid-session, whenever a problem calls for it."
            >
              <Field label="How should it help?">
                <Options
                  label="How should it help?"
                  value={prefs.assistanceStyle}
                  onChange={(v) =>
                    setPrefs({ ...prefs, assistanceStyle: v as TutorPreferences["assistanceStyle"] })
                  }
                  className="grid grid-cols-2"
                  options={STYLE_OPTIONS}
                />
              </Field>
              <Field label="Your goal">
                <Options
                  label="Your goal"
                  value={prefs.goal}
                  onChange={(v) => setPrefs({ ...prefs, goal: v as TutorPreferences["goal"] })}
                  className="grid grid-cols-3"
                  options={GOAL_OPTIONS}
                />
              </Field>
            </QuestionSlide>
          )}
          {step === "look" && (
            <QuestionSlide
              n={3}
              title="Pick your look"
              body="Applies right away, so you can see it before you decide."
            >
              <ThemePicker value={theme} onChange={chooseTheme} />
            </QuestionSlide>
          )}
          {step === "done" && <DoneSlide prefs={prefs} />}
        </div>

        {/* On phones the CTA sits in a sticky footer so it is reachable on a
            667px screen without scrolling; the gradient lets content pass under. */}
        <div className="max-md:sticky max-md:bottom-0 max-md:-mx-5 max-md:bg-gradient-to-t max-md:from-paper max-md:via-paper max-md:to-transparent max-md:px-5 max-md:pb-[calc(env(safe-area-inset-bottom,0px)+16px)] max-md:pt-6">
          <button
            type="button"
            onClick={advance}
            className="h-14 w-full rounded-md bg-brand-600 px-5 text-base font-semibold text-white shadow-raised transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep"
          >
            {CTA[step]}
          </button>
        </div>
      </div>
    </main>
  );
}

function Progress({ index }: { index: number }) {
  const shown = Math.min(index + 1, COUNTED);
  return (
    <div
      role="progressbar"
      aria-label="Welcome tour progress"
      aria-valuemin={1}
      aria-valuemax={COUNTED}
      aria-valuenow={shown}
      aria-valuetext={`Step ${shown} of ${COUNTED}`}
      className="flex flex-1 gap-1.5"
    >
      {Array.from({ length: COUNTED }, (_, i) => (
        <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-slate-200">
          <span
            className="block h-full rounded-full bg-brand-600 transition-[width] duration-300 ease-out"
            style={{ width: i <= index ? "100%" : "0%" }}
          />
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

/** Headings take focus on each slide change (for screen readers) but aren't
 *  controls, so the global focus ring is suppressed on them. */
const headingFocus = "outline-none focus-visible:!outline-none";
const headingCls =
  `font-serif text-[2rem] font-normal leading-[1.12] tracking-tight text-ink ${headingFocus}`;

function WelcomeSlide() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <div className="relative mb-8">
        <div
          aria-hidden="true"
          className="animate-glow absolute inset-[-28%] rounded-full bg-brand-300/40 blur-2xl"
        />
        <HeroMark className="relative h-24 w-24 animate-pop-in" />
      </div>
      <p className="animate-rise text-sm font-medium uppercase tracking-[0.18em] text-slate-500" style={delay(200)}>
        Welcome to
      </p>
      <h1 tabIndex={-1} className={`mt-2 animate-rise ${headingFocus}`} style={delay(320)}>
        <Wordmark className="text-5xl" />
      </h1>
      <p
        className="mx-auto mt-5 max-w-xs animate-rise text-[15px] leading-relaxed text-slate-600"
        style={delay(480)}
      >
        Snap a problem. Find the gap in your understanding, not just the answer.
      </p>
      <ul className="mt-6 flex gap-2" aria-label="Subjects">
        {["Physics", "Chemistry", "Math"].map((s, i) => (
          <li
            key={s}
            className="animate-rise rounded-full border border-hairline bg-surface px-3 py-1 text-xs font-medium text-slate-600"
            style={delay(640 + i * 90)}
          >
            {s}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The MindGap mark at hero size, with its missing piece flying into place. */
function HeroMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="mg-mark-hero" x1="3" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5C63E6" />
          <stop offset="1" stopColor="#4E54DD" />
        </linearGradient>
      </defs>
      <path
        d="M6 3.5h7.5A2.5 2.5 0 0 1 16 6v3.4h-1.9a2.1 2.1 0 1 0 0 4.2H16V18a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5Z"
        fill="url(#mg-mark-hero)"
      />
      <rect className="animate-piece" x="18.4" y="6.7" width="4.1" height="4.1" rx="1.3" fill="#A2ACF6" />
    </svg>
  );
}

function PurposeSlide() {
  return (
    <div className="flex flex-1 flex-col">
      <Eyebrow>What it&apos;s for</Eyebrow>
      <h1 tabIndex={-1} className={headingCls}>
        Answers are easy. The gap is the point.
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
        Most homework apps hand you the answer. MindGap reads <em>your</em> work
        and finds the first place your reasoning slipped, so the fix sticks.
      </p>

      {/* A worked attempt with the slip highlighted, the way the tutor sees it. */}
      <figure className="mt-7 animate-rise rounded-lg border border-hairline bg-surface p-4 shadow-card md:bg-paper" style={delay(150)}>
        <figcaption className="text-xs font-medium uppercase tracking-wider text-slate-500">
          Your work
        </figcaption>
        <p className="mt-2 text-sm text-slate-600">
          A ball is thrown straight up at 20 m/s. How high does it go?
        </p>
        <ol className="mt-3 space-y-1.5 font-mono text-[13px] text-slate-800">
          <li className="animate-rise" style={delay(350)}>v² = u² + 2as</li>
          <li className="animate-rise" style={delay(550)}>
            <span className="highlight-sweep -mx-1 rounded-sm px-1 text-brand-800" style={delay(1100)}>
              0 = 20² + 2(9.81)s
            </span>
          </li>
          <li className="animate-rise text-slate-500 line-through decoration-slate-400" style={delay(750)}>
            s = −20.4 m
          </li>
        </ol>
        <div
          className="mt-4 flex animate-pop-in gap-2.5 rounded-md bg-brand-50 p-3 text-sm text-brand-900"
          style={delay(1500)}
        >
          <Crosshair size={18} strokeWidth={1.75} className="mt-0.5 flex-shrink-0 text-brand-600" aria-hidden="true" />
          <p>
            <span className="font-semibold">Here&apos;s the gap:</span> you took up
            as positive, so gravity is −9.81 m/s², not +9.81.
          </p>
        </div>
      </figure>
    </div>
  );
}

const HOW: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Camera,
    title: "Snap it",
    body: "Photograph the problem, plus your working if you have some, and pick the question on the page.",
  },
  {
    icon: ScanSearch,
    title: "Pinpoint",
    body: "MindGap follows your reasoning and finds the first step that went wrong.",
  },
  {
    icon: Lightbulb,
    title: "Close the gap",
    body: "One small hint at a time until you fix it yourself. The full solution is there whenever you want it.",
  },
];

function HowSlide() {
  return (
    <div className="flex flex-1 flex-col">
      <Eyebrow>How it works</Eyebrow>
      <h1 tabIndex={-1} className={headingCls}>
        Three steps, one gap at a time.
      </h1>
      <ol className="mt-8 space-y-6">
        {HOW.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="relative flex animate-rise gap-4" style={delay(150 + i * 180)}>
            {/* The rail down to the next step's icon. */}
            {i < HOW.length - 1 && (
              <span aria-hidden="true" className="absolute -bottom-5 left-5 top-12 w-px bg-hairline" />
            )}
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700">
              <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <div className="pt-0.5">
              <p className="text-[15px] font-semibold text-slate-800">
                <span className="mr-1.5 text-brand-600">{i + 1}.</span>
                {title}
              </p>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">{body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Crosshair,
    title: "Why am I wrong?",
    body: "Show your attempt and get the first real mistake, not a lecture.",
  },
  {
    icon: MessageCircleQuestion,
    title: "Ask mode",
    body: "Frame anything on the page and ask about it.",
  },
  {
    icon: Dumbbell,
    title: "Practice",
    body: "A fresh problem on the same idea, scored when you're done.",
  },
  {
    icon: ChartLine,
    title: "Progress",
    body: "Your history and the concepts you've mastered, kept on this device.",
  },
];

function FeaturesSlide() {
  return (
    <div className="flex flex-1 flex-col">
      <Eyebrow>What you can do</Eyebrow>
      <h1 tabIndex={-1} className={headingCls}>
        Built for how you actually study.
      </h1>
      <ul className="mt-7 grid grid-cols-2 gap-3">
        {FEATURES.map(({ icon: Icon, title, body }, i) => (
          <li
            key={title}
            className="animate-pop-in rounded-lg border border-hairline bg-surface p-4 shadow-card md:bg-paper"
            style={delay(120 + i * 110)}
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-sm bg-brand-50 text-brand-700">
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
            </span>
            <p className="mt-3 text-sm font-semibold text-slate-800">{title}</p>
            <p className="mt-1 text-[13px] leading-snug text-slate-600">{body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuestionSlide({
  n,
  title,
  body,
  children,
}: {
  n: number;
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <Eyebrow>Question {n} of 3</Eyebrow>
      <h1 tabIndex={-1} className={headingCls}>
        {title}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-slate-600">{body}</p>
      <div className="mt-8 animate-rise space-y-8" style={delay(120)}>
        {children}
      </div>
    </div>
  );
}

/**
 * Painted with each theme's own paper/surface/ink values, not the live CSS
 * variables: a preview of "Light" must still look light while the page is dark.
 * "System" shows both halves.
 */
const THEME_SWATCH = {
  light: { paper: "#F7F3EC", surface: "#FCFAF5", line: "#E4DCCD", ink: "#201B14" },
  dark: { paper: "#17140F", surface: "#1F1B15", line: "#3B342A", ink: "#F1ECE2" },
};

function ThemePicker({ value, onChange }: { value: Theme; onChange: (t: Theme) => void }) {
  return (
    <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-3">
      {THEME_OPTIONS.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value as Theme)}
            className={
              "animate-pop-in rounded-lg border p-2 text-left transition active:scale-[0.98] " +
              (active
                ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500"
                : "border-slate-300 bg-surface hover:border-brand-400")
            }
            style={delay(120 + i * 90)}
          >
            <span className="flex aspect-[3/4] overflow-hidden rounded-md border border-hairline" aria-hidden="true">
              {o.value === "system" ? (
                <>
                  <MiniScreen swatch={THEME_SWATCH.light} />
                  <MiniScreen swatch={THEME_SWATCH.dark} />
                </>
              ) : (
                <MiniScreen swatch={THEME_SWATCH[o.value as "light" | "dark"]} />
              )}
            </span>
            <span className={"mt-2 block px-1 text-sm font-medium " + (active ? "text-brand-800" : "text-slate-700")}>
              {o.label}
            </span>
            <span className={"block px-1 text-xs " + (active ? "text-brand-600" : "text-slate-500")}>
              {o.value === "system" ? "Auto" : "Always"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function MiniScreen({ swatch }: { swatch: (typeof THEME_SWATCH)["light"] }) {
  return (
    <span className="flex flex-1 flex-col gap-1.5 p-2" style={{ background: swatch.paper }}>
      <span className="h-1.5 w-2/3 rounded-full" style={{ background: swatch.ink, opacity: 0.85 }} />
      <span
        className="mt-1 flex flex-1 flex-col gap-1 rounded-sm p-1.5"
        style={{ background: swatch.surface, border: `1px solid ${swatch.line}` }}
      >
        <span className="h-1 w-full rounded-full" style={{ background: swatch.line }} />
        <span className="h-1 w-4/5 rounded-full" style={{ background: swatch.line }} />
        <span className="h-1 w-3/5 rounded-full" style={{ background: swatch.line }} />
      </span>
      <span className="h-2.5 rounded-sm bg-brand-600" />
    </span>
  );
}

function DoneSlide({ prefs }: { prefs: TutorPreferences }) {
  const label = (options: { value: string; label: string }[], v: string) =>
    options.find((o) => o.value === v)?.label ?? v;
  const summary = [
    prefs.grade ? `Grade ${label(GRADE_OPTIONS, prefs.grade)}` : null,
    label(CURRICULUM_OPTIONS, prefs.curriculum ?? "standard"),
    label(STYLE_OPTIONS, prefs.assistanceStyle),
    label(GOAL_OPTIONS, prefs.goal) === "Both" ? "Understand + exam" : label(GOAL_OPTIONS, prefs.goal),
  ].filter((s): s is string => !!s);

  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <svg viewBox="0 0 64 64" className="h-20 w-20 animate-pop-in" aria-hidden="true">
        <circle cx="32" cy="32" r="30" className="fill-brand-50" />
        <circle
          cx="32"
          cy="32"
          r="30"
          pathLength={1}
          fill="none"
          strokeWidth="2.5"
          className="animate-draw stroke-brand-500"
          transform="rotate(-90 32 32)"
        />
        <path
          d="M21 33.5l7.5 7.5L44 25"
          pathLength={1}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="animate-draw stroke-brand-600"
          style={delay(450)}
        />
      </svg>
      <h1 tabIndex={-1} className={`${headingCls} mt-7 animate-rise`} style={delay(250)}>
        You&apos;re all set.
      </h1>
      <p className="mx-auto mt-3 max-w-xs animate-rise text-[15px] leading-relaxed text-slate-600" style={delay(350)}>
        Your tutor is tuned. Grab a problem you&apos;re stuck on and let&apos;s find the gap.
      </p>
      <ul className="mt-6 flex flex-wrap justify-center gap-2" aria-label="Your settings">
        {summary.map((s, i) => (
          <li
            key={s}
            className="animate-rise rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800"
            style={delay(500 + i * 80)}
          >
            {s}
          </li>
        ))}
      </ul>
      <p className="mt-6 animate-rise text-xs text-slate-500" style={delay(850)}>
        Change any of this later from <span className="font-medium">Edit preferences</span>.
      </p>
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">
      {children}
    </p>
  );
}
