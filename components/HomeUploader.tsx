"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IMAGE_KEY, QUESTION_KEY, TEXT_KEY, WORK_HINT_KEY } from "@/lib/utils";
import type { NormalizedRect } from "@/lib/tutor/types";
import { cropSourceToJpeg, fileToNormalizedJpeg } from "@/lib/image";
import { hasPreferences } from "@/lib/preferences";
import { ArrowRight, Camera, Upload } from "lucide-react";
import { ErrorState, Spinner } from "@/components/States";
import CameraScanner from "@/components/CameraScanner";
import QuestionCropper from "@/components/QuestionCropper";

/**
 * Home entry point. One primary action, "Snap a problem", opens the in-app
 * camera scanner (a live viewfinder with framing, not the OS camera). Upload
 * picks from the library. Both normalize to a right-sized, upright JPEG, then
 * open the question cropper, where the student picks the question and can
 * switch on Ask mode. The confirmed crop is stashed in sessionStorage and we
 * route to the workspace where the analysis begins.
 *
 * A problem can also be typed or pasted, for the one already on screen in
 * another app, or a teacher's message.
 *
 * On first run (no saved preferences) it redirects to the /welcome tour.
 */
export default function HomeUploader() {
  const router = useRouter();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  /** A normalized photo waiting in the cropper for the student to confirm. */
  const [pending, setPending] = useState<string | null>(null);
  /**
   * The ORIGINAL capture behind that preview, kept so the confirmed crop can be
   * cut from full resolution. Cropping `pending` instead would hand the model a
   * question at roughly half the linear detail, which is most of why handwriting
   * read badly. A File is just a handle here, decoded once at confirm.
   */
  const [source, setSource] = useState<File | string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  // First-run gate: send new visitors through the welcome tour once.
  useEffect(() => {
    if (!hasPreferences()) router.replace("/welcome");
  }, [router]);

  /** Hand the confirmed crop to the workspace. */
  function go(dataUrl: string, question?: string, workLikely = false) {
    sessionStorage.removeItem(TEXT_KEY);
    sessionStorage.setItem(IMAGE_KEY, dataUrl);
    if (workLikely) sessionStorage.setItem(WORK_HINT_KEY, "1");
    else sessionStorage.removeItem(WORK_HINT_KEY);
    // Always written or cleared together with the image, so a question from an
    // earlier Ask can never ride along with a later ordinary capture.
    if (question) sessionStorage.setItem(QUESTION_KEY, question);
    else sessionStorage.removeItem(QUESTION_KEY);
    setBusy(true);
    router.push("/workspace");
  }

  /**
   * Apply the region the student chose to the full-resolution original.
   * Falls back to the preview if the original somehow isn't around, so a
   * confirm can never dead-end.
   */
  async function confirmCrop(
    rect: NormalizedRect,
    question?: string,
    workLikely = false,
  ) {
    const preview = pending;
    if (!preview) return;
    setBusy(true);
    try {
      go(await cropSourceToJpeg(source ?? preview, rect), question, workLikely);
      setPending(null);
      setSource(null);
    } catch {
      setBusy(false);
      setError("Could not crop that photo. Please try again.");
    }
  }

  /** Hand a typed or pasted problem to the workspace, with no photo. */
  function goText() {
    const text = typed.trim();
    if (!text || busy) return;
    try {
      sessionStorage.removeItem(IMAGE_KEY);
      sessionStorage.removeItem(QUESTION_KEY);
      sessionStorage.removeItem(WORK_HINT_KEY);
      sessionStorage.setItem(TEXT_KEY, text);
    } catch {
      setError("Could not start that problem. Please try again.");
      return;
    }
    setBusy(true);
    router.push("/workspace");
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (a photo of the problem).");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      setPending(await fileToNormalizedJpeg(file));
      setSource(file);
    } catch {
      setError("Could not read that image. Please try another photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="w-full space-y-4">
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = ""; // allow re-picking the same file after Cancel
        }}
      />

      <button
        disabled={busy}
        onClick={() => {
          setError(null);
          setScanning(true);
        }}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-5 text-base font-semibold text-white shadow-raised transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep disabled:bg-brand-300 disabled:text-white/90 disabled:shadow-none"
      >
        {busy ? (
          <Spinner className="h-5 w-5" />
        ) : (
          <Camera size={18} strokeWidth={1.75} aria-hidden="true" />
        )}
        Snap a problem
      </button>

      <button
        disabled={busy}
        onClick={() => uploadRef.current?.click()}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-surface px-5 text-[15px] font-semibold text-slate-800 transition hover:bg-slate-100 active:scale-[0.98] disabled:opacity-60"
      >
        <Upload size={18} strokeWidth={1.75} aria-hidden="true" />
        Upload a photo
      </button>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          goText();
        }}
        className="relative"
      >
        <textarea
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              goText();
            }
          }}
          rows={2}
          maxLength={4000}
          aria-label="Type or paste a problem"
          placeholder="Or type or paste a problem…"
          className="block w-full resize-none rounded-md border border-slate-300 bg-surface py-2.5 pl-3.5 pr-14 text-base leading-6 text-ink outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
        />
        <button
          type="submit"
          disabled={busy || !typed.trim()}
          aria-label="Start this problem"
          className="absolute bottom-2 right-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep disabled:bg-brand-300 disabled:text-white/90"
        >
          <ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </form>

      {error && <ErrorState message={error} />}

      {scanning && (
        <CameraScanner
          onClose={() => setScanning(false)}
          onCapture={(file) => {
            // A scan is now a File at the device's full still resolution, so it
            // takes the identical path to an uploaded photo: downscaled preview
            // for the cropper, original kept as the crop source.
            setScanning(false);
            void handleFile(file);
          }}
        />
      )}

      {pending && (
        <QuestionCropper
          image={pending}
          onCancel={() => {
            setPending(null);
            setSource(null);
          }}
          // "Question not detected" → straight back to the camera, rather
          // than dumping them on the home screen to start over.
          onRetake={() => {
            setPending(null);
            setSource(null);
            setScanning(true);
          }}
          onConfirm={({ rect, question, workLikely }) =>
            void confirmCrop(rect, question, workLikely)
          }
        />
      )}
    </div>
  );
}
