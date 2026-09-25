"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronUp, Ellipsis } from "lucide-react";
import type { TutorAction } from "@/lib/tutor/types";
import type { SessionStage } from "@/lib/tutor/stage";
import { Spinner } from "@/components/States";

type ChipId =
  | "hint"
  | "stuck"
  | "explain"
  | "check"
  | "deeper"
  | "similar"
  | "solution";

const LABEL: Record<ChipId, string> = {
  hint: "Hint",
  stuck: "I'm stuck",
  explain: "Explain why",
  check: "Check my work",
  deeper: "Go deeper",
  similar: "Try a similar one",
  solution: "Show solution",
};

/**
 * At most three chips, picked by where the session stands, instead of eight
 * equal ones scrolling off the side of a phone.
 *
 * Go deeper holds a slot at every stage. Students rarely reach "resolved":
 * they take a hint, grind it out and close the app, so anything kept for the
 * end is something most of them never see.
 */
const ROW: Record<SessionStage, ChipId[]> = {
  fresh: ["hint", "check", "deeper"],
  diagnosed: ["explain", "check", "deeper"],
  resolved: ["similar", "deeper"],
};

/**
 * Fresh, but a hint has been given (the opening nudge counts). The next ask
 * is usually "why?", so Explain why takes Hint's place; another hint is one
 * tap away in More.
 */
const ROW_AFTER_HINT: ChipId[] = ["explain", "check", "deeper"];

/**
 * Everything else, one tap deeper. Show solution is ALWAYS here: students stay
 * in control and are never locked out of the answer, only not pushed toward it.
 */
const MORE_ORDER: ChipId[] = [
  "hint",
  "stuck",
  "explain",
  "check",
  "similar",
  "solution",
];

const chipCls =
  "h-10 whitespace-nowrap rounded-full border border-slate-300 bg-surface px-3.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-700 active:scale-[0.97] disabled:opacity-50 md:h-9";

const menuItemCls =
  "flex h-11 w-full items-center rounded-md px-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 hover:text-ink disabled:opacity-50";

/**
 * True when the viewport is too short for the full bottom stack — the on-screen
 * keyboard is open, or the phone is in landscape. Purely presentational.
 */
function useShortViewport() {
  const [short, setShort] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-height: 560px)");
    const update = () => setShort(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return short;
}

/**
 * The tutor controls: a few chips chosen by the session's stage, a "More"
 * menu with the rest, and a free-text input for follow-up questions. Disabled
 * while a turn is in flight.
 */
export default function ActionBar({
  busy,
  stage,
  hinted = false,
  onAction,
  onAsk,
  onCheckWork,
  onPractice,
  onFocus,
}: {
  busy: boolean;
  stage: SessionStage;
  /** A hint has been given; see ROW_AFTER_HINT. */
  hinted?: boolean;
  onAction: (action: Exclude<TutorAction, "ask">) => void;
  onAsk: (text: string) => void;
  onCheckWork: () => void;
  onPractice: () => void;
  /** Fired when the composer gains focus (used to keep the newest message in view). */
  onFocus?: () => void;
}) {
  const [text, setText] = useState("");
  const short = useShortViewport();
  // The "More" menu; on short viewports it holds every action.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Element;
      // The menu has two possible triggers (see the render); either one
      // toggles it itself, so a press on one must not also close it here.
      if (menuRef.current?.contains(target) || target.closest?.("[data-more-trigger]")) return;
      setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    setMenuOpen(false);
  }, [short, stage]);

  const row = stage === "fresh" && hinted ? ROW_AFTER_HINT : ROW[stage];
  const rest = MORE_ORDER.filter((id) => !row.includes(id));
  // Short viewports have no chip row, so the menu holds the row's chips too.
  const more = short ? [...row, ...rest] : rest;

  function run(id: ChipId) {
    setMenuOpen(false);
    switch (id) {
      case "hint":
        return onAction("hint");
      case "explain":
        return onAction("explain");
      case "deeper":
        return onAction("go_deeper");
      case "solution":
        return onAction("show_solution");
      case "check":
        return onCheckWork();
      case "similar":
        return onPractice();
      case "stuck":
        // A free-form turn, so the engine treats it as the student asking:
        // one localized explanation of the step they're on, not a new move.
        return onAsk("I'm stuck.");
    }
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onAsk(trimmed);
    setText("");
  }

  return (
    <div className="relative border-t border-hairline bg-surface/95 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-2 backdrop-blur">
      {!short && (
        // Wraps rather than scrolls: at most three chips, and a hidden chip is
        // an option nobody knows exists.
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {row.map((id) => (
            <button
              key={id}
              disabled={busy}
              onClick={() => run(id)}
              className={chipCls}
            >
              {LABEL[id]}
            </button>
          ))}
          {/* Below 360px the row wraps anyway, so "More" rides on its second
              line. Beside the input it would cost the text box the width its
              one-line placeholder needs (197px; only 162px left at 320). */}
          <button
            data-more-trigger
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="More actions"
            className={`${chipCls} flex items-center !px-3 min-[360px]:hidden`}
          >
            <Ellipsis size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      )}

      {menuOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="More actions"
          className="absolute bottom-full left-3 z-30 mb-2 w-56 animate-pop-in rounded-lg border border-hairline bg-surface p-1.5 shadow-raised"
        >
          {more.map((id) => (
            <button
              key={id}
              role="menuitem"
              disabled={busy}
              onClick={() => run(id)}
              className={`${menuItemCls} ${id === "solution" ? "mt-1 border-t border-hairline pt-1" : ""}`}
            >
              {LABEL[id]}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className={short ? "flex-shrink-0" : "hidden flex-shrink-0 min-[360px]:block"}>
          {short ? (
            <button
              data-more-trigger
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="inline-flex h-11 items-center gap-1 rounded-full border border-slate-300 bg-surface px-3.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-700"
            >
              Actions
              <ChevronUp
                size={16}
                strokeWidth={1.75}
                aria-hidden="true"
                className={`transition-transform ${menuOpen ? "rotate-180" : ""}`}
              />
            </button>
          ) : (
            <button
              data-more-trigger
              onClick={() => setMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="More actions"
              className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-surface text-slate-600 transition hover:border-brand-400 hover:text-brand-700"
            >
              <Ellipsis size={18} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="relative min-w-0 flex-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={onFocus}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            // Short enough for one line at 320px in the one-row box; the old
            // "Ask a follow-up, or share your thinking…" wrapped and clipped.
            placeholder="Ask or share your thinking…"
            // A real focus state. `outline-none` beats the global
            // :focus-visible ring, and the old focus border was the resting
            // colour, so focus was effectively invisible. brand-500 is a fixed
            // step: 4.59:1 on the light surface, 3.57:1 on the dark one.
            className="max-h-32 min-h-[44px] w-full resize-none rounded-md border border-slate-300 bg-surface px-3.5 py-2 text-base leading-6 text-ink outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30 md:pr-40"
          />
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 right-3 hidden select-none font-sans text-xs text-slate-400 md:block"
          >
            ↵ send · ⇧↵ newline
          </kbd>
        </div>
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          aria-label="Send"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep disabled:bg-brand-300 disabled:text-white/90"
        >
          {busy ? (
            <Spinner className="h-5 w-5" />
          ) : (
            <ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  );
}
