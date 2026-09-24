"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import type { StudentAttempt } from "@/lib/tutor/types";
import { fileToNormalizedJpeg } from "@/lib/image";
import { Spinner } from "@/components/States";

const CLOSE_MS = 180;
/** Drag past this (px), or flick faster than DRAG_VELOCITY (px/ms) for at
 * least DRAG_FLICK_MIN_PX, dismisses. */
const DRAG_DISMISS_PX = 80;
const DRAG_VELOCITY = 0.5;
const DRAG_FLICK_MIN_PX = 24;

/**
 * Bottom-sheet composer for "Check My Work". The student photographs their
 * working and submits it for diagnosis.
 *
 * Photo only, deliberately. Nobody types out physics working on a phone — it
 * means transcribing square roots, fractions and exponents into a plain
 * textarea, which is slower than redoing the problem. The typed field went
 * unused, and offering it as the first and largest control implied it was the
 * expected path.
 */
export default function AttemptComposer({
  busy,
  onSubmit,
  onCancel,
  mode = "check",
}: {
  busy: boolean;
  onSubmit: (attempt: StudentAttempt) => void;
  onCancel: () => void;
  /** "why" reframes the sheet toward diagnosing the student's reasoning. */
  mode?: "check" | "why";
}) {
  const copy =
    mode === "why"
      ? {
          title: "Why am I wrong?",
          hint: "Show me your working and your answer — I'll trace your reasoning and find the exact step where it goes wrong.",
          submit: "Find the gap",
        }
      : {
          title: "Check my work",
          hint: "Snap your working and your answer — I'll find the first thing worth fixing.",
          submit: "Check it",
        };
  const fileRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  // Visual only: the sheet slides down and the backdrop fades before unmount,
  // and the handle / title row can be dragged down to dismiss.
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

  const canSubmit = !!image && !busy;

  function close() {
    if (closing) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      onCancel();
      return;
    }
    setDragY(0); // drop any inline drag offset so the slide-down class applies
    setClosing(true);
    closeTimer.current = window.setTimeout(onCancel, CLOSE_MS);
  }

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

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setReadError("Please choose an image of your work.");
      return;
    }
    setReadError(null);
    try {
      // Downscale + EXIF-upright, exactly like the capture path. A raw phone
      // photo as a data URL is several MB of base64 and blew past the platform
      // request limit, which came back as a 413 the client couldn't parse.
      setImage(await fileToNormalizedJpeg(file));
    } catch {
      setReadError("Could not read that image. Try another photo.");
    }
  }

  function submit() {
    if (!canSubmit) return;
    onSubmit({ imageDataUrl: image ?? undefined });
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
    <div className="fixed inset-x-0 top-0 z-20 flex h-dvh items-end justify-center">
      {/* Backdrop */}
      <button
        aria-label="Close"
        onClick={close}
        className={`absolute inset-0 bg-slate-900/40 dark:bg-black/60 ${
          closing ? "opacity-0 transition-opacity duration-200" : "animate-fade-in"
        }`}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="attempt-composer-title"
        style={dragging || dragY ? { transform: `translateY(${dragY}px)` } : undefined}
        className={`relative mx-auto flex max-h-[85dvh] w-full max-w-md flex-col overflow-y-auto overscroll-contain rounded-t-xl bg-surface p-4 shadow-sheet ${sheetMotion}`}
      >
        {/* Drag region: the handle and the title row. */}
        <div
          className="-mx-4 -mt-4 touch-none select-none px-4 pt-4"
          onTouchStart={onDragStart}
          onTouchMove={onDragMove}
          onTouchEnd={onDragEnd}
          onTouchCancel={onDragEnd}
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />
          <div className="mb-1 flex items-center justify-between">
            <h2
              id="attempt-composer-title"
              className="font-serif text-lg font-normal leading-[1.15] tracking-tight text-ink"
            >
              {copy.title}
            </h2>
            <button
              onClick={close}
              className="h-10 rounded-md px-3 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
        <p className="mb-3 text-sm text-slate-500">{copy.hint}</p>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        {image ? (
          <div className="rounded-md border border-hairline bg-paper p-2">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image}
                alt="Your attempt"
                className="h-20 w-20 rounded-sm bg-slate-200 object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">Photo attached</p>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="mt-0.5 h-8 text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
                >
                  Retake
                </button>
              </div>
              <button
                onClick={() => setImage(null)}
                className="h-10 rounded-md px-3 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-ink"
              >
                Remove
              </button>
            </div>
          </div>
        ) : (
          /* The only way in, so it is sized and coloured like the action it is
             rather than the dashed afterthought it used to be next to a
             textarea. */
          <button
            onClick={() => fileRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-brand-300 bg-brand-50 px-4 py-7 text-brand-800 transition hover:border-brand-400 hover:bg-brand-100"
          >
            <ImagePlus size={26} strokeWidth={1.5} aria-hidden="true" />
            <span className="text-base font-semibold">Attach a photo of your work</span>
            <span className="text-xs text-brand-700">Your working and your final answer</span>
          </button>
        )}

        {readError && <p className="mt-2 text-sm text-danger-600">{readError}</p>}

        {/* Sticky footer: the primary action stays visible however tall the
            sheet body gets, and clears the home indicator. */}
        <div className="sticky bottom-0 -mx-4 -mb-4 mt-3 bg-surface px-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] pt-3">
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-5 text-base font-semibold text-white shadow-raised transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep disabled:cursor-not-allowed disabled:bg-brand-300 disabled:text-white/90 disabled:opacity-45 disabled:shadow-none"
          >
            {busy ? <Spinner className="h-5 w-5" /> : null}
            {copy.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
