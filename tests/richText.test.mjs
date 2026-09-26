import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const { splitMath, splitEmphasis } = await importTs("lib/richText.ts");

const kinds = (segs) => segs.map((s) => `${s.kind}:${s.text}`);

test("prices are not math: '$5 and batteries $3'", () => {
  assert.deepEqual(kinds(splitMath("costs $5 and batteries $3")), ["text:costs $5 and batteries $3"]);
});

test("prices with a sum stay text: '$5 + $3 = $8'", () => {
  assert.deepEqual(kinds(splitMath("so $5 + $3 = $8.")), ["text:so $5 + $3 = $8."]);
});

test("a closing $ followed by a digit is not a close", () => {
  assert.deepEqual(kinds(splitMath("$x$2")), ["text:$x$2"]);
});

test("real inline math still splits out", () => {
  assert.deepEqual(kinds(splitMath("with $v = 19.8$ m/s")), ["text:with ", "math:v = 19.8", "text: m/s"]);
});

test("single-character inline math", () => {
  assert.deepEqual(kinds(splitMath("solve for $x$.")), ["text:solve for ", "math:x", "text:."]);
});

test("display math is marked as a block", () => {
  const segs = splitMath("$$v^2 = 2gh$$");
  assert.equal(segs.length, 1);
  assert.equal(segs[0].kind, "math");
  assert.equal(segs[0].block, true);
});

test("'9.8*2*20' keeps its asterisks", () => {
  assert.deepEqual(kinds(splitEmphasis("9.8*2*20 = 392")), ["text:9.8*2*20 = 392"]);
});

test("'x*y*z' keeps its asterisks", () => {
  assert.deepEqual(kinds(splitEmphasis("x*y*z")), ["text:x*y*z"]);
});

test("a lone asterisk is literal", () => {
  assert.deepEqual(kinds(splitEmphasis("29.8*20")), ["text:29.8*20"]);
});

test("real emphasis still works", () => {
  assert.deepEqual(kinds(splitEmphasis("and *this* is **key**, ok")), [
    "text:and ",
    "em:this",
    "text: is ",
    "strong:key",
    "text:, ok",
  ]);
});

test("emphasis at the very start", () => {
  assert.deepEqual(kinds(splitEmphasis("**Step 1** first")), ["strong:Step 1", "text: first"]);
});

test("spaced asterisks are not emphasis: 'a * b * c'", () => {
  assert.deepEqual(kinds(splitEmphasis("a * b * c")), ["text:a * b * c"]);
});

test("no lookbehind in the patterns (Safari < 16.4 can't parse it)", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../lib/richText.ts", import.meta.url), "utf8");
  assert.equal(/\(\?<[=!]/.test(src), false);
});
