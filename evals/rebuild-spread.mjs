#!/usr/bin/env node
/**
 * One-off: rebuild evals/images/spread-gas-laws.jpg, the real textbook page
 * (p. 182, gas laws questions 13-30) that question detection got wrong.
 *
 * The student's original photo wasn't kept. What we had were two phone
 * screenshots (1220x2712) of the app's cropper over that same photo, taken
 * ten seconds apart on 2026-10-01: one with Q27 tapped, one with Q19 tapped.
 * In each, the cropper dims the whole photo with a dark overlay except
 * inside the selection box, and strokes the box in blue. The two boxes sit
 * in different places, so between them every pixel of the photo is seen
 * either undimmed or dimmed with a known overlay:
 *
 *   1. The photo occupies the same rectangle in both (PHOTO below, found
 *      where the app's dark background and the frame's border end).
 *   2. Inside each box we have the same pixel bright in one screenshot and
 *      dimmed in the other, so a per-channel least-squares fit gives the
 *      overlay as dim = k * orig + off (about k = 0.45, off = 11-17).
 *   3. Everywhere else is undimmed by inverting that fit; inside each box the
 *      bright pixels are used directly; the blue outline and corner handles
 *      of one box are patched from the other screenshot, where that spot is
 *      merely dimmed.
 *
 * The output is committed, so the eval never needs this script or its inputs.
 * To re-run it you need those two screenshots:
 *
 *   node evals/rebuild-spread.mjs <q27-selected.jpg> <q19-selected.jpg>
 *
 * Uses Playwright's Chromium (a canvas does the pixel work), like
 * make-images.mjs. The question boxes in evals/cases/21-detect-spread.json
 * were measured by hand on the result.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "images", "spread-gas-laws.jpg");

/** Screenshot pixels. The photo, inclusive of its first and last row/col. */
const PHOTO = { x0: 7, y0: 319, x1: 1212, y1: 2006 };
/** Each selection box: `inner` is reliably undimmed, `outer` covers its outline and handles. */
const BOX_Q27 = { inner: { x0: 650, y0: 1071, x1: 1204, y1: 1191 }, outer: { x0: 630, y0: 1045, x1: 1219, y1: 1215 } };
const BOX_Q19 = { inner: { x0: 84, y0: 1495, x1: 641, y1: 1653 }, outer: { x0: 60, y0: 1470, x1: 665, y1: 1680 } };

const [shotA, shotB] = process.argv.slice(2);
if (!shotA || !shotB) {
  console.error("usage: node evals/rebuild-spread.mjs <q27-selected.jpg> <q19-selected.jpg>");
  process.exit(1);
}
const asDataUrl = (p) => "data:image/jpeg;base64," + fs.readFileSync(p).toString("base64");

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    /* not a project dependency — try the global install */
  }
  try {
    const root = execSync("npm root -g").toString().trim();
    return createRequire(path.join(root, "noop.js"))("playwright");
  } catch {
    return null;
  }
}

const pw = await loadPlaywright();
if (!pw) {
  console.error("Playwright isn't installed. Run `npm i -g playwright` (or use a machine where it is), then retry.");
  process.exit(1);
}
const browser = await pw.chromium
  .launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium") } : {})
  .catch(() => pw.chromium.launch());
const tab = await browser.newPage();
const result = await tab.evaluate(
  async ({ a, b, PHOTO, BOX_A, BOX_B }) => {
    const pixels = async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return { w: c.width, d: ctx.getImageData(0, 0, c.width, c.height).data };
    };
    const A = await pixels(a);
    const B = await pixels(b);
    const W = A.w;
    const inside = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

    // 2. Fit dim = k * orig + off per channel over both boxes' interiors.
    const fit = [0, 1, 2].map((ch) => {
      let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
      const add = (bright, dim, r) => {
        for (let y = r.y0 + 4; y <= r.y1 - 4; y++)
          for (let x = r.x0 + 4; x <= r.x1 - 4; x++) {
            const i = (y * W + x) * 4;
            const X = bright.d[i + ch], Y = dim.d[i + ch];
            n++; sx += X; sy += Y; sxx += X * X; sxy += X * Y;
          }
      };
      add(A, B, BOX_A.inner);
      add(B, A, BOX_B.inner);
      const k = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      return { k, off: (sy - k * sx) / n };
    });

    // 3. Rebuild.
    const w = PHOTO.x1 - PHOTO.x0 + 1, h = PHOTO.y1 - PHOTO.y0 + 1;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    const out = ctx.createImageData(w, h);
    const bluish = (P, i) => P.d[i + 2] - P.d[i] > 25;
    for (let y = PHOTO.y0; y <= PHOTO.y1; y++)
      for (let x = PHOTO.x0; x <= PHOTO.x1; x++) {
        const i = (y * W + x) * 4;
        let src = A, dimmed = true; // outside both boxes A and B are identical
        if (inside(BOX_A.outer, x, y)) {
          if (inside(BOX_A.inner, x, y) && !bluish(A, i)) dimmed = false;
          else src = B;
        } else if (inside(BOX_B.outer, x, y)) {
          if (inside(BOX_B.inner, x, y) && !bluish(B, i)) src = B, dimmed = false;
        }
        const o = ((y - PHOTO.y0) * w + (x - PHOTO.x0)) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const v = src.d[i + ch];
          out.data[o + ch] = dimmed ? Math.max(0, Math.min(255, Math.round((v - fit[ch].off) / fit[ch].k))) : v;
        }
        out.data[o + 3] = 255;
      }
    ctx.putImageData(out, 0, 0);
    return { fit, w, h, url: c.toDataURL("image/jpeg", 0.9) };
  },
  { a: asDataUrl(shotA), b: asDataUrl(shotB), PHOTO, BOX_A: BOX_Q27, BOX_B: BOX_Q19 },
);
await browser.close();
fs.writeFileSync(OUT, Buffer.from(result.url.split(",")[1], "base64"));
console.log("overlay fit (dim = k*orig + off):", result.fit.map((f) => `k=${f.k.toFixed(3)} off=${f.off.toFixed(1)}`).join(" | "));
console.log(`wrote evals/images/spread-gas-laws.jpg (${result.w}x${result.h})`);
