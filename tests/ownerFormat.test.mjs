import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const {
  RUN_SPECS,
  runTitle,
  casesFor,
  failedResult,
  reportText,
  splitRate,
  ofText,
  hasActivity,
  sumPrefix,
  formatMs,
  formatDay,
  usageFields,
} = await importTs("lib/ownerFormat.ts");

const CASES = [
  { id: "01-a", kind: "check", hasGrid: false },
  { id: "18-b", kind: "notStem", hasGrid: false },
  { id: "19-c", kind: "tutor", hasGrid: false },
  { id: "21-d", kind: "detect", hasGrid: true },
  { id: "22-e", kind: "detect", hasGrid: true },
];

test("five runs: three box-placement variants, two checking-work", () => {
  assert.deepEqual(RUN_SPECS.map(runTitle), [
    "Box placement · DeepSeek",
    "Box placement · Claude",
    "Box placement · DeepSeek + grid",
    "Checking work · DeepSeek",
    "Checking work · Claude",
  ]);
});

test("box placement sends only detect cases; checking work sends everything else", () => {
  const detect = RUN_SPECS.find((s) => s.id === "detect-deepseek-grid");
  const check = RUN_SPECS.find((s) => s.id === "check-anthropic");
  assert.deepEqual(casesFor(detect, CASES).map((c) => c.id), ["21-d", "22-e"]);
  assert.deepEqual(casesFor(check, CASES).map((c) => c.id), ["01-a", "18-b", "19-c"]);
  assert.equal(detect.grid, true);
  assert.equal(check.provider, "anthropic");
});

test("a case that didn't run has the CLI's failed shape", () => {
  assert.deepEqual(failedResult(CASES[0], "HTTP 500"), {
    id: "01-a",
    kind: "check",
    failed: true,
    error: "HTTP 500",
  });
});

test("the copied report: header, lines, summary, no runs of blank lines", () => {
  const text = reportText({
    title: "Box placement · Claude",
    startedAt: "2026-10-02T09:00:00Z",
    lines: ["✓ 21-d detect 1/1 hit"],
    summary: ["", "Detection hits 1/1 (100%)"],
    stopped: { done: 1, total: 2 },
  });
  assert.equal(
    text,
    "Box placement · Claude · 2026-10-02T09:00:00Z\nStopped after 1 of 2 cases.\n\n✓ 21-d detect 1/1 hit\n\nDetection hits 1/1 (100%)\n",
  );
});

test("rates and fractions read as words", () => {
  assert.deepEqual(splitRate("6/8 (75%)"), { value: "75%", detail: "6 of 8" });
  assert.deepEqual(splitRate("n/a"), { value: "n/a" });
  assert.equal(ofText("1/1"), "1 of 1");
  assert.equal(ofText("0%"), "0%");
});

test("usage helpers: activity, prefix sums, times, UTC day names", () => {
  assert.equal(hasActivity({ devices: 0, counts: {}, avgMs: {} }), false);
  assert.equal(hasActivity({ devices: 0, counts: { check: 1 }, avgMs: {} }), true);
  assert.equal(sumPrefix({ "error.check.500": 2, "error.tutor.429": 1, check: 9 }, "error."), 3);
  assert.equal(formatMs(undefined), "–");
  assert.equal(formatMs(850.4), "850 ms");
  assert.equal(formatMs(7120), "7.1 s");
  assert.equal(formatDay("2026-10-02"), "Fri 2 Oct");
  assert.equal(formatDay("not-a-date"), "not-a-date");
});

test("a day's card adds up the counters it shows", () => {
  const fields = usageFields({
    date: "2026-10-02",
    devices: 3,
    counts: {
      "session.photo": 4, "session.text": 1, check: 5, "verdict.correct": 2,
      "turn.hint": 6, "turn.explain": 2, "turn.go_deeper": 1, resolved: 2,
      "error.check.500": 1, "fallback.analyzeProblem": 1, "limited.minute": 2,
    },
    avgMs: { check: 7000, tutor: 900 },
    checksCorrectPct: 40,
    fallbackPctOfDeepseek: 5,
  });
  const by = Object.fromEntries(fields.map((f) => [f.label, f]));
  assert.equal(by["Sessions"].value, "5");
  assert.equal(by["Sessions"].detail, "4 photo · 1 typed");
  assert.equal(by["Checks"].detail, "40% correct");
  assert.equal(by["Hint · explain · deeper"].value, "6 · 2 · 1");
  assert.equal(by["Avg check"].value, "7.0 s");
  assert.equal(by["Avg tutor reply"].value, "900 ms");
});
