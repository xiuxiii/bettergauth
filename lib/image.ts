/**
 * Client-side image normalization.
 *
 * Both capture paths (in-app camera + library upload) run through here so the
 * server always receives a sane, right-sized JPEG. This fixes two real bugs:
 *   1. Phone photos are huge (multi-MB HEIC/JPEG) — too big to POST/analyze
 *      reliably, which surfaced as "Could not read that image".
 *   2. Photos carry EXIF orientation; drawing through `createImageBitmap` with
 *      `imageOrientation: "from-image"` bakes the rotation in so the model sees
 *      the problem upright.
 */

import { fileToDataUrl } from "@/lib/utils";

const MAX_DIM = 1600; // longest edge, px — plenty for OCR, small enough to POST
const QUALITY = 0.82; // JPEG quality

function drawScaledToJpeg(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
): string {
  const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  // White matte so any transparency flattens cleanly under JPEG.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", QUALITY);
}

function loadImageEl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode the image."));
    img.src = dataUrl;
  });
}

/** Normalize a picked/dropped File into a downscaled, upright JPEG data URL. */
export async function fileToNormalizedJpeg(file: File): Promise<string> {
  // Preferred path: createImageBitmap honors EXIF orientation.
  if (typeof createImageBitmap === "function") {
    try {
      // `from-image` applies EXIF rotation; cast through unknown so it type-checks
      // on older DOM lib versions whose union predates the value.
      const opts = { imageOrientation: "from-image" } as unknown as ImageBitmapOptions;
      const bmp = await createImageBitmap(file, opts);
      try {
        return drawScaledToJpeg(bmp, bmp.width, bmp.height);
      } finally {
        bmp.close?.();
      }
    } catch {
      // fall through to the <img> path
    }
  }
  const dataUrl = await fileToDataUrl(file);
  const img = await loadImageEl(dataUrl);
  return drawScaledToJpeg(img, img.naturalWidth, img.naturalHeight);
}

/** Grab the current frame of a live <video> as a downscaled JPEG data URL. */
export function videoFrameToJpeg(video: HTMLVideoElement): string {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error("Camera frame not ready.");
  return drawScaledToJpeg(video, w, h);
}
