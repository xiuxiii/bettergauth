"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import type { StudentAttempt } from "@/lib/tutor/types";
import { fileToDataUrl } from "@/lib/utils";
import { Spinner } from "@/components/States";

const CLOSE_MS = 180;

/**
 * Bottom-sheet composer for "Check My Work". The student types their working
 * and/or attaches a photo of it, then submits for diagnosis. At least one of the
 * two must be provided.
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
          hint: "Type your solution or attach a photo — I'll find the first thing worth fixing.",
          submit: "Check it",
        };
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  // Visual only: the sheet slides down and the backdrop fades before unmount.
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    };
  }, []);

  const canSubmit = (text.trim().length > 0 || !!image) && !busy;

  function close() {
    if (closing) return;
    setClosing(true);
    closeTimer.current = window.setTimeout(onCancel, CLOSE_MS);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setReadError("Please choose an image of your work.");
      return;
    }
    setReadError(null);
    try {
      setImage(await fileToDataUrl(file));
    } catch {
      setReadError("Could not read that image. Try another photo.");
    }
  }

  function submit() {
    if (!canSubmit) return;
    onSubmit({
      text: text.trim() || undefined,
      imageDataUrl: image ?? undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center">
      {/* Backdrop */}
      <button
        aria-label="Close"
        onClick={close}
        className={`absolute inset-0 bg-slate-900/40 dark:bg-black/60 ${
          closing ? "animate-fade-out" : "animate-fade-in"
        }`}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="attempt-composer-title"
        className={`relative mx-auto w-full max-w-md rounded-t-xl bg-surface p-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)] shadow-sheet ${
          closing
            ? "translate-y-full transition-transform duration-[180ms] ease-out"
            : "animate-rise"
        }`}
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
            className="h-9 rounded-md px-3 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-ink"
          >
            Cancel
          </button>
        </div>
        <p className="mb-3 text-sm text-slate-500">{copy.hint}</p>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          autoFocus
          placeholder={"e.g. mgh = ½mv², so v = √(2·9.8·1.5) = 5.9 m/s"}
          className="w-full resize-none rounded-md border border-slate-300 bg-surface px-3.5 py-2.5 text-base leading-6 text-ink outline-none transition placeholder:text-slate-400 focus:border-slate-300"
        />

        {image ? (
          <div className="mt-2 flex items-center gap-3 rounded-sm bg-slate-100 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt="Your attempt"
              className="h-14 w-14 rounded-sm bg-slate-200 object-cover"
            />
            <span className="flex-1 text-sm text-slate-600">Photo attached</span>
            <button
              onClick={() => setImage(null)}
              className="h-9 rounded-md px-3 text-sm text-slate-500 transition hover:bg-slate-200 hover:text-ink"
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-4 text-sm font-medium text-slate-600 transition hover:border-brand-400 hover:text-brand-700"
          >
            <ImagePlus size={18} strokeWidth={1.75} aria-hidden="true" />
            Attach a photo of your work
          </button>
        )}

        {readError && <p className="mt-2 text-sm text-danger-600">{readError}</p>}

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-5 text-base font-semibold text-white shadow-raised transition hover:bg-brand-700 active:scale-[0.98] active:bg-brand-700 disabled:bg-brand-300 disabled:text-white/90 disabled:shadow-none"
        >
          {busy ? <Spinner className="h-5 w-5" /> : null}
          {copy.submit}
        </button>
      </div>
    </div>
  );
}
