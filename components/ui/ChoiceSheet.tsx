"use client";

import { useEffect, useId, useRef } from "react";
import { Check } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import { useDialogFocus } from "@/components/ui/useDialogFocus";
import { DESKTOP_QUERY, useMediaQuery } from "@/components/ui/useMediaQuery";

export type Choice<T extends string> = {
  value: T;
  label: string;
  description?: string;
};

/**
 * Pick one of a longer list (Focus, Grade): a bottom sheet on phones and a
 * popover under the row from `md` up. Tapping an option selects it and closes.
 *
 * A listbox rather than a radio group: arrow keys move through the options and
 * Enter picks one, because picking closes the list. A radio group's "arrow
 * selects" would close it on the first keypress.
 *
 * Render it inside a `relative` wrapper around the row that opens it, only
 * while open; the desktop popover positions itself against that wrapper.
 */
export default function ChoiceSheet<T extends string>({
  title,
  value,
  options,
  onSelect,
  onClose,
}: {
  title: string;
  value: T;
  options: readonly Choice<T>[];
  onSelect: (next: T) => void;
  onClose: () => void;
}) {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const titleId = useId();

  if (desktop) {
    return (
      <Popover titleId={titleId} title={title} onClose={onClose}>
        <OptionList
          titleId={titleId}
          value={value}
          options={options}
          onPick={(v) => {
            onSelect(v);
            onClose();
          }}
        />
      </Popover>
    );
  }

  return (
    <Sheet
      labelledBy={titleId}
      onClose={onClose}
      initialFocus='[aria-selected="true"]'
      className="pb-[calc(env(safe-area-inset-bottom,0px)+12px)]"
      header={() => (
        <h2
          id={titleId}
          className="mb-2 px-2.5 font-serif text-lg font-normal leading-[1.15] tracking-tight text-ink"
        >
          {title}
        </h2>
      )}
    >
      {(close) => (
        <OptionList
          titleId={titleId}
          value={value}
          options={options}
          onPick={(v) => {
            onSelect(v);
            close();
          }}
        />
      )}
    </Sheet>
  );
}

function Popover({
  titleId,
  title,
  onClose,
  children,
}: {
  titleId: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, { onEscape: onClose, trap: false, initialFocus: '[aria-selected="true"]' });

  // Non-modal: a click anywhere else, or tabbing out, just closes it.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      const root = ref.current;
      // The row that opened it toggles it itself.
      const opener = root?.parentElement;
      if (root && !opener?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-labelledby={titleId}
      onBlur={(e) => {
        if (!ref.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget) onClose();
      }}
      className="absolute right-2 top-full z-30 mt-1 w-72 animate-pop-in rounded-lg border border-hairline bg-surface p-1.5 shadow-raised"
    >
      <p id={titleId} className="px-2.5 pb-1 pt-1.5 text-xs font-medium uppercase tracking-wider text-slate-500">
        {title}
      </p>
      {children}
    </div>
  );
}

function OptionList<T extends string>({
  titleId,
  value,
  options,
  onPick,
}: {
  titleId: string;
  value: T;
  options: readonly Choice<T>[];
  onPick: (v: T) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );

  function onKeyDown(e: React.KeyboardEvent, i: number) {
    const last = options.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowDown") next = i === last ? 0 : i + 1;
    else if (e.key === "ArrowUp") next = i === 0 ? last : i - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    refs.current[next]?.focus();
  }

  return (
    <div role="listbox" aria-labelledby={titleId} className="flex flex-col">
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="option"
            aria-selected={active}
            tabIndex={i === selected ? 0 : -1}
            onClick={() => onPick(o.value)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className="flex min-h-[52px] w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-slate-100 active:bg-slate-100"
          >
            <span className="min-w-0 flex-1">
              <span className={"block text-[15px] leading-5 text-ink " + (active ? "font-semibold" : "font-medium")}>
                {o.label}
              </span>
              {o.description && (
                <span className="block truncate text-sm leading-5 text-slate-500">{o.description}</span>
              )}
            </span>
            <Check
              size={18}
              strokeWidth={2}
              aria-hidden="true"
              className={"flex-shrink-0 text-brand-700 " + (active ? "" : "invisible")}
            />
          </button>
        );
      })}
    </div>
  );
}
