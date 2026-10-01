import { test } from "node:test";
import assert from "node:assert/strict";
import { importTs } from "./importTs.mjs";

const { tutorRouting, PROVIDER_INFO } = await importTs("lib/privacyCopy.ts");

const both = { anthropic: true, deepseek: true, defaultProvider: "deepseek", deepseekVision: true, studentSwitch: false };
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

test("each provider names its company, country and an https policy link", () => {
  for (const p of Object.values(PROVIDER_INFO)) {
    assert.ok(p.company && p.where && p.note);
    assert.match(p.policy, /^https:\/\//);
  }
});
