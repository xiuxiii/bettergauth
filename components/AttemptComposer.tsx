"use client";

import { useRef, useState } from "react";
import type { StudentAttempt } from "@/lib/tutor/types";
import { fileToDataUrl } from "@/lib/utils";
import { Spinner } from "@/components/States";

/**
 * Bottom-sheet composer for "Check My Work". The student types their working
 * and/or attaches a photo of it, then submits for diagnosis. At least one of the
 * two must be provided.
 */
export default function AttemptComposer({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (attempt: StudentAttempt) => void;
  onCancel: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  const canSubmit = (text.trim().length > 0 || !!image) && !busy;

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
        onClick={onCancel}
        className="absolute inset-0 bg-slate-900/40"
      />

      {/* Sheet */}
      <div className="relative mx-auto w-full max-w-md rounded-t-3xl bg-white p-4 shadow-2xl">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-200" />
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Check my work</h2>
          <button
            onClick={onCancel}
            className="rounded-full px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
        <p className="mb-3 text-sm text-slate-500">
          Type your solution or attach a photo — I&apos;ll find the first thing
          worth fixing.
        </p>

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
          className="w-full resize-none rounded-2xl border border-slate-300 px-3.5 py-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
        />

        {image ? (
          <div className="mt-2 flex items-center gap-3 rounded-xl border border-slate-200 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={image}
              alt="Your attempt"
              className="h-14 w-14 rounded-lg bg-slate-100 object-cover"
            />
            <span className="flex-1 text-sm text-slate-600">Photo attached</span>
            <button
              onClick={() => setImage(null)}
              className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
            >
              Remove
            </button>
          </div>
        ) : (
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-brand-400 hover:text-brand-700"
          >
            <PhotoIcon />
            Attach a photo of your work
          </button>
        )}

        {readError && <p className="mt-2 text-sm text-rose-600">{readError}</p>}

        <button
          onClick={submit}
          disabled={!canSubmit}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.99] disabled:opacity-50"
        >
          {busy ? <Spinner className="h-5 w-5" /> : null}
          Check it
        </button>
      </div>
    </div>
  );
}

function PhotoIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="5" width="18" height="14" rx="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 16l-5-5-4 4-2-2-7 7" />
    </svg>
  );
}
