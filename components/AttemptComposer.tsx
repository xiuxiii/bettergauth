"use client";

import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import type { StudentAttempt } from "@/lib/tutor/types";
import { fileToNormalizedJpeg } from "@/lib/image";
import { Spinner } from "@/components/States";
import RichText from "@/components/RichText";
import Sheet from "@/components/ui/Sheet";

/**
 * Bottom-sheet composer for "Check My Work". The student photographs their
 * working and submits it for diagnosis.
 *
 * A full attempt is photo only, deliberately. Nobody types out physics working
 * on a phone — it means transcribing square roots, fractions and exponents
 * into a plain textarea, which is slower than redoing the problem.
 *
 * A RETRY of one flagged step is the exception: that is a single line, short
 * enough to type, and making someone rephotograph a page to fix one line is
 * the slower path. So the retry sheet offers a text field as well.
 */
export default function AttemptComposer({
  busy,
  onSubmit,
  onCancel,
  retry,
}: {
  busy: boolean;
  onSubmit: (attempt: StudentAttempt) => void;
  onCancel: () => void;
  /** Set when retrying the step a check flagged. */
  retry?: { line: string; locate: string };
}) {
  const copy = retry
    ? {
        title: "Try that step again",
        hint: "Type the step again, or snap a photo of your new working.",
        submit: "Check it",
      }
    : {
        title: "Check my work",
        hint: "Snap your working and your answer — I'll find the first thing worth fixing.",
        submit: "Check it",
      };
  const fileRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [readError, setReadError] = useState<string | null>(null);

  const canSubmit = (!!image || (!!retry && !!text.trim())) && !busy;

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
    onSubmit({
      text: retry && text.trim() ? text.trim() : undefined,
      imageDataUrl: image ?? undefined,
    });
  }

  return (
    <Sheet
      labelledBy="attempt-composer-title"
      onClose={onCancel}
      header={(close) => (
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
      )}
    >
      {() => (
        <>
          <p className="mb-3 text-sm text-slate-500">{copy.hint}</p>

          {retry && (
            <>
              {(retry.line || retry.locate) && (
                <div className="mb-3 rounded-sm border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {retry.line ? <RichText text={retry.line} /> : <RichText text={retry.locate} />}
                </div>
              )}
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                autoFocus
                aria-label="Your new step"
                placeholder="Your new step…"
                className="mb-3 w-full resize-none rounded-md border border-slate-300 bg-surface px-3.5 py-2 text-base leading-6 text-ink outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              />
            </>
          )}

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
            /* For a full check this is the only way in, so it is sized and
               coloured like the action it is. On a retry the typed line above
               leads, and the photo is the alternative. */
            <button
              onClick={() => fileRef.current?.click()}
              className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-brand-300 bg-brand-50 px-4 text-brand-800 transition hover:border-brand-400 hover:bg-brand-100 ${retry ? "py-4" : "py-7"}`}
            >
              <ImagePlus size={retry ? 22 : 26} strokeWidth={1.5} aria-hidden="true" />
              <span className="text-base font-semibold">
                {retry ? "Or attach a photo" : "Attach a photo of your work"}
              </span>
              {!retry && (
                <span className="text-xs text-brand-700">Your working and your final answer</span>
              )}
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
        </>
      )}
    </Sheet>
  );
}
