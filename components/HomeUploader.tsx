"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IMAGE_KEY, QUESTION_KEY, WORK_HINT_KEY } from "@/lib/utils";
import type { NormalizedRect } from "@/lib/tutor/types";
import { cropSourceToJpeg, fileToNormalizedJpeg } from "@/lib/image";
import { hasPreferences } from "@/lib/preferences";
import { Camera, Clock, MessageCircleQuestion, Upload } from "lucide-react";
import { ErrorState, Spinner } from "@/components/States";
import CameraScanner from "@/components/CameraScanner";
import QuestionCropper from "@/components/QuestionCropper";

/**
 * Home entry point: "Take a photo" opens the in-app camera scanner (a live
 * viewfinder with framing, not the OS camera), and "Upload problem" picks from
 * the library. Both normalize to a right-sized, upright JPEG, then open the
 * question cropper (find the questions on the page, pick/adjust one, choose a
 * subject). The confirmed crop is stashed in sessionStorage and we route to
 * the workspace where the existing analysis begins.
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
  /**
   * Which button opened the capture. "ask" is Ask mode: frame something and
   * ask a question about it, rather than have the work diagnosed.
   */
  const [mode, setMode] = useState<"diagnose" | "ask">("diagnose");

  // First-run gate: send new visitors through the welcome tour once.
  useEffect(() => {
    if (!hasPreferences()) router.replace("/welcome");
  }, [router]);

  /** Hand the confirmed crop to the workspace. */
  function go(dataUrl: string, question?: string, workLikely = false) {
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
          setMode("diagnose");
          setScanning(true);
        }}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-5 text-base font-semibold text-white shadow-raised transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep disabled:bg-brand-300 disabled:text-white/90 disabled:shadow-none"
      >
        {busy ? (
          <Spinner className="h-5 w-5" />
        ) : (
          <Camera size={18} strokeWidth={1.75} aria-hidden="true" />
        )}
        Take a photo
      </button>

      <button
        disabled={busy}
        onClick={() => {
          setMode("diagnose");
          uploadRef.current?.click();
        }}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-surface px-5 text-base font-semibold text-slate-800 transition hover:bg-slate-100 active:scale-[0.98] disabled:opacity-60"
      >
        <Upload size={18} strokeWidth={1.75} aria-hidden="true" />
        Upload problem
      </button>

      {/* Ask mode. Opens the same camera, which already falls back to a file
          picker when the camera is unavailable or refused. */}
      <button
        disabled={busy}
        onClick={() => {
          setError(null);
          setMode("ask");
          setScanning(true);
        }}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-surface px-5 text-base font-semibold text-slate-800 transition hover:bg-slate-100 active:scale-[0.98] disabled:opacity-60"
      >
        <MessageCircleQuestion size={18} strokeWidth={1.75} aria-hidden="true" />
        Ask about a photo
      </button>

      <Link
        href="/history"
        className="flex h-11 items-center justify-center gap-2 rounded-md text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-ink"
      >
        <Clock size={16} strokeWidth={1.75} aria-hidden="true" />
        Your history
      </Link>

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
          mode={mode}
          onCancel={() => {
            setPending(null);
            setSource(null);
          }}
          // "Question not detected" → straight back to the camera in the same
          // mode, rather than dumping them on the home screen to start over.
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
