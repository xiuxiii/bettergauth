"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronUp, CircleHelp } from "lucide-react";
import type { TutorAction } from "@/lib/tutor/types";
import { Spinner } from "@/components/States";

/**
 * The level-of-assistance ladder. Every item is just a signal to the same tutor
 * engine (see TutorAction) — from the lightest nudge to the full solution, plus
 * a lateral "test my understanding" move. Free-form questions (the default) go
 * through the text input below, so these never replace normal conversation.
 */
const ASSIST: { action: Exclude<TutorAction, "ask">; label: string }[] = [
  { action: "hint", label: "Hint" },
  { action: "explain", label: "Explain why" },
  { action: "go_deeper", label: "Go deeper" },
  { action: "show_solution", label: "Show solution" },
  { action: "similar_problem", label: "Try similar" },
];

const chipCls =
  "h-10 flex-shrink-0 snap-start whitespace-nowrap rounded-full border border-slate-300 bg-surface px-3.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-700 active:scale-[0.97] disabled:opacity-50 md:h-9";

const whyCls =
  "flex h-10 flex-shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full border border-brand-300 bg-brand-50 px-3.5 text-sm font-semibold text-brand-700 transition hover:border-brand-500 hover:bg-brand-100 active:scale-[0.97] disabled:opacity-50 md:h-9";

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

/** Bring a tapped chip fully into view before its action fires. */
function reveal(e: React.MouseEvent<HTMLButtonElement>) {
  e.currentTarget.scrollIntoView({
    inline: "nearest",
    block: "nearest",
    behavior: "smooth",
  });
}

/**
 * The tutor controls: the assistance ladder, the two richer modes (check work /
 * practice), and a free-text input for follow-up questions. Deliberately flat
 * and uniform — no colors or icons competing for attention. Disabled while a
 * turn is in flight.
 */
export default function ActionBar({
  busy,
  onAction,
  onAsk,
  onWhyWrong,
  onCheckWork,
  onPractice,
  onFocus,
}: {
  busy: boolean;
  onAction: (action: Exclude<TutorAction, "ask">) => void;
  onAsk: (text: string) => void;
  onWhyWrong: () => void;
  onCheckWork: () => void;
  onPractice: () => void;
  /** Fired when the composer gains focus (used to keep the newest message in view). */
  onFocus?: () => void;
}) {
  const [text, setText] = useState("");
  const short = useShortViewport();
  // Short viewports collapse the chip row into an "Actions" pill + popover.
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!actionsOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!actionsRef.current?.contains(e.target as Node)) setActionsOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setActionsOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [actionsOpen]);

  useEffect(() => {
    if (!short) setActionsOpen(false);
  }, [short]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onAsk(trimmed);
    setText("");
  }

  /** The same chips and handlers, laid out as a scrolling row or a 2-col grid. */
  function chips(layout: "row" | "grid") {
    const grid = layout === "grid";
    const run = (e: React.MouseEvent<HTMLButtonElement>, fn: () => void) => {
      if (grid) setActionsOpen(false);
      else reveal(e);
      fn();
    };
    const cls = (base: string) =>
      grid ? `${base} justify-center truncate` : base;
    return (
      <>
        {/* The headline diagnostic action — analyze THEIR reasoning. */}
        <button
          disabled={busy}
          onClick={(e) => run(e, onWhyWrong)}
          className={cls(whyCls)}
        >
          <CircleHelp size={16} strokeWidth={1.75} aria-hidden="true" />
          Why am I wrong?
        </button>
        {!grid && (
          <span className="mx-0.5 h-5 w-px flex-shrink-0 self-center bg-hairline" />
        )}

        {/* Assistance ladder — signals to the tutor engine. */}
        {ASSIST.map(({ action, label }) => (
          <button
            key={action}
            disabled={busy}
            onClick={(e) => run(e, () => onAction(action))}
            className={cls(chipCls)}
          >
            {label}
          </button>
        ))}

        {/* Divider, then the two richer modes. */}
        {!grid && (
          <span className="mx-0.5 h-5 w-px flex-shrink-0 self-center bg-hairline" />
        )}
        <button
          disabled={busy}
          onClick={(e) => run(e, onCheckWork)}
          className={cls(chipCls)}
        >
          Check my work
        </button>
        <button
          disabled={busy}
          onClick={(e) => run(e, onPractice)}
          className={cls(chipCls)}
        >
          Practice
        </button>
      </>
    );
  }

  return (
    <div className="border-t border-hairline bg-surface/95 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-2 backdrop-blur">
      {!short && (
        <div className="scroll-fade mb-2 flex snap-x snap-proximity items-center gap-2 overflow-x-auto pb-1 pr-6">
          {chips("row")}
        </div>
      )}

      <div className="flex items-end gap-2">
        {short && (
          <div ref={actionsRef} className="relative flex-shrink-0">
            <button
              onClick={() => setActionsOpen((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={actionsOpen}
              className="inline-flex h-10 items-center gap-1 rounded-full border border-slate-300 bg-surface px-3.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-700"
            >
              Actions
              <ChevronUp
                size={16}
                strokeWidth={1.75}
                aria-hidden="true"
                className={`transition-transform ${actionsOpen ? "rotate-180" : ""}`}
              />
            </button>
            {actionsOpen && (
              <div
                role="dialog"
                aria-label="Tutor actions"
                className="absolute bottom-full left-0 z-30 mb-2 grid w-[min(22rem,calc(100vw-1.5rem))] grid-cols-2 gap-2 animate-pop-in rounded-lg border border-hairline bg-surface p-2 shadow-raised"
              >
                {chips("grid")}
              </div>
            )}
          </div>
        )}

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
            placeholder="Ask a follow-up, or share your thinking…"
            className="max-h-32 min-h-[44px] w-full resize-none rounded-md border border-slate-300 bg-surface px-3.5 py-2 text-base leading-6 text-ink outline-none transition placeholder:text-slate-400 focus:border-slate-300 md:pr-40"
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
