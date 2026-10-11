import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const { noWorkRefusal, NO_WORK_SEEN } = await importTs("lib/noWork.ts");

const photo = { imageDataUrl: "data:image/jpeg;base64,AAAA" };

test("a photo the model saw no attempt in is refused, with the photo wording", () => {
  const r = noWorkRefusal(photo, { attemptSeen: false });
  assert.equal(r?.code, NO_WORK_SEEN);
  assert.match(r.error, /photo/);
});

test("typed text that isn't an attempt is refused, with the typed wording", () => {
  const r = noWorkRefusal({ text: "idk lol" }, { attemptSeen: false });
  assert.equal(r?.code, NO_WORK_SEEN);
  assert.doesNotMatch(r.error, /in that photo/);
});

test("fails open: a missing or true attemptSeen is marked as usual", () => {
  assert.equal(noWorkRefusal(photo, {}), null);
  assert.equal(noWorkRefusal(photo, { attemptSeen: true }), null);
});

test("'just show me the solution' sends nothing and is never refused", () => {
  assert.equal(noWorkRefusal({}, { attemptSeen: false }), null);
  assert.equal(noWorkRefusal({ text: "   " }, { attemptSeen: false }), null);
});
