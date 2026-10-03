"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

// What Tab can land on. tabindex="-1" is excluded from every kind, not only
// from bare [tabindex]: a listbox's unselected options are buttons with
// tabindex -1, and counting them made the trap's "last" one Tab never reaches,
// so Tab walked out of a modal sheet (and Escape went with it).
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[tabindex]",
]
  .map((s) => `${s}:not([tabindex="-1"]):not([hidden])`)
  .join(", ");

/**
 * Focus handling for a sheet or popover:
 *   - on open, focus moves inside (to `initialFocus` if given, else the first
 *     focusable element), unless something inside already took it (autoFocus);
 *   - Tab and Shift+Tab cycle within it when `trap` is set;
 *   - Escape calls `onEscape`;
 *   - on close, focus goes back to whatever had it before, so a keyboard user
 *     lands on the row that opened the sheet rather than at the top of the page.
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  {
    onEscape,
    trap = true,
    initialFocus,
  }: {
    onEscape: () => void;
    trap?: boolean;
    /** A selector inside the dialog to focus first. */
    initialFocus?: string;
  },
) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  // The opener is read during the first render, not in the effect below: by
  // the time effects run, an autoFocus inside the dialog (the composer's
  // textarea) has already taken focus, so the "opener" found there was that
  // textarea, gone by the time the sheet closed.
  const [opener] = useState(() =>
    typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null,
  );

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    if (!root.contains(document.activeElement)) {
      const first =
        (initialFocus && root.querySelector<HTMLElement>(initialFocus)) ||
        root.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? root).focus({ preventScroll: true });
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (!trap || e.key !== "Tab" || !root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const at = items.indexOf(document.activeElement as HTMLElement);
      // at === -1: focus is on the panel itself or on an option reached with
      // the arrow keys (tabindex -1), from where the browser's own Tab could
      // step outside.
      if (e.shiftKey && at <= 0) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (at === -1 || at === items.length - 1)) {
        e.preventDefault();
        first.focus();
      }
    }

    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
      // Still in the document: React StrictMode's rehearsal unmount in dev,
      // not a close. Handing focus back here would blur the dialog and close
      // a popover the moment it opened.
      if (root.isConnected) return;
      // Only when focus was still inside (or fell to <body> as the dialog was
      // removed): someone who tabbed out of a popover has moved on.
      const now = document.activeElement;
      const lost = !now || now === document.body || root.contains(now);
      if (lost && opener && opener.isConnected && opener !== document.body) {
        opener.focus({ preventScroll: true });
      }
    };
    // Runs once per open: the dialog mounts when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
