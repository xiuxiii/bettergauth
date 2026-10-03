import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const { createUndoHolder } = await importTs("lib/undoHolder.ts");

function setup(t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ran = [];
  const seen = [];
  const holder = createUndoHolder(5000, (p) => seen.push(p?.key ?? null));
  // A run that, like deleteSession + load, finishes on a later tick.
  const slow = (key) => () => new Promise((res) => setImmediate(() => (ran.push(key), res())));
  return { holder, ran, seen, slow };
}

test("two quick deletes while the first one commits both happen", async (t) => {
  const { holder, ran, seen, slow } = setup(t);
  void holder.schedule("A", "Problem deleted", slow("A"));
  // B and C tapped in the same task, while A is still being committed.
  const b = holder.schedule("B", "Problem deleted", slow("B"));
  const c = holder.schedule("C", "Problem deleted", slow("C"));
  assert.equal(seen.at(-1), "C", "the last tap is the one on offer to undo");
  await Promise.all([b, c]);
  assert.deepEqual(ran, ["A", "B"]);
  assert.equal(seen.at(-1), "C", "still C once the earlier commits finish");
  t.mock.timers.tick(5000);
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(ran, ["A", "B", "C"]);
  assert.equal(seen.at(-1), null);
});

test("Undo drops the held action and it never runs", async (t) => {
  const { holder, ran, seen, slow } = setup(t);
  void holder.schedule("A", "Problem deleted", slow("A"));
  holder.undo();
  assert.equal(seen.at(-1), null);
  t.mock.timers.tick(10000);
  await holder.commit();
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(ran, []);
});

test("an Undo after a second tap only saves the second", async (t) => {
  const { holder, ran, slow } = setup(t);
  void holder.schedule("A", "Problem deleted", slow("A"));
  const b = holder.schedule("B", "Problem deleted", slow("B"));
  holder.undo();
  await b;
  t.mock.timers.tick(10000);
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(ran, ["A"]);
});

test("the timer commits once, and leaving the page commits at most once", async (t) => {
  const { holder, ran, slow } = setup(t);
  void holder.schedule("A", "Problem deleted", slow("A"));
  t.mock.timers.tick(4999);
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(ran, []);
  t.mock.timers.tick(1);
  await holder.commit(); // pagehide racing the timer
  await new Promise((res) => setImmediate(res));
  assert.deepEqual(ran, ["A"]);
});
