import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const { wantsDeepThought } = await importTs("lib/tutor/depth.ts");

test("Go deeper and Explain why always think", () => {
  assert.equal(wantsDeepThought("go_deeper"), true);
  assert.equal(wantsDeepThought("explain"), true);
});

test("hints, continue, solutions and practice never think", () => {
  for (const action of ["hint", "continue", "show_solution", "similar_problem"]) {
    assert.equal(wantsDeepThought(action, "why is this"), false, action);
  }
});

test("a typed step or short reply stays fast", () => {
  assert.equal(wantsDeepThought("ask", "So I use the amount thats gone out of the turbine or"), false);
  assert.equal(wantsDeepThought("ask", "I did a how do I do b"), false);
  assert.equal(wantsDeepThought("ask", "how can I find the time"), false);
  assert.equal(wantsDeepThought("ask", "x = 4"), false);
  assert.equal(wantsDeepThought("ask", "ok next"), false);
  assert.equal(wantsDeepThought("ask", ""), false);
  assert.equal(wantsDeepThought("ask"), false);
});

test("a typed question about understanding thinks", () => {
  assert.equal(wantsDeepThought("ask", "why does the normal force change on a slope?"), true);
  assert.equal(wantsDeepThought("ask", "How come the mass cancels?"), true);
  assert.equal(wantsDeepThought("ask", "how do forces balance on a slope"), true);
  assert.equal(wantsDeepThought("ask", "what does the negative sign mean here"), true);
  assert.equal(wantsDeepThought("ask", "where does the 1/2 come from"), true);
  assert.equal(wantsDeepThought("ask", "I don't get the difference between mass and moles"), true);
  assert.equal(wantsDeepThought("ask", "this doesn't make sense"), true);
  assert.equal(wantsDeepThought("question", "Why is T equal to Fg?"), true);
});

test("look-alike words don't trigger it", () => {
  assert.equal(wantsDeepThought("ask", "however I got 5"), false);
  assert.equal(wantsDeepThought("ask", "showhow"), false);
});
