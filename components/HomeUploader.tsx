"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { IMAGE_KEY } from "@/lib/utils";
import { fileToNormalizedJpeg } from "@/lib/image";
import { hasPreferences } from "@/lib/preferences";
import { Camera, Upload } from "lucide-react";
import { ErrorState, Spinner } from "@/components/States";
import CameraScanner from "@/components/CameraScanner";

/**
 * Home entry point: "Take a photo" opens the in-app camera scanner (a live
 * viewfinder with framing, not the OS camera), and "Upload problem" picks from
 * the library. Both normalize to a right-sized, upright JPEG, stash it in
 * sessionStorage, and route to the workspace where analysis begins.
 * On first run (no saved preferences) it redirects to /setup.
 */
export default function HomeUploader() {
  const router = useRouter();
  const uploadRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // First-run gate: send new visitors through setup once.
  useEffect(() => {
    if (!hasPreferences()) router.replace("/setup");
  }, [router]);

  function go(dataUrl: string) {
    sessionStorage.setItem(IMAGE_KEY, dataUrl);
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
      go(await fileToNormalizedJpeg(file));
    } catch {
      setError("Could not read that image. Please try another photo.");
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
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      <button
        disabled={busy}
        onClick={() => {
          setError(null);
          setScanning(true);
        }}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-5 text-base font-semibold text-white shadow-raised transition hover:bg-brand-700 active:scale-[0.98] active:bg-brand-700 disabled:bg-brand-300 disabled:text-white/90 disabled:shadow-none"
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
        onClick={() => uploadRef.current?.click()}
        className="flex h-14 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-surface px-5 text-base font-semibold text-slate-800 transition hover:bg-slate-100 active:scale-[0.98] disabled:opacity-60"
      >
        <Upload size={18} strokeWidth={1.75} aria-hidden="true" />
        Upload problem
      </button>

      {error && <ErrorState message={error} />}

      {scanning && (
        <CameraScanner
          onClose={() => setScanning(false)}
          onCapture={(dataUrl) => {
            setScanning(false);
            setBusy(true);
            go(dataUrl);
          }}
        />
      )}
    </div>
  );
}
