#!/usr/bin/env node
/**
 * Render the eval photos in evals/images/: a printed question with the
 * student's working written underneath in a handwriting style (jittered
 * italic glyphs in blue ink on ruled paper), one page tilted and dim like a
 * phone shot under a desk lamp, and one page that isn't homework at all.
 *
 * The images are committed, so running the evals never needs this. Re-run it
 * only after editing the pages below:
 *
 *   node evals/make-images.mjs
 *
 * It uses Playwright's Chromium, which is not a project dependency: install
 * it once globally (npm i -g playwright) or run where it is preinstalled.
 * Glyph jitter comes from a seeded PRNG, so re-renders are identical.
 */

import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "images");

/**
 * One page per image. `question` is printed; `work` lines are handwritten.
 * `tilt` rotates the page and dims it; `plain` drops the printed question.
 */
const PAGES = [
  {
    file: "projectile-total-velocity.jpg",
    question: "7. A ball is kicked at 20 m/s at 30° above the horizontal on level ground. How long is it in the air? (g = 9.81 m/s²)",
    work: ["t = 2v/g", "t = 2(20)/9.81", "t = 4.08 s"],
  },
  {
    file: "correct-energy.jpg",
    question: "3. A 2.0 kg ball is dropped from rest from a height of 20 m. Ignoring air resistance, find its speed just before it hits the ground. (g = 9.81 m/s²)",
    work: ["mgh = ½mv²", "v = √(2gh) = √(2 × 9.81 × 20)", "v = √392.4 = 19.8 m/s"],
  },
  {
    file: "free-fall-height-as-time.jpg",
    question: "5. A stone is dropped from rest from a height of 45 m. How fast is it moving when it hits the ground? (g = 9.81 m/s²)",
    work: ["v = u + gt", "v = 0 + 9.81 × 45", "v = 441 m/s"],
  },
  {
    file: "moles-vs-mass.jpg",
    question: "4. Hydrogen burns in oxygen: 2H₂ + O₂ → 2H₂O. How many grams of O₂ are needed to react completely with 4.0 g of H₂? (H = 1.0, O = 16.0)",
    work: ["ratio H₂ : O₂ = 2 : 1", "mass O₂ = 4.0 g ÷ 2", "= 2.0 g"],
  },
  {
    file: "correct-completing-square.jpg",
    question: "9. Solve x² + 6x + 5 = 0.",
    work: ["x² + 6x = −5", "x² + 6x + 9 = 4", "(x + 3)² = 4", "x + 3 = ±2", "x = −1 or x = −5"],
  },
  {
    file: "units-cm-tilted-dim.jpg",
    question: "11. A spring stretches 2.0 cm when a 5.0 N force is applied. Find its spring constant in N/m.",
    work: ["F = kx", "k = F/x = 5.0 / 2.0", "k = 2.5 N/m"],
    tilt: true,
  },
  {
    file: "multipart-car.jpg",
    question: "12. A car accelerates uniformly from rest to 24 m/s in 8.0 s. (a) Find its acceleration. (b) How far does it travel in that time?",
    work: ["(a) a = t/v = 8.0/24", "a = 0.33 m/s²", "(b) s = ½at² = ½(0.33)(8.0)²", "s = 10.7 m"],
  },
  {
    file: "not-homework-shopping-list.jpg",
    plain: true,
    work: ["Saturday", "milk, eggs (12)", "bread + butter", "apples, bananas", "pasta for dinner", "call grandma", "pick up dry cleaning"],
  },
];

function html(page) {
  const lines = page.work.map((l) => `<div class="hw">${escape(l)}</div>`).join("");
  const q = page.plain ? "" : `<div class="q">${escape(page.question)}</div>`;
  return `<!doctype html><html><head><style>
    html, body { margin: 0; }
    body { width: 900px; height: 1200px; overflow: hidden;
      background: ${page.tilt ? "#3b2c20" : "#f4f1ea"}; }
    .page { position: absolute; inset: ${page.tilt ? "70px 60px" : "0"};
      background: #fbfaf6 repeating-linear-gradient(#fbfaf6 0 43px, #c9d6e8 43px 44px);
      padding: 70px 70px 40px 90px; box-sizing: border-box;
      ${page.tilt ? "transform: rotate(-7deg); filter: brightness(0.62) contrast(0.8); box-shadow: 0 30px 60px rgba(0,0,0,.5);" : ""} }
    .page::before { content: ""; position: absolute; left: 70px; top: 0; bottom: 0; width: 2px; background: #e8a0a0; }
    .q { font: 25px/1.45 "DejaVu Serif", serif; color: #1d1d1d; margin-bottom: 42px; }
    .hw { font: italic 34px/88px "FreeSerif", "DejaVu Serif", serif; color: #1f3a93; white-space: pre; }
    .hw span { display: inline-block; }
  </style></head><body><div class="page">${q}${lines}</div>
  <script>(() => {
    // Seeded jitter per glyph: size, baseline, slant. Deterministic. Scoped,
    // because the same tab renders every page.
    let seed = ${hash(page.file)};
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    document.querySelectorAll(".hw").forEach((line, li) => {
      const text = line.textContent;
      line.textContent = "";
      line.style.transform = "rotate(" + (rnd() * 1.6 - 0.8) + "deg) translateX(" + (rnd() * 18) + "px)";
      for (const ch of text) {
        const s = document.createElement("span");
        s.textContent = ch === " " ? " " : ch;
        s.style.transform = "translateY(" + (rnd() * 9 - 4.5) + "px) rotate(" + (rnd() * 16 - 8) + "deg) skewX(" + (rnd() * 12 - 10) + "deg)";
        s.style.fontSize = (29 + rnd() * 11) + "px";
        s.style.marginRight = (rnd() * 3 - 0.5) + "px";
        s.style.fontWeight = rnd() < 0.3 ? "600" : "400";
        line.appendChild(s);
      }
    });
  })();</script></body></html>`;
}

function escape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/** Playwright from the project if present, else from the global npm root. */
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
const { chromium } = pw;
const browser = await chromium.launch(
  process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium") } : {},
).catch(() => chromium.launch());
const tab = await browser.newPage({ viewport: { width: 900, height: 1200 } });
// A broken page script would silently leave the working typeset, not
// handwritten; fail instead.
tab.on("pageerror", (e) => {
  console.error("page script failed:", e.message);
  process.exit(1);
});
for (const page of PAGES) {
  await tab.setContent(html(page), { waitUntil: "load" });
  await tab.screenshot({ path: path.join(OUT, page.file), type: "jpeg", quality: 82 });
  console.log("wrote", path.join("evals/images", page.file));
}
await browser.close();
