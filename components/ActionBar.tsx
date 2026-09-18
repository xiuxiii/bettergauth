"use client";

import { useState } from "react";
import { ArrowRight, CircleHelp } from "lucide-react";
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
  "h-9 flex-shrink-0 snap-start whitespace-nowrap rounded-full border border-slate-300 bg-surface px-3.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-700 active:scale-[0.97] disabled:opacity-50";

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
}: {
  busy: boolean;
  onAction: (action: Exclude<TutorAction, "ask">) => void;
  onAsk: (text: string) => void;
  onWhyWrong: () => void;
  onCheckWork: () => void;
  onPractice: () => void;
}) {
  const [text, setText] = useState("");

  function submit() {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    onAsk(trimmed);
    setText("");
  }

  return (
    <div className="border-t border-hairline bg-surface/95 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+12px)] pt-2 backdrop-blur">
      <div className="scroll-fade mb-2 flex snap-x snap-proximity items-center gap-2 overflow-x-auto pb-1 pr-6">
        {/* The headline diagnostic action — analyze THEIR reasoning. */}
        <button
          disabled={busy}
          onClick={onWhyWrong}
          className="flex h-9 flex-shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full border border-brand-300 bg-brand-50 px-3.5 text-sm font-semibold text-brand-700 transition hover:border-brand-500 hover:bg-brand-100 active:scale-[0.97] disabled:opacity-50"
        >
          <CircleHelp size={16} strokeWidth={1.75} aria-hidden="true" />
          Why am I wrong?
        </button>
        <span className="mx-0.5 h-5 w-px flex-shrink-0 self-center bg-hairline" />

        {/* Assistance ladder — signals to the tutor engine. */}
        {ASSIST.map(({ action, label }) => (
          <button
            key={action}
            disabled={busy}
            onClick={() => onAction(action)}
            className={chipCls}
          >
            {label}
          </button>
        ))}

        {/* Divider, then the two richer modes. */}
        <span className="mx-0.5 h-5 w-px flex-shrink-0 self-center bg-hairline" />
        <button disabled={busy} onClick={onCheckWork} className={chipCls}>
          Check my work
        </button>
        <button disabled={busy} onClick={onPractice} className={chipCls}>
          Practice
        </button>
      </div>

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
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
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700 active:scale-[0.98] active:bg-brand-700 disabled:bg-brand-300 disabled:text-white/90"
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
