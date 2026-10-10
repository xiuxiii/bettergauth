import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const { tutorRouting, PROVIDER_INFO } = await importTs("lib/privacyCopy.ts");

const both = { anthropic: true, deepseek: true, defaultProvider: "deepseek", deepseekVision: true, studentSwitch: false, detectProvider: null };
const switchOn = { ...both, studentSwitch: true };

test("no provider set up: nothing to name", () => {
  assert.deepEqual(tutorRouting({ ...both, anthropic: false, deepseek: false }), { providers: [], lines: [] });
});

test("Claude only: Claude answers everything, DeepSeek isn't named", () => {
  const r = tutorRouting({ ...both, deepseek: false, defaultProvider: "anthropic" });
  assert.deepEqual(r.providers, ["anthropic"]);
  assert.deepEqual(r.lines, ["Claude answers everything."]);
});

test("DeepSeek only: photos included, or not sent at all with vision off", () => {
  const on = tutorRouting({ ...both, anthropic: false });
  assert.deepEqual(on.providers, ["deepseek"]);
  assert.match(on.lines.join(" "), /photos included/);
  const off = tutorRouting({ ...both, anthropic: false, deepseekVision: false });
  assert.match(off.lines.join(" "), /Photos aren't sent to it/);
});

test("both, switch off (the default): DeepSeek answers, Claude is the backup, no Settings line", () => {
  const r = tutorRouting(both);
  assert.deepEqual(r.providers, ["anthropic", "deepseek"]);
  assert.deepEqual(r.lines, [
    "DeepSeek answers everything.",
    "When DeepSeek can't read a photo or can't come up with an answer, that request is sent to Claude instead.",
  ]);
  assert.ok(!r.lines.some((l) => /Settings/.test(l)));
});

test("both, switch off, DEEPSEEK_VISION=off: photos always go to Claude", () => {
  assert.match(tutorRouting({ ...both, deepseekVision: false }).lines.join(" "), /Photos always go to Claude, never to DeepSeek\./);
});

test("both, switch off, Claude default: DeepSeek receives nothing, so isn't named", () => {
  const r = tutorRouting({ ...both, defaultProvider: "anthropic" });
  assert.deepEqual(r, { providers: ["anthropic"], lines: ["Claude answers everything."] });
});

test("switch on, DeepSeek default: the choice and the hand-off are both disclosed", () => {
  const r = tutorRouting(switchOn);
  assert.deepEqual(r.providers, ["anthropic", "deepseek"]);
  assert.match(r.lines[0], /^DeepSeek answers unless you choose Claude in Settings → Tutor\./);
  assert.match(r.lines.join(" "), /can't read a photo or can't come up with an answer, that request is sent to Claude/);
  assert.ok(!r.lines.some((l) => /never to DeepSeek/.test(l)));
});

test("switch on, Claude default (AI_PROVIDER=anthropic)", () => {
  const r = tutorRouting({ ...switchOn, defaultProvider: "anthropic" });
  assert.match(r.lines[0], /^Claude answers unless you choose DeepSeek/);
});

test("switch on, DEEPSEEK_VISION=off: photos always go to Claude", () => {
  assert.match(tutorRouting({ ...switchOn, deepseekVision: false }).lines.join(" "), /Photos always go to Claude, never to DeepSeek\./);
});

// DETECT_PROVIDER: question detection pinned to one provider.

const CLAUDE_DETECTS = "To find the questions on a photo, Claude reads it.";
const DEEPSEEK_DETECTS = "To find the questions on a photo, DeepSeek reads it.";

test("detection on the provider that already reads photos first: nothing changes", () => {
  assert.deepEqual(tutorRouting({ ...both, detectProvider: "deepseek" }), tutorRouting(both));
  const claudeDefault = { ...both, defaultProvider: "anthropic" };
  assert.deepEqual(tutorRouting({ ...claudeDefault, detectProvider: "anthropic" }), tutorRouting(claudeDefault));
  const claudeOnly = { ...both, deepseek: false, defaultProvider: "anthropic" };
  assert.deepEqual(tutorRouting({ ...claudeOnly, detectProvider: "anthropic" }), tutorRouting(claudeOnly));
  const deepseekOnly = { ...both, anthropic: false };
  assert.deepEqual(tutorRouting({ ...deepseekOnly, detectProvider: "deepseek" }), tutorRouting(deepseekOnly));
  // Vision off already sends every photo to Claude.
  const visionOff = { ...both, deepseekVision: false };
  assert.deepEqual(tutorRouting({ ...visionOff, detectProvider: "anthropic" }), tutorRouting(visionOff));
});

test("DeepSeek tutors, Claude detects: Claude's part is disclosed", () => {
  const r = tutorRouting({ ...both, detectProvider: "anthropic" });
  assert.deepEqual(r.providers, ["anthropic", "deepseek"]);
  assert.deepEqual(r.lines, [...tutorRouting(both).lines, CLAUDE_DETECTS]);
});

test("Claude tutors, DeepSeek detects: DeepSeek is named and its part disclosed", () => {
  const r = tutorRouting({ ...both, defaultProvider: "anthropic", detectProvider: "deepseek" });
  assert.deepEqual(r.providers, ["anthropic", "deepseek"]);
  assert.deepEqual(r.lines, ["Claude answers everything.", DEEPSEEK_DETECTS]);
});

test("DeepSeek detects with DEEPSEEK_VISION=off: the photo still goes to Claude, so no new line", () => {
  const r = tutorRouting({ ...both, defaultProvider: "anthropic", deepseekVision: false, detectProvider: "deepseek" });
  assert.deepEqual(r, { providers: ["anthropic"], lines: ["Claude answers everything."] });
});

test("switch on: the detection provider is said to hold whichever tutor is picked", () => {
  const r = tutorRouting({ ...switchOn, detectProvider: "deepseek" });
  assert.equal(r.lines.at(-1), "To find the questions on a photo, DeepSeek reads it, whichever you choose in Settings → Tutor.");
  assert.match(tutorRouting({ ...switchOn, detectProvider: "anthropic" }).lines.at(-1), /^To find the questions on a photo, Claude reads it, whichever/);
});

test("one provider with TUTOR_SWITCH=on: no switch exists, so no Settings wording", () => {
  const deepseekOnly = { ...switchOn, anthropic: false };
  assert.deepEqual(tutorRouting({ ...deepseekOnly, detectProvider: "deepseek" }), tutorRouting(deepseekOnly));
});

test("each provider names its company, country and an https policy link", () => {
  for (const p of Object.values(PROVIDER_INFO)) {
    assert.ok(p.company && p.where && p.note);
    assert.match(p.policy, /^https:\/\//);
  }
});

const { accountCopy } = await importTs("lib/privacyCopy.ts");

test("accounts off: the page says what it always did", () => {
  const c = accountCopy(false);
  assert.equal(c.account, null);
  assert.match(c.keeps[0], /^Nothing about your problems/);
  assert.match(c.keeps.join(" "), /only cookie MindGap uses/);
  assert.match(c.never.join(" "), /Ask for an account/);
});

test("accounts on: no claim it keeps nothing, one cookie, or never asks for an account", () => {
  const c = accountCopy(true);
  const all = [...c.keeps, ...c.never, ...c.account].join(" ");
  assert.doesNotMatch(all, /only cookie/);
  assert.doesNotMatch(all, /^Nothing about your problems/m);
  assert.doesNotMatch(c.never.join(" "), /account, your name or your email/);
  // Says what an account keeps, who stores it, the age rule and how to delete it.
  assert.match(all, /13 or older, never the date/);
  assert.match(all, /Supabase/);
  assert.match(all, /Delete account/);
  assert.match(all, /If you don't sign in: nothing about your problems/);
  assert.doesNotMatch(c.summary, /no accounts/);
  assert.match(accountCopy(false).summary, /no accounts/);
});
