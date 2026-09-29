"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const opener = document.activeElement as HTMLElement | null;

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
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
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
