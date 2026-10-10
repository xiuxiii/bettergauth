import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const { checkAge } = await importTs("lib/account/age.ts");
const OCT_2026 = new Date(Date.UTC(2026, 9, 15)); // 15 Oct 2026

test("age: clearly 13+ and clearly under", () => {
  assert.deepEqual(checkAge(2000, 1, OCT_2026), { ok: true });
  assert.deepEqual(checkAge(2012, 12, OCT_2026), { ok: true }); // turned 13 in Dec 2025
  assert.deepEqual(checkAge(2014, 1, OCT_2026), { ok: false, reason: "too_young" });
  assert.deepEqual(checkAge(2020, 5, OCT_2026), { ok: false, reason: "too_young" });
});

test("age: the 13th birthday month counts as 12 until it is over", () => {
  assert.deepEqual(checkAge(2013, 9, OCT_2026), { ok: true }); // turned 13 in September
  assert.deepEqual(checkAge(2013, 10, OCT_2026), { ok: false, reason: "too_young" }); // birthday this month
  assert.deepEqual(checkAge(2013, 11, OCT_2026), { ok: false, reason: "too_young" });
});

test("age: nonsense is invalid, not a pass", () => {
  for (const [y, m] of [[2030, 1], [2026, 11], [1800, 1], ["x", 1], [2000, 0], [2000, 13], [2000.5, 3], [null, null]]) {
    assert.deepEqual(checkAge(y, m, OCT_2026), { ok: false, reason: "invalid" }, `${y}/${m}`);
  }
  assert.deepEqual(checkAge("2000", "6", OCT_2026), { ok: true }); // form values arrive as strings
});
