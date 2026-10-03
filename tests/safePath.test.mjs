import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const { safeBackPath } = await importTs("lib/safePath.ts");

test("safeBackPath: paths on this site pass through", () => {
  assert.equal(safeBackPath("/settings"), "/settings");
  assert.equal(safeBackPath("/session/abc?x=1#top"), "/session/abc?x=1#top");
  assert.equal(safeBackPath("/"), "/");
});

test("safeBackPath: nothing, or not a path, goes home", () => {
  for (const v of [undefined, null, "", "settings", "https://evil.example", "javascript:alert(1)"]) {
    assert.equal(safeBackPath(v), "/", String(v));
  }
});

test("safeBackPath: every way of spelling another host goes home", () => {
  for (const v of [
    "//evil.example",
    "/\\evil.example",
    "/\\/evil.example",
    "/\tevil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/ /evil.example",
    "/\u0000/evil.example",
  ]) {
    assert.equal(safeBackPath(v), "/", JSON.stringify(v));
  }
});

test("safeBackPath: dot segments are resolved, and stay on this site", () => {
  assert.equal(safeBackPath("/a/../settings"), "/settings");
  assert.equal(safeBackPath("/../../evil.example"), "/evil.example");
});
