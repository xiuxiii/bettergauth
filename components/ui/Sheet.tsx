"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useDialogFocus } from "@/components/ui/useDialogFocus";

const CLOSE_MS = 180;
/** Drag past this (px), or flick faster than DRAG_VELOCITY (px/ms) for at
 * least DRAG_FLICK_MIN_PX, dismisses. */
const DRAG_DISMISS_PX = 80;
const DRAG_VELOCITY = 0.5;
const DRAG_FLICK_MIN_PX = 24;

/**
 * The bottom sheet: a backdrop, a panel that rises from the bottom edge, and a
 * handle + header row that can be dragged down to dismiss. Escape, the
 * backdrop and a drag all close it with the same slide-down; focus is kept
 * inside while it's open and handed back to the opener when it closes.
 *
 * `header` and `children` are render functions that receive `close`, so a
 * Cancel button runs the slide-down instead of vanishing the sheet mid-frame.
 * `onClose` fires once the slide has finished.
 */
export default function Sheet({
  labelledBy,
  onClose,
  header,
  children,
  initialFocus,
  className = "",
}: {
  labelledBy: string;
  onClose: () => void;
  header: (close: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  /** A selector inside the sheet to focus when it opens. */
  initialFocus?: string;
  /** Extra classes for the panel (padding, height). */
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startY: number; startT: number } | null>(null);
  // Mirrors dragY so a fast flick (several touch events before a re-render)
  // still reads the latest offset at touchend.
  const dragYRef = useRef(0);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  function close() {
    if (closing) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      onClose();
      return;
    }
    setDragY(0); // drop any inline drag offset so the slide-down class applies
    setClosing(true);
    closeTimer.current = window.setTimeout(onClose, CLOSE_MS);
  }

  useDialogFocus(panelRef, { onEscape: close, initialFocus });

  function onDragStart(e: React.TouchEvent) {
    if (closing) return;
    drag.current = { startY: e.touches[0].clientY, startT: performance.now() };
    setDragging(true);
  }
  function onDragMove(e: React.TouchEvent) {
    if (!drag.current) return;
    const y = Math.max(0, e.touches[0].clientY - drag.current.startY);
    dragYRef.current = y;
    setDragY(y);
  }
  function onDragEnd() {
    if (!drag.current) return;
    const y = dragYRef.current;
    const elapsed = Math.max(1, performance.now() - drag.current.startT);
    const velocity = y / elapsed;
    drag.current = null;
    dragYRef.current = 0;
    setDragging(false);
    if (y > DRAG_DISMISS_PX || (y > DRAG_FLICK_MIN_PX && velocity > DRAG_VELOCITY)) {
      close();
    } else {
      setDragY(0); // spring back
    }
  }

  // While dragging, the sheet follows the finger with no transition; on release
  // it either springs back or runs the close slide. `animate-rise` stays on the
  // element throughout (toggling it would replay the open animation); its
  // `backwards` fill means the inline transform takes over once it has run.
  const sheetMotion = closing
    ? "translate-y-full transition-transform duration-200 ease-out"
    : dragging
      ? "animate-rise"
      : "animate-rise transition-transform duration-200 ease-out";

  return (
    // h-dvh (not inset-0) so the sheet tracks the visual viewport on iOS.
    <div className="fixed inset-x-0 top-0 z-40 flex h-dvh items-end justify-center">
      {/* Backdrop: a pointer target. Keyboard users close with Escape or the
          sheet's own buttons, so it stays out of the tab order. */}
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        onClick={close}
        className={`absolute inset-0 bg-slate-900/40 dark:bg-black/60 ${
          closing ? "opacity-0 transition-opacity duration-200" : "animate-fade-in"
        }`}
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        style={dragging || dragY ? { transform: `translateY(${dragY}px)` } : undefined}
        className={`relative mx-auto flex max-h-[85dvh] w-full max-w-md flex-col overflow-y-auto overscroll-contain rounded-t-xl bg-surface p-4 shadow-sheet outline-none ${sheetMotion} ${className}`}
      >
        {/* Drag region: the handle and the header row. */}
        <div
          className="-mx-4 -mt-4 touch-none select-none px-4 pt-4"
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
          onTouchCancel={onDragEnd}
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />
          {header(close)}
        </div>
        {children(close)}
      </div>
    </div>
  );
}
