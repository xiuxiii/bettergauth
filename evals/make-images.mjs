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
 * It also renders the question-DETECTION pages (DETECT_PAGES: a two-column
 * textbook page, a worksheet with working, the same textbook page tilted on a
 * desk) and writes their cases, evals/cases/22-24-detect-*.json, with each
 * question's true box measured from the DOM. Then it draws the coordinate
 * grid (lib/detectGrid.ts, the app's own drawer) on every detection image,
 * including the real photographed spread of case 21, as <name>.grid.jpg.
 * That spread's JPEG and case are not rendered here: see rebuild-spread.mjs.
 *
 * It uses Playwright's Chromium, which is not a project dependency: install
 * it once globally (npm i -g playwright) or run where it is preinstalled.
 * Glyph jitter comes from a seeded PRNG, so re-renders are identical.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "images");
const CASES = path.join(HERE, "cases");
const ROOT = path.join(HERE, "..");

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
  ${handwritingScript(hash(page.file))}</body></html>`;
}

/**
 * The handwriting: a script that turns each `.hw` line's text into jittered
 * glyphs. Seeded jitter per glyph: size, baseline, slant. Deterministic.
 */
function handwritingScript(seed) {
  return `<script>(() => {
    // Seeded jitter per glyph: size, baseline, slant. Deterministic. Scoped,
    // because the same tab renders every page.
    let seed = ${seed};
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
  })();</script>`;
}

function escape(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

/* -------------------------------------------------------------------------
 * Question-detection pages (cases 22-24).
 *
 * Each question is a `.dq` element with data-label. Its true box is the
 * union of the rendered boxes of the text inside it (and of anything marked
 * data-ink), so it hugs the number, stem, parts, options and any handwritten
 * working, and leaves out the blank space around them, running headers,
 * headings, page numbers and shared "Use this information…" stems.
 * ---------------------------------------------------------------------- */

/** Two-column textbook page. Strings are trusted HTML (sub/sup, entities). */
const TEXTBOOK = {
  header: ["Chapter 6 &nbsp;Motion, Energy and Matter", "Section 6.4 Review"],
  folio: "214",
  left: [
    { heading: "Questions" },
    { n: "31", stem: "A cyclist travels 12 km in 40 min. What is her average speed in metres per second?" },
    { n: "32", stem: "Which of the following quantities is a vector?", options: ["mass", "speed", "displacement", "kinetic energy"] },
    {
      n: "33",
      stem: "A 1200 kg car brakes uniformly from 25 m/s to rest in 5.0 s.",
      parts: ["Calculate its deceleration.", "Calculate the braking force.", "How far does the car travel while it is braking?"],
    },
    { shared: "<b>Use this information to answer questions 34 and 35.</b><br>A 0.50 kg ball is thrown straight up at 14 m/s from a height of 1.5 m. Ignore air resistance." },
    { n: "34", stem: "The maximum height the ball reaches above its starting point is closest to", options: ["7.1 m", "10 m", "14 m", "20 m"] },
    { n: "35", stem: "How long is the ball in the air before it returns to the thrower’s hand?" },
  ],
  right: [
    { n: "36", stem: "Balance the equation for the combustion of propane:<br>__ C<sub>3</sub>H<sub>8</sub> + __ O<sub>2</sub> → __ CO<sub>2</sub> + __ H<sub>2</sub>O" },
    { n: "37", stem: "Calculate the molar mass of calcium carbonate, CaCO<sub>3</sub>. (Ca = 40.1, C = 12.0, O = 16.0)" },
    {
      n: "38",
      stem: "A sample of gas occupies 2.5 L at 100 kPa.",
      parts: ["What volume does it occupy at 250 kPa if the temperature does not change?", "Name the gas law you used."],
    },
    { n: "39", stem: "<b>Explain</b>, in terms of moving particles, why a gas exerts a pressure on the walls of its container, and why that pressure rises when the gas is heated in a sealed rigid container." },
    {
      n: "40",
      stem: "A 6.0 V battery drives a current of 0.40 A through a resistor.",
      parts: ["Find the resistance.", "Find the power dissipated in the resistor.", "How much charge flows through it in 2.0 min?"],
    },
  ],
};

/** Single-column worksheet; `work` lines are handwritten under the question. */
const WORKSHEET = [
  { n: "1", stem: "State the law of conservation of energy.", space: 64 },
  {
    n: "2",
    stem: "A 60 kg student climbs a staircase 4.0 m high in 5.0 s. Calculate the useful power she develops.",
    work: ["E = mgh = 60 × 9.81 × 4.0", "E = 2354 J", "P = E/t = 2354/5.0 = 471 W"],
    space: 34,
  },
  { n: "3", stem: "A 0.20 kg ball moves at 15 m/s. Find its kinetic energy.", space: 80 },
  {
    n: "4",
    stem: "A motor lifts a 50 kg load through 3.0 m and uses 2500 J of electrical energy.",
    parts: ["How much useful work does it do?", "Find the efficiency of the motor."],
    space: 80,
  },
  {
    n: "5",
    stem: "A 2.0 kW kettle is switched on for 3.0 minutes. How much energy does it transfer?",
    work: ["E = P × t", "E = 2000 × 3", "E = 6000 J"],
    space: 34,
  },
  { n: "6", stem: "A spring with k = 200 N/m is stretched by 5.0 cm. Find the elastic potential energy stored in it.", space: 0 },
];

const DETECT_PAGES = [
  { id: "22-detect-two-column", file: "detect-two-column.jpg", html: () => textbookHtml({ tilt: false }) },
  { id: "23-detect-worksheet", file: "detect-worksheet.jpg", html: () => worksheetHtml() },
  { id: "24-detect-tilted-spread", file: "detect-tilted-spread.jpg", html: () => textbookHtml({ tilt: true }) },
];

const letters = (i) => String.fromCharCode(97 + i);
function partsHtml(parts) {
  if (!parts) return "";
  return `<div class="parts">${parts.map((p, i) => `<div class="li"><span class="tag">(${letters(i)})</span><span>${p}</span></div>`).join("")}</div>`;
}
function optionsHtml(options) {
  if (!options) return "";
  return `<div class="opts">${options.map((o, i) => `<div class="li"><span class="tag">${"ABCD"[i]}.</span><span>${o}</span></div>`).join("")}</div>`;
}
function questionHtml(q) {
  if (q.heading) return `<h2>${q.heading}</h2>`;
  if (q.shared) return `<div class="shared">${q.shared}</div>`;
  const work = q.work ? `<div class="work">${q.work.map((l) => `<div class="hw">${escape(l)}</div>`).join("")}</div>` : "";
  return `<div class="dq" data-label="${q.n}"><span class="num">${q.n}.</span><div class="body"><div>${q.stem}</div>${partsHtml(q.parts)}${optionsHtml(q.options)}${work}</div></div>${
    q.space ? `<div style="height:${q.space}px"></div>` : ""
  }`;
}

function textbookHtml({ tilt }) {
  const col = (items) => `<div class="col">${items.map(questionHtml).join("")}</div>`;
  return `<!doctype html><html><head><style>
    html, body { margin: 0; }
    body { width: 900px; height: 1200px; overflow: hidden; position: relative;
      background: ${tilt ? "radial-gradient(ellipse at 40% 35%, #5c4835, #271d15 78%)" : "#f3f1ea"}; }
    .page { position: absolute; left: 0; top: 0; width: 900px; height: 1200px; box-sizing: border-box;
      padding: 44px 54px 0; background: #fdfcf8; color: #1b1b1b;
      font: 16px/1.42 "Liberation Sans", "DejaVu Sans", sans-serif;
      ${tilt ? "transform: rotate(3deg) scale(0.86); transform-origin: 50% 50%; filter: brightness(0.8) contrast(0.88) sepia(0.12); box-shadow: 0 26px 60px rgba(0,0,0,.6);" : ""} }
    .run { display: flex; justify-content: space-between; font-size: 13px; color: #555;
      border-bottom: 1px solid #9a9a9a; padding-bottom: 6px; margin-bottom: 24px; letter-spacing: .02em; }
    .cols { display: flex; gap: 46px; }
    .col { flex: 1; min-width: 0; }
    h2 { font-size: 21px; margin: 0 0 18px; color: #234a7d; }
    .dq { display: grid; grid-template-columns: 32px 1fr; margin-bottom: 30px; }
    .num { font-weight: 700; }
    .parts, .opts { margin-top: 3px; }
    .li { display: grid; grid-template-columns: 30px 1fr; }
    .shared { margin: 0 0 22px; padding: 10px 12px; background: #eef2f7; border-left: 3px solid #234a7d; font-size: 15px; }
    .folio { position: absolute; left: 54px; bottom: 40px; font-size: 14px; }
    .folio b { margin-right: 10px; }
    .vignette { position: absolute; inset: 0; pointer-events: none;
      background: radial-gradient(ellipse 72% 68% at 46% 42%, rgba(0,0,0,0) 52%, rgba(0,0,0,.42) 100%),
        linear-gradient(105deg, rgba(255,236,200,.10), rgba(0,0,0,.14)); }
  </style></head><body><div class="page">
    <div class="run"><span>${TEXTBOOK.header[0]}</span><span>${TEXTBOOK.header[1]}</span></div>
    <div class="cols">${col(TEXTBOOK.left)}${col(TEXTBOOK.right)}</div>
    <div class="folio"><b>${TEXTBOOK.folio}</b> Unit 2</div>
  </div>${tilt ? `<div class="vignette"></div>` : ""}</body></html>`;
}

function worksheetHtml() {
  return `<!doctype html><html><head><style>
    html, body { margin: 0; }
    body { width: 900px; height: 1200px; overflow: hidden; background: #f4f1ea; }
    .page { position: absolute; inset: 0; box-sizing: border-box; padding: 52px 72px 0;
      background: #fdfdfb; color: #1d1d1d; font: 19px/1.42 "Liberation Serif", "DejaVu Serif", serif; }
    h1 { font: 700 26px/1.2 "Liberation Sans", "DejaVu Sans", sans-serif; margin: 0 0 14px; }
    .meta { display: flex; gap: 40px; font-size: 17px; margin-bottom: 10px; }
    .instr { font-style: italic; font-size: 17px; margin: 0 0 26px; padding-bottom: 12px; border-bottom: 1px solid #888; }
    .dq { display: grid; grid-template-columns: 34px 1fr; }
    .num { font-weight: 700; }
    .li { display: grid; grid-template-columns: 34px 1fr; }
    .work { margin: 6px 0 0 10px; }
    .hw { font: italic 34px/54px "FreeSerif", "DejaVu Serif", serif; color: #1f3a93; white-space: pre; }
    .hw span { display: inline-block; }
  </style></head><body><div class="page">
    <h1>Worksheet 4: Work, Energy and Power</h1>
    <div class="meta"><span>Name: ____________________</span><span>Class: ______</span><span>Date: __________</span></div>
    <p class="instr">Show all your working. Take g = 9.81 m/s².</p>
    ${WORKSHEET.map(questionHtml).join("")}
  </div>${handwritingScript(hash("detect-worksheet.jpg"))}</body></html>`;
}

/**
 * Each question's true box, in screenshot pixels. Text boxes are measured
 * with the page's own transform switched off, then their four corners are put
 * through that transform (matrix about its transform-origin) and the box is
 * the axis-aligned box enclosing them all. Chrome's own transformed rects are
 * returned too, as a cross-check.
 */
async function measureQuestions(tab) {
  return tab.evaluate(() => {
    const inkRects = (el) => {
      const out = [];
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.textContent.trim()) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        for (const b of r.getClientRects()) if (b.width > 0 && b.height > 0) out.push(b);
      }
      el.querySelectorAll("[data-ink]").forEach((e) => out.push(e.getBoundingClientRect()));
      return out;
    };
    const union = (pts) => ({
      x0: Math.min(...pts.map((p) => p[0])),
      y0: Math.min(...pts.map((p) => p[1])),
      x1: Math.max(...pts.map((p) => p[0])),
      y1: Math.max(...pts.map((p) => p[1])),
    });
    const corners = (b) => [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]];
    const page = document.querySelector(".page");
    const cs = getComputedStyle(page);
    const m = cs.transform === "none" ? new DOMMatrix() : new DOMMatrix(cs.transform);
    const [ox, oy] = cs.transformOrigin.split(" ").map(parseFloat);
    const els = [...document.querySelectorAll(".dq")];

    const chrome = els.map((el) => union(inkRects(el).flatMap(corners)));
    const saved = page.style.transform;
    page.style.transform = "none";
    const base = page.getBoundingClientRect();
    const O = [base.left + ox, base.top + oy];
    const through = ([x, y]) => {
      const p = m.transformPoint(new DOMPoint(x - O[0], y - O[1]));
      return [p.x + O[0], p.y + O[1]];
    };
    const boxes = els.map((el) => ({ label: el.dataset.label, ...union(inkRects(el).flatMap(corners).map(through)) }));
    page.style.transform = saved;
    return { boxes, chrome, width: innerWidth, height: innerHeight };
  });
}

const r4 = (v) => Math.round(v * 10000) / 10000;

/** Pixel boxes → the case's normalized rects; throws on a box off the image or two that overlap. */
function toQuestions(boxes, width, height, id) {
  const px = boxes.map((b) => ({
    label: b.label,
    x0: Math.max(0, Math.floor(b.x0)),
    y0: Math.max(0, Math.floor(b.y0)),
    x1: Math.min(width, Math.ceil(b.x1)),
    y1: Math.min(height, Math.ceil(b.y1)),
  }));
  for (const b of boxes)
    if (b.x0 < 0 || b.y0 < 0 || b.x1 > width || b.y1 > height) throw new Error(`${id}: question ${b.label} runs off the image`);
  for (let i = 0; i < px.length; i++)
    for (let j = i + 1; j < px.length; j++) {
      const a = px[i], b = px[j];
      if (a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) throw new Error(`${id}: boxes ${a.label} and ${b.label} overlap`);
    }
  return px.map((b) => ({
    label: b.label,
    rect: { x: r4(b.x0 / width), y: r4(b.y0 / height), w: r4((b.x1 - b.x0) / width), h: r4((b.y1 - b.y0) / height) },
  }));
}

function writeCase(id, file, width, height, questions) {
  const kase = {
    id,
    kind: "detect",
    image: `evals/images/${file}`,
    gridImage: `evals/images/${gridName(file)}`,
    width,
    height,
    questions,
  };
  fs.writeFileSync(path.join(CASES, `${id}.json`), JSON.stringify(kase, null, 2) + "\n");
  console.log("wrote", `evals/cases/${id}.json`, `(${questions.length} questions)`);
}

const gridName = (file) => file.replace(/\.jpg$/, ".grid.jpg");

/** lib/detectGrid.ts, transpiled with the project's own typescript, as page source. */
function detectGridSource() {
  const req = createRequire(path.join(ROOT, "package.json"));
  let ts;
  try {
    ts = req("typescript");
  } catch {
    ts = createRequire(path.join(execSync("npm root -g").toString().trim(), "noop.js"))("typescript");
  }
  const src = fs.readFileSync(path.join(ROOT, "lib", "detectGrid.ts"), "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return `${js}\nwindow.drawDetectGrid = drawDetectGrid;`;
}

/**
 * Write <file>.grid.jpg: the image with the app's detection grid drawn on it,
 * by the app's own drawer, at the image's own pixel size.
 */
async function writeGrid(tab, file) {
  await tab.setContent("<!doctype html><html><body></body></html>");
  await tab.addScriptTag({ type: "module", content: detectGridSource() });
  await tab.waitForFunction(() => typeof window.drawDetectGrid === "function");
  const data = "data:image/jpeg;base64," + fs.readFileSync(path.join(OUT, file)).toString("base64");
  const res = await tab.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    window.drawDetectGrid(ctx, c.width, c.height);
    return { width: c.width, height: c.height, url: c.toDataURL("image/jpeg", 0.9) };
  }, data);
  fs.writeFileSync(path.join(OUT, gridName(file)), Buffer.from(res.url.split(",")[1], "base64"));
  console.log("wrote", path.join("evals/images", gridName(file)), `(${res.width}x${res.height})`);
  return res;
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

for (const page of DETECT_PAGES) {
  await tab.setContent(page.html(), { waitUntil: "load" });
  await tab.evaluate(() => document.fonts.ready);
  const { boxes, chrome, width, height } = await measureQuestions(tab);
  // The hand-rolled transform must agree with Chrome's own transformed rects.
  boxes.forEach((b, i) => {
    const c = chrome[i];
    const off = Math.max(...["x0", "y0", "x1", "y1"].map((k) => Math.abs(b[k] - c[k])));
    if (off > 1.5) throw new Error(`${page.id}: question ${b.label} box disagrees with Chrome's by ${off.toFixed(1)}px`);
  });
  const questions = toQuestions(boxes, width, height, page.id);
  await tab.screenshot({ path: path.join(OUT, page.file), type: "jpeg", quality: 85 });
  console.log("wrote", path.join("evals/images", page.file), `(${width}x${height})`);
  writeCase(page.id, page.file, width, height, questions);
}

// Grid variants, for every detection image. Case 21's photo is committed
// (rebuilt once by rebuild-spread.mjs); its case must match its real size.
const SPREAD = { file: "spread-gas-laws.jpg", case: "21-detect-spread.json" };
for (const file of [SPREAD.file, ...DETECT_PAGES.map((p) => p.file)]) {
  if (!fs.existsSync(path.join(OUT, file))) {
    console.warn("missing", path.join("evals/images", file), "- no grid drawn");
    continue;
  }
  const { width, height } = await writeGrid(tab, file);
  if (file === SPREAD.file) {
    const kase = JSON.parse(fs.readFileSync(path.join(CASES, SPREAD.case), "utf8"));
    if (kase.width !== width || kase.height !== height)
      throw new Error(`${SPREAD.case} says ${kase.width}x${kase.height}, the image is ${width}x${height}`);
  }
}
await browser.close();
