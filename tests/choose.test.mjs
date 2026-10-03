import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const { chooseProvider, chooseDetectionProvider, pinnedRunProblem } = await importTs("lib/ai/choose.ts");

const both = { anthropic: true, deepseek: true };
const base = { configured: both, defaultProvider: "deepseek", tutorSwitch: false, evalRequest: false };

test("choose: with the switch off, a student's header is ignored", () => {
  assert.equal(chooseProvider({ ...base, requested: "anthropic" }), "deepseek");
  assert.equal(chooseProvider({ ...base, requested: null }), "deepseek");
});

test("choose: with TUTOR_SWITCH=on, the header is honoured", () => {
  assert.equal(chooseProvider({ ...base, tutorSwitch: true, requested: "anthropic" }), "anthropic");
  assert.equal(chooseProvider({ ...base, tutorSwitch: true, requested: "deepseek" }), "deepseek");
  assert.equal(chooseProvider({ ...base, tutorSwitch: true, requested: undefined }), "deepseek");
});

test("choose: a provider with no key is never picked, switch or not", () => {
  const deepseekOnly = { anthropic: false, deepseek: true };
  for (const flags of [{ tutorSwitch: true }, { evalRequest: true }]) {
    assert.equal(
      chooseProvider({ ...base, ...flags, configured: deepseekOnly, requested: "anthropic" }),
      "deepseek",
    );
  }
});

test("choose: an eval request is honoured without the switch", () => {
  assert.equal(chooseProvider({ ...base, evalRequest: true, requested: "anthropic" }), "anthropic");
});

test("choose: junk, casing and whitespace in the header", () => {
  const on = { ...base, tutorSwitch: true };
  assert.equal(chooseProvider({ ...on, requested: "  Anthropic \n" }), "anthropic");
  assert.equal(chooseProvider({ ...on, requested: "ANTHROPIC" }), "anthropic");
  assert.equal(chooseProvider({ ...on, requested: "claude" }), "deepseek");
  assert.equal(chooseProvider({ ...on, requested: "anthropic,deepseek" }), "deepseek");
  assert.equal(chooseProvider({ ...on, requested: "" }), "deepseek");
});

test("choose: an unknown AI_PROVIDER (null default) stays null without a valid pick", () => {
  assert.equal(chooseProvider({ ...base, defaultProvider: null, requested: "anthropic" }), null);
  assert.equal(chooseProvider({ ...base, defaultProvider: null, tutorSwitch: true, requested: "x" }), null);
  // A valid, allowed pick still runs: it never needed the default.
  assert.equal(
    chooseProvider({ ...base, defaultProvider: null, tutorSwitch: true, requested: "anthropic" }),
    "anthropic",
  );
});

test("detection: eval pick, then DETECT_PROVIDER, then the tutor's rule", () => {
  const d = { ...base, detectProvider: "anthropic" };
  // An eval request's pick beats DETECT_PROVIDER.
  assert.equal(chooseDetectionProvider({ ...d, evalRequest: true, requested: "deepseek" }), "deepseek");
  // A student's pick never does, even with the switch on.
  assert.equal(chooseDetectionProvider({ ...d, tutorSwitch: true, requested: "deepseek" }), "anthropic");
  // DETECT_PROVIDER unset: exactly the tutor's rule.
  const n = { ...base, detectProvider: null };
  assert.equal(chooseDetectionProvider({ ...n, requested: "anthropic" }), "deepseek");
  assert.equal(chooseDetectionProvider({ ...n, tutorSwitch: true, requested: "anthropic" }), "anthropic");
});

test("pinned eval runs: fine with a bypass, flagged without one", () => {
  const run = {
    configured: both, defaultProvider: "deepseek", tutorSwitch: false, detectProvider: null,
    bypass: false, detect: false,
  };
  assert.equal(pinnedRunProblem({ ...run, provider: "anthropic", bypass: true }), null);
  // Pinned to the default: it runs where it says, bypass or not.
  assert.equal(pinnedRunProblem({ ...run, provider: "deepseek" }), null);
  // Pinned elsewhere without a bypass: would measure DeepSeek under Claude's name.
  assert.match(pinnedRunProblem({ ...run, provider: "anthropic" }), /EVAL_BYPASS_TOKEN/);
  // The Tutor switch lets the tutor's routes honour it ...
  assert.equal(pinnedRunProblem({ ...run, provider: "anthropic", tutorSwitch: true }), null);
  // ... but not detection with DETECT_PROVIDER set.
  const detect = { ...run, detect: true, tutorSwitch: true, detectProvider: "deepseek" };
  assert.match(pinnedRunProblem({ ...detect, provider: "anthropic" }), /DETECT_PROVIDER/);
  assert.equal(pinnedRunProblem({ ...detect, provider: "anthropic", bypass: true }), null);
  // No key for it at all.
  assert.match(
    pinnedRunProblem({ ...run, provider: "anthropic", bypass: true, configured: { anthropic: false, deepseek: true } }),
    /No Claude key/,
  );
});
