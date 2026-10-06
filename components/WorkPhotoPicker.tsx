"use client";

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { fileToNormalizedJpeg } from "@/lib/image";
import CameraScanner from "@/components/CameraScanner";

/**
 * The photo of a student's working, for Check my work and practice answers.
 *
 * Taking the photo opens MindGap's own camera (CameraScanner), not the
 * phone's: a bare file input's "Camera" option hands off to the phone's camera
 * app, which feels like leaving MindGap and, on Android, saves a copy to the
 * gallery. The file input stays for a photo already on the phone.
 */
export default function WorkPhotoPicker({
  image,
  onChange,
  secondary = false,
}: {
  /** The normalized photo as a data URL, or null. */
  image: string | null;
  onChange: (image: string | null) => void;
  /** Not the main way in (a retry, where the typed line leads): a smaller tile. */
  secondary?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const retakeRef = useRef<HTMLButtonElement>(null);
  const focusRetake = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  async function acceptFile(file: File | undefined) {
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
      onChange(await fileToNormalizedJpeg(file));
    } catch {
      setReadError("Could not read that image. Try another photo.");
    }
  }

  function openCamera() {
    opener.current = document.activeElement as HTMLElement | null;
    setScanning(true);
  }

  // After a capture the tile that opened the camera is gone; Retake takes its
  // place, so focus goes there rather than falling to <body>.
  useEffect(() => {
    if (image && focusRetake.current) {
      focusRetake.current = false;
      retakeRef.current?.focus();
    }
  }, [image]);

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void acceptFile(e.target.files?.[0]);
          e.target.value = ""; // allow picking the same photo again
        }}
      />

      {image ? (
        <div className="flex items-center gap-3 rounded-md border border-hairline bg-surface p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt="Your work"
            className="h-16 w-16 rounded-sm bg-slate-200 object-cover"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">Photo attached</p>
            <button
              ref={retakeRef}
              onClick={openCamera}
              className="mt-0.5 h-8 text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
            >
              Retake
            </button>
          </div>
          <button
            onClick={() => onChange(null)}
            className="h-10 rounded-md px-3 text-sm text-slate-500 transition hover:bg-slate-100 hover:text-ink"
          >
            Remove
          </button>
        </div>
      ) : (
        <div>
          <button
            onClick={openCamera}
            className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-brand-300 bg-brand-50 px-4 text-brand-800 transition hover:border-brand-400 hover:bg-brand-100 ${secondary ? "py-4" : "py-6"}`}
          >
            <Camera size={secondary ? 22 : 26} strokeWidth={1.5} aria-hidden="true" />
            <span className="text-base font-semibold">
              {secondary ? "Or take a photo" : "Take a photo of your work"}
            </span>
            {!secondary && (
              <span className="text-xs text-brand-700">Your working and your final answer</span>
            )}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            className="mt-1 flex h-11 w-full items-center justify-center rounded-md text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-ink"
          >
            Choose from your photos
          </button>
        </div>
      )}

      {readError && <p className="mt-2 text-sm text-danger-600">{readError}</p>}

      {scanning && (
        <CameraScanner
          hint="Fit your working and answer in the frame"
          onClose={() => {
            setScanning(false);
            opener.current?.focus();
          }}
          onCapture={(file) => {
            setScanning(false);
            focusRetake.current = true;
            void acceptFile(file);
          }}
        />
      )}
    </>
  );
}
