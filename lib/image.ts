/**
 * Client-side image normalization (downscale + EXIF-upright).
 *
 * Every capture path (in-app camera + library upload) runs through here so the
 * server always receives a sane, upright JPEG. This fixes two real bugs:
 *   1. Phone photos are huge (multi-MB HEIC/JPEG) — too big to POST/analyze
 *      reliably, which surfaced as "Could not read that image".
 *   2. Photos carry EXIF orientation; `createImageBitmap` with
 *      `imageOrientation: "from-image"` bakes the rotation in so the model sees
 *      the problem upright.
 *
 * Captures are NOT cropped here. Framing is the QuestionCropper's job: it asks
 * the model to box the individual questions and hands the student a draggable
 * box they can correct. The Otsu ink-bounding-box heuristic below survives only
 * as that cropper's offline fallback — it seeds an editable box, and never
 * silently crops a photo on its own.
 */

import { fileToDataUrl } from "@/lib/utils";
import type { NormalizedRect } from "@/lib/tutor/types";

const MAX_DIM = 1600; // longest edge, px — plenty for OCR, small enough to POST
const QUALITY = 0.82; // JPEG quality

function scaledCanvas(
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
): HTMLCanvasElement {
  const scale = Math.min(1, MAX_DIM / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.fillStyle = "#ffffff"; // flatten any transparency for JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return canvas;
}

function canvasToJpeg(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/jpeg", QUALITY);
}

/** Otsu's method: the luminance threshold that best splits dark from light. */
function otsuThreshold(hist: number[], total: number): number {
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let max = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) {
      max = between;
      threshold = t;
    }
  }
  return threshold;
}

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Bounding box of the "ink" (dark-on-light) content, or null if there's no
 * clear region — mostly-dark frames, near-empty frames, or a box that already
 * fills the frame all bail out so we don't crop badly.
 */
function detectContentRect(canvas: HTMLCanvasElement): Rect | null {
  const { width: w, height: h } = canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, w, h);

  const hist = new Array(256).fill(0);
  const lum = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const l = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    const v = l | 0;
    lum[p] = v;
    hist[v]++;
  }

  const total = w * h;
  const thr = otsuThreshold(hist, total);

  const colCount = new Int32Array(w);
  const rowCount = new Int32Array(h);
  let ink = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (lum[row + x] < thr) {
        colCount[x]++;
        rowCount[y]++;
        ink++;
      }
    }
  }
  // Mostly-ink frame (dark scene / inverted) — thresholding is unreliable.
  if (ink / total > 0.5 || ink / total < 0.002) return null;

  // Require a column/row to carry more than noise before it counts as an edge.
  const colMin = Math.max(2, Math.round(h * 0.012));
  const rowMin = Math.max(2, Math.round(w * 0.012));

  let left = -1;
  let right = -1;
  for (let x = 0; x < w; x++) {
    if (colCount[x] > colMin) {
      if (left === -1) left = x;
      right = x;
    }
  }
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < h; y++) {
    if (rowCount[y] > rowMin) {
      if (top === -1) top = y;
      bottom = y;
    }
  }
  if (left === -1 || top === -1 || right <= left || bottom <= top) return null;

  const pad = Math.round(Math.min(w, h) * 0.035);
  const x = Math.max(0, left - pad);
  const y = Math.max(0, top - pad);
  const rw = Math.min(w, right + pad) - x;
  const rh = Math.min(h, bottom + pad) - y;

  const area = (rw * rh) / total;
  // Already fills the frame → nothing to gain. Too tiny → probably noise.
  if (area > 0.92 || area < 0.06) return null;
  return { x, y, w: rw, h: rh };
}

/** Normalize a picked/dropped File into a downscaled, upright JPEG data URL. */
export async function fileToNormalizedJpeg(file: File): Promise<string> {
  if (typeof createImageBitmap === "function") {
    try {
      // `from-image` applies EXIF rotation; cast through unknown so it
      // type-checks on older DOM lib versions whose union predates the value.
      const opts = { imageOrientation: "from-image" } as unknown as ImageBitmapOptions;
      const bmp = await createImageBitmap(file, opts);
      try {
        return canvasToJpeg(scaledCanvas(bmp, bmp.width, bmp.height));
      } finally {
        bmp.close?.();
      }
    } catch {
      // fall through to the <img> path
    }
  }
  const dataUrl = await fileToDataUrl(file);
  const img = await loadImageEl(dataUrl);
  return canvasToJpeg(scaledCanvas(img, img.naturalWidth, img.naturalHeight));
}

function loadImageEl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode the image."));
    img.src = dataUrl;
  });
}

/**
 * Local fallback for question detection: the ink bounding box of an image, as
 * a normalised rect — or null when there is no clear region. Used by the
 * cropper when the vision detection is unavailable.
 */
export async function detectContentRectNormalized(
  dataUrl: string,
): Promise<NormalizedRect | null> {
  const img = await loadImageEl(dataUrl);
  const canvas = scaledCanvas(img, img.naturalWidth, img.naturalHeight);
  const r = detectContentRect(canvas);
  if (!r) return null;
  return {
    x: r.x / canvas.width,
    y: r.y / canvas.height,
    w: r.w / canvas.width,
    h: r.h / canvas.height,
  };
}

/** Crop an image data URL to a normalised rect, returning a JPEG data URL. */
export async function cropDataUrl(
  dataUrl: string,
  rect: NormalizedRect,
): Promise<string> {
  const img = await loadImageEl(dataUrl);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const x = Math.round(Math.min(Math.max(rect.x, 0), 1) * W);
  const y = Math.round(Math.min(Math.max(rect.y, 0), 1) * H);
  const w = Math.max(1, Math.round(Math.min(rect.w, 1 - rect.x) * W));
  const h = Math.max(1, Math.round(Math.min(rect.h, 1 - rect.y) * H));
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
  return canvasToJpeg(out);
}

/**
 * Grab the current frame of a live <video> as a downscaled JPEG data URL.
 * The full frame is kept: the student frames the question in the cropper.
 */
export function videoFrameToJpeg(video: HTMLVideoElement): string {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error("Camera frame not ready.");
  return canvasToJpeg(scaledCanvas(video, w, h));
}
