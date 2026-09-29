"use client";

import { useRef } from "react";
import type { LucideIcon } from "lucide-react";

export type Segment<T extends string> = {
  value: T;
  label: string;
  icon?: LucideIcon;
};

/**
 * A pill track of 2–3 equal-width segments, one of them selected: the radio
 * group for small, mutually exclusive choices (Hints first · Direct).
 *
 * Radio semantics: one tab stop for the group (the selected segment), and the
 * arrow keys move the selection, as they do in a native radio group. The thumb
 * is solid surface, not a brand fill, so it reads the same in both themes; in
 * dark mode surface is darker than the track, so the thumb steps up a shade to
 * stay raised.
 */
export default function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  labelledBy,
  label,
  disabled,
  className = "",
}: {
  /** May match no option (e.g. nothing chosen yet): then none is selected. */
  value: T | null;
  onChange: (next: T) => void;
  options: readonly Segment<T>[];
  /** id of the visible label, when there is one. */
  labelledBy?: string;
  /** Accessible name when there is no visible label. */
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = options.findIndex((o) => o.value === value);
  // With nothing selected the first segment is the group's tab stop.
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const last = options.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
    onChange(options[next].value);
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      aria-disabled={disabled || undefined}
      className={`grid auto-cols-fr grid-flow-col rounded-full bg-slate-100 p-0.5 ${className}`}
    >
      {options.map((o, i) => {
        const active = i === selectedIndex;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={i === tabStop ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={
              "flex h-11 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-sm font-medium transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 " +
              (active
                ? "bg-surface text-ink shadow-card dark:bg-slate-200"
                : "text-slate-600 hover:text-ink")
            }
          >
            {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden="true" />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
