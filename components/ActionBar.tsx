"use client";

import { useState } from "react";
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
  "whitespace-nowrap rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-brand-400 hover:text-brand-700 disabled:opacity-50";

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
  onCheckWork,
  onPractice,
}: {
  busy: boolean;
  onAction: (action: Exclude<TutorAction, "ask">) => void;
  onAsk: (text: string) => void;
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
    <div className="border-t border-slate-200 bg-white/95 px-3 pb-3 pt-2 backdrop-blur">
      <div className="mb-2 flex items-center gap-2 overflow-x-auto pb-1">
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
        <span className="mx-0.5 h-5 w-px flex-shrink-0 self-center bg-slate-200" />
        <button disabled={busy} onClick={onCheckWork} className={chipCls}>
          Check my work
        </button>
        <button disabled={busy} onClick={onPractice} className={chipCls}>
          Practice
        </button>
      </div>

      <div className="flex items-end gap-2">
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
          className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl border border-slate-300 px-3.5 py-2.5 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />
        <button
          onClick={submit}
          disabled={busy || !text.trim()}
          aria-label="Send"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-40"
        >
          {busy ? (
            <Spinner className="h-5 w-5" />
          ) : (
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
