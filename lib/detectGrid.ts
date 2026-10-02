/**
 * The coordinate grid drawn on the image sent for question detection when
 * DETECT_GRID=on.
 *
 * Why: detection asks for boxes in absolute pixels, and on a photographed
 * two-column spread the boxes came back about one question too high or low.
 * A model reading "y = 498" off a labelled line has something to measure
 * against instead of estimating from the whole frame. Whether that actually
 * helps is for `npm run eval -- --kind detect --grid` to decide, so it is off
 * by default.
 *
 * The grid goes ONLY on the downscaled image that is sent (lib/image.ts
 * imageForDetection), in that image's own pixel space, so the labels are the
 * very coordinates the model is asked for. The photo the student sees and
 * crops stays clean.
 *
 * The eval runner draws the same grid on its test photos, so this spec is
 * shared and must not drift: 9 interior lines each way at every 10%, 1px,
 * rgba(220,38,38,0.35); every line labelled at both ends with its pixel
 * position in 11px sans-serif, rgba(220,38,38,0.8), on a white 0.7-alpha
 * backing rect with 2px padding, kept inside the image.
 *
 * Pure (no DOM at module level), so `npm test` can drive it with a fake
 * context.
 */

export type GridLine = { px: number; label: string };

const LINE_COLOR = "rgba(220,38,38,0.35)";
const TEXT_COLOR = "rgba(220,38,38,0.8)";
const BACKING_COLOR = "rgba(255,255,255,0.7)";
const FONT_PX = 11;
const PAD = 2;

/** The 9 interior lines at every 10% of each dimension, labelled in pixels. */
export function gridLines(
  width: number,
  height: number,
): { xs: GridLine[]; ys: GridLine[] } {
  const at = (size: number) =>
    Array.from({ length: 9 }, (_, i) => {
      const px = Math.round((size * (i + 1)) / 10);
      return { px, label: String(px) };
    });
  return { xs: at(width), ys: at(height) };
}

/** Keep a box of `size` starting near `start` inside [0, limit]. */
function inside(start: number, size: number, limit: number): number {
  return Math.max(0, Math.min(start, limit - size));
}

/**
 * Draw the grid onto `ctx`, which holds an image of `width` x `height`.
 * Lines first, then labels, so no line crosses a label.
 */
export function drawDetectGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
): void {
  const { xs, ys } = gridLines(width, height);
  ctx.save();

  // +0.5 puts a 1px line exactly on pixel column/row `px`; on the integer
  // it would straddle two and render as a 2px smear at half the colour.
  ctx.lineWidth = 1;
  ctx.strokeStyle = LINE_COLOR;
  for (const { px } of xs) {
    ctx.beginPath();
    ctx.moveTo(px + 0.5, 0);
    ctx.lineTo(px + 0.5, height);
    ctx.stroke();
  }
  for (const { px } of ys) {
    ctx.beginPath();
    ctx.moveTo(0, px + 0.5);
    ctx.lineTo(width, px + 0.5);
    ctx.stroke();
  }

  ctx.font = `${FONT_PX}px sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const label = (text: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = BACKING_COLOR;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = TEXT_COLOR;
    ctx.fillText(text, x + PAD, y + h / 2);
  };

  for (const { px, label: text } of xs) {
    const w = Math.ceil(ctx.measureText(text).width) + PAD * 2;
    const h = FONT_PX + PAD * 2;
    const x = inside(px - w / 2, w, width);
    label(text, x, 0, w, h); // top end
    label(text, x, Math.max(0, height - h), w, h); // bottom end
  }
  for (const { px, label: text } of ys) {
    const w = Math.ceil(ctx.measureText(text).width) + PAD * 2;
    const h = FONT_PX + PAD * 2;
    const y = inside(px - h / 2, h, height);
    label(text, 0, y, w, h); // left end
    label(text, Math.max(0, width - w), y, w, h); // right end
  }

  ctx.restore();
}
