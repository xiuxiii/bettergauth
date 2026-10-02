import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const { gridLines, drawDetectGrid } = await importTs("lib/detectGrid.ts");

test("gridLines: 9 lines each way at every 10%, rounded, labelled in pixels (890x1245)", () => {
  const { xs, ys } = gridLines(890, 1245);
  assert.deepEqual(xs.map((l) => l.px), [89, 178, 267, 356, 445, 534, 623, 712, 801]);
  // 124.5, 373.5, 622.5, 871.5 and 1120.5 round up.
  assert.deepEqual(ys.map((l) => l.px), [125, 249, 374, 498, 623, 747, 872, 996, 1121]);
  for (const l of [...xs, ...ys]) assert.equal(l.label, String(l.px));
});

test("gridLines: 1600x1200", () => {
  const { xs, ys } = gridLines(1600, 1200);
  assert.equal(xs.length, 9);
  assert.equal(ys.length, 9);
  assert.deepEqual(xs.map((l) => l.label), ["160", "320", "480", "640", "800", "960", "1120", "1280", "1440"]);
  assert.deepEqual(ys.map((l) => l.label), ["120", "240", "360", "480", "600", "720", "840", "960", "1080"]);
});

/** A 2D context that records what was drawn, with what style. */
function fakeCtx() {
  const calls = [];
  const ctx = {
    calls,
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    save: () => calls.push({ op: "save" }),
    restore: () => calls.push({ op: "restore" }),
    beginPath: () => calls.push({ op: "beginPath" }),
    moveTo: (x, y) => calls.push({ op: "moveTo", x, y }),
    lineTo: (x, y) => calls.push({ op: "lineTo", x, y }),
    stroke: () => calls.push({ op: "stroke", style: ctx.strokeStyle, width: ctx.lineWidth }),
    // Roughly 6px a digit at 11px sans-serif.
    measureText: (t) => ({ width: t.length * 6.2 }),
    fillRect: (x, y, w, h) => calls.push({ op: "fillRect", x, y, w, h, style: ctx.fillStyle }),
    fillText: (text, x, y) => calls.push({ op: "fillText", text, x, y, style: ctx.fillStyle, font: ctx.font }),
  };
  return ctx;
}

for (const [W, H] of [[890, 1245], [1600, 1200], [60, 40]]) {
  test(`drawDetectGrid ${W}x${H}: 18 1px lines, every label at both ends, all inside`, () => {
    const ctx = fakeCtx();
    drawDetectGrid(ctx, W, H);
    const { xs, ys } = gridLines(W, H);

    const strokes = ctx.calls.filter((c) => c.op === "stroke");
    assert.equal(strokes.length, 18);
    for (const s of strokes) {
      assert.equal(s.style, "rgba(220,38,38,0.35)");
      assert.equal(s.width, 1);
    }
    for (const c of ctx.calls.filter((c) => c.op === "moveTo" || c.op === "lineTo")) {
      assert.ok(c.x >= 0 && c.x <= W && c.y >= 0 && c.y <= H, JSON.stringify(c));
    }

    const texts = ctx.calls.filter((c) => c.op === "fillText");
    const rects = ctx.calls.filter((c) => c.op === "fillRect");
    assert.equal(texts.length, 36);
    assert.equal(rects.length, 36);
    for (const t of texts) {
      assert.equal(t.style, "rgba(220,38,38,0.8)");
      assert.equal(t.font, "11px sans-serif");
    }
    for (const r of rects) {
      assert.equal(r.style, "rgba(255,255,255,0.7)");
      assert.equal(r.h, 15); // 11px text + 2px padding each side
      if (r.w <= W && r.h <= H) {
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H, JSON.stringify(r));
      }
    }
    // Each label appears twice: both ends of its line.
    for (const { label } of [...xs, ...ys]) {
      assert.ok(texts.filter((t) => t.text === label).length >= 2, label);
    }
    // Vertical lines: one label at the top edge, one at the bottom.
    const tops = rects.filter((r) => r.y === 0).length;
    const bottoms = rects.filter((r) => r.y + r.h === H).length;
    assert.ok(tops >= 9 && bottoms >= 9);
    // Horizontal lines: one at the left edge, one at the right.
    const lefts = rects.filter((r) => r.x === 0).length;
    const rights = rects.filter((r) => r.x + r.w === W).length;
    assert.ok(lefts >= 9 && rights >= 9);
    // Text sits inside its backing rect.
    texts.forEach((t, i) => {
      const r = rects[i];
      assert.ok(t.x >= r.x && t.x <= r.x + r.w && t.y >= r.y && t.y <= r.y + r.h);
    });
    // Nothing leaks: the canvas state is restored.
    assert.equal(ctx.calls[0].op, "save");
    assert.equal(ctx.calls.at(-1).op, "restore");
  });
}

test("drawDetectGrid: a label is centred on its line away from the edges", () => {
  const ctx = fakeCtx();
  drawDetectGrid(ctx, 1600, 1200);
  const texts = ctx.calls.filter((c) => c.op === "fillText");
  const rects = ctx.calls.filter((c) => c.op === "fillRect");
  const i = texts.findIndex((t) => t.text === "800");
  assert.ok(Math.abs(rects[i].x + rects[i].w / 2 - 800) <= 1);
  const j = texts.findIndex((t) => t.text === "600");
  assert.ok(Math.abs(rects[j].y + rects[j].h / 2 - 600) <= 1);
});
