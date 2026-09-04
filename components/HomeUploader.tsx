"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fileToDataUrl, IMAGE_KEY } from "@/lib/utils";
import { ErrorState, Spinner } from "@/components/States";

/**
 * Home entry point: "Take a photo" (camera capture on mobile) and
 * "Upload problem". Both read the image to a data URL, stash it in
 * sessionStorage, and route to the workspace where analysis begins.
 */
export default function HomeUploader() {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (a photo of the problem).");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      sessionStorage.setItem(IMAGE_KEY, dataUrl);
      router.push("/workspace");
    } catch {
      setError("Could not read that image. Please try another photo.");
      setBusy(false);
    }
  }

  return (
    <div className="w-full space-y-4">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      <button
        disabled={busy}
        onClick={() => cameraRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-600 px-5 py-4 text-base font-semibold text-white shadow-sm transition hover:bg-brand-700 active:scale-[0.99] disabled:opacity-60"
      >
        {busy ? <Spinner className="h-5 w-5" /> : <CameraIcon />}
        Take a photo
      </button>

      <button
        disabled={busy}
        onClick={() => uploadRef.current?.click()}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-5 py-4 text-base font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 active:scale-[0.99] disabled:opacity-60"
      >
        <UploadIcon />
        Upload problem
      </button>

      {error && <ErrorState message={error} />}
    </div>
  );
}

function CameraIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 7l1.2-2h8.6l1.2 2H20a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1h2.5z" />
      <circle cx="12" cy="13" r="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 17v2a1 1 0 001 1h14a1 1 0 001-1v-2" />
    </svg>
  );
}
