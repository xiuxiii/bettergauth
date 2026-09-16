"use client";

import { useEffect, useRef, useState } from "react";
import { videoFrameToJpeg, fileToNormalizedJpeg } from "@/lib/image";
import { Spinner } from "@/components/States";

/**
 * In-app camera scanner. Opens a live rear-camera stream (getUserMedia),
 * frames the problem, and captures a downscaled JPEG — no OS camera hand-off,
 * so it looks and behaves like a real scanner and never returns an oversized
 * file the analyzer can't read. Falls back to a file picker when the camera
 * isn't available or permission is denied.
 */
export default function CameraScanner({
  onCapture,
  onClose,
}: {
  onCapture: (dataUrl: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"starting" | "ready" | "error">(
    "starting",
  );
  const [busy, setBusy] = useState(false);
  const [flashing, setFlashing] = useState(false);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    let cancelled = false;
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }
    start();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, []);

  function capture() {
    const v = videoRef.current;
    if (!v || !v.videoWidth || busy) return;
    setBusy(true);
    try {
      const url = videoFrameToJpeg(v);
      // Brief shutter flash before handing the frame up.
      setFlashing(true);
      window.setTimeout(() => {
        stopCamera();
        onCapture(url);
      }, 140);
    } catch {
      setBusy(false);
    }
  }

  async function onPick(file: File | undefined) {
    if (!file || busy) return;
    setBusy(true);
    try {
      const url = await fileToNormalizedJpeg(file);
      stopCamera();
      onCapture(url);
    } catch {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
      {/* live camera */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 h-full w-full object-cover"
      />

      {flashing && (
        <div className="animate-flash pointer-events-none absolute inset-0 z-30 bg-white" />
      )}

      {/* dim + framing overlay */}
      <div className="pointer-events-none absolute inset-0 flex flex-col">
        <div className="flex items-start justify-between p-4 pt-[calc(env(safe-area-inset-top,0px)+16px)]">
          <button
            onClick={onClose}
            className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full bg-black/40 backdrop-blur"
            aria-label="Close scanner"
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <span className="rounded-full bg-black/40 px-3 py-1 text-xs font-medium backdrop-blur">
            Fit the whole question in the frame
          </span>
          <span className="h-10 w-10" />
        </div>

        {/* corner brackets */}
        <div className="relative flex flex-1 items-center justify-center px-6">
          <div className="relative aspect-[3/4] w-full max-w-sm">
            <Corner className="left-0 top-0 rounded-tl-lg border-l-[3px] border-t-[3px]" />
            <Corner className="right-0 top-0 rounded-tr-lg border-r-[3px] border-t-[3px]" />
            <Corner className="bottom-0 left-0 rounded-bl-lg border-b-[3px] border-l-[3px]" />
            <Corner className="bottom-0 right-0 rounded-br-lg border-b-[3px] border-r-[3px]" />
          </div>
        </div>
      </div>

      {/* starting / error states */}
      {status !== "ready" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-black/80 px-8 text-center">
          {status === "starting" ? (
            <>
              <Spinner className="h-6 w-6" />
              <p className="text-sm text-white/80">Starting camera…</p>
            </>
          ) : (
            <>
              <p className="max-w-xs text-sm text-white/80">
                Camera isn&apos;t available — allow camera access, or pick the
                photo from your library instead.
              </p>
              <button
                onClick={() => fileRef.current?.click()}
                className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-black"
              >
                Choose from library
              </button>
              <button onClick={onClose} className="text-sm text-white/70">
                Cancel
              </button>
            </>
          )}
        </div>
      )}

      {/* shutter bar */}
      {status === "ready" && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between px-8 pb-[calc(env(safe-area-inset-bottom,0px)+28px)] pt-6">
          <button
            onClick={() => fileRef.current?.click()}
            className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/30 bg-white/10 backdrop-blur"
            aria-label="Upload from library"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 16l4-4 3 3 4-5 5 6" />
              <rect x="3" y="4" width="18" height="16" rx="2" />
            </svg>
          </button>

          <button
            onClick={capture}
            disabled={busy}
            className="flex h-[74px] w-[74px] items-center justify-center rounded-full border-[3px] border-white disabled:opacity-60"
            aria-label="Capture problem"
          >
            {busy ? (
              <Spinner className="h-7 w-7" />
            ) : (
              <span className="h-[58px] w-[58px] rounded-full bg-white" />
            )}
          </button>

          <span className="h-12 w-12" />
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onPick(e.target.files?.[0])}
      />
    </div>
  );
}

function Corner({ className }: { className: string }) {
  return (
    <span
      className={`absolute h-8 w-8 border-white/90 ${className}`}
      aria-hidden
    />
  );
}
