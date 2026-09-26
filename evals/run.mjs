#!/usr/bin/env node
/**
 * Check-work evals against a RUNNING app — the real routes, the real prompts,
 * the real provider — so what is measured is what students get.
 *
 *   npm run dev                      (with ANTHROPIC_API_KEY set)
 *   npm run eval                     all cases, against http://localhost:3000
 *   npm run eval -- --base http://localhost:3100 --only projectile
 *   npm run eval -- --json out.json  also write the per-case results
 *   npm run eval -- --selftest       check the scorer itself; no app, no key
 *
 * Each case runs /api/analyze on the problem text (for the label spoiler
 * check), then /api/check-work on the attempt. Plain Node, no dependencies.
 * Cases live in evals/cases/*.json; see evals/score.mjs for the format.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scoreCase, summarize } from "./score.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes("--selftest")) {
  selftest();
  process.exit(0);
}

const BASE = (flag("--base") ?? process.env.EVAL_BASE ?? "http://localhost:3000").replace(/\/$/, "");
const ONLY = flag("--only");
const JSON_OUT = flag("--json");
const COOKIE = process.env.EVAL_COOKIE; // for a gated deploy: stem_access=...

const cases = fs
  .readdirSync(path.join(HERE, "cases"))
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(HERE, "cases", f), "utf8")))
  .filter((c) => !ONLY || c.id.includes(ONLY));

const headers = { "Content-Type": "application/json", ...(COOKIE ? { Cookie: COOKIE } : {}) };

async function post(route, body) {
  const res = await fetch(`${BASE}${route}`, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${route} ${res.status}: ${text.slice(0, 200)}`);
  return text;
}

/** /api/check-work streams NDJSON: stage frames, then one done (or error). */
function lastCheck(ndjson) {
  for (const line of ndjson.split("\n").filter(Boolean)) {
    const f = JSON.parse(line);
    if (f.t === "done") return f.check;
    if (f.t === "error") throw new Error(`check-work: ${f.message}`);
  }
  throw new Error("check-work: stream ended without a result");
}

function imageDataUrl(rel) {
  const buf = fs.readFileSync(path.join(HERE, "..", rel));
  const type = rel.endsWith(".png") ? "image/png" : "image/jpeg";
  return `data:${type};base64,${buf.toString("base64")}`;
}

async function runCase(c) {
  const t0 = Date.now();
  const analysis = JSON.parse(await post("/api/analyze", { text: c.problem }));
  const attempt = c.attempt.image
    ? { imageDataUrl: imageDataUrl(c.attempt.image) }
    : { text: c.attempt.text };
  const check = lastCheck(await post("/api/check-work", { problem: analysis, attempt }));
  return { ...scoreCase(c, check, analysis), ms: Date.now() - t0, check, label: analysis.concept };
}

const mark = (b) => (b === null ? "·" : b ? "✓" : "✗");

console.log(`Running ${cases.length} case(s) against ${BASE}\n`);
const results = [];
for (const c of cases) {
  try {
    const r = await runCase(c);
    results.push(r);
    const notes = [
      r.falseAlarm && "FALSE ALARM",
      r.missed && "missed error",
      r.answerLeaks.length && `answer leaked in ${r.answerLeaks.join(", ")}`,
      r.labelSpoilers.length && `label "${r.label}" reveals ${r.labelSpoilers.join(", ")}`,
      r.headlineLeak?.length && `headline gives away: ${r.headlineLeak.join(", ")}`,
    ].filter(Boolean);
    console.log(
      `${mark(r.verdictRight)} ${c.id.padEnd(31)} ${r.verdict.padEnd(17)} cat ${mark(r.categoryRight)} line ${mark(r.lineRight)}  ${(r.ms / 1000).toFixed(1)}s${notes.length ? "  ← " + notes.join("; ") : ""}`,
    );
  } catch (err) {
    results.push({ id: c.id, failed: true, error: String(err.message ?? err) });
    console.log(`! ${c.id.padEnd(31)} ${err.message ?? err}`);
  }
}

const s = summarize(results);
console.log(`
Verdict accuracy     ${s.verdictAccuracy}
False "you're wrong" ${s.falseAlarmRate}   (correct attempts judged wrong — the number to keep at 0)
Missed errors        ${s.missedErrorRate}
First-error category ${s.categoryMatch}
First-error line     ${s.lineMatch}
Answer leaks         ${s.answerLeaks} case(s)   (final answer before "Show the rest")
Label spoilers       ${s.labelSpoilers} case(s)   (concept label names the method)
Headline leaks       ${s.headlineLeaks} case(s)   (headline says what's wrong, not just where)
${s.failedToRun ? `\n${s.failedToRun} case(s) failed to run.` : ""}`);

if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ base: BASE, at: new Date().toISOString(), summary: s, results }, null, 2));
  console.log(`Wrote ${JSON_OUT}`);
}

/** The scorer against canned responses, so its numbers can be trusted. */
function selftest() {
  const wrongCase = {
    id: "w", expect: { correct: false, categories: ["conceptual"], line: "t = 2v/g" },
    finalAnswer: ["2.04"], mustNotReveal: ["vertical component"],
  };
  const rightCase = { id: "r", expect: { correct: true }, finalAnswer: ["2.04"] };
  const good = {
    verdict: "error_found", headline: "Holds until line 2.", strength: "",
    firstError: { category: "conceptual", severity: "significant", line: "t = 2v/g", locate: "Line 2", nudge: "Which part of v?", diagnosis: "d", fix: "use v sin θ" },
    continueFrom: "t ≈ 2.04 s",
  };
  const checks = [];
  const t = (name, cond) => { checks.push([name, cond]); };

  let r = scoreCase(wrongCase, good, { concept: "Projectile time of flight" });
  t("good diagnosis scores right on every axis", r.verdictRight && r.categoryRight && r.lineRight && !r.answerLeaks.length && !r.labelSpoilers.length && !r.falseAlarm);

  r = scoreCase(rightCase, { ...good, verdict: "partially_correct" });
  t("a correct attempt judged wrong is a FALSE ALARM", r.falseAlarm && !r.verdictRight);

  r = scoreCase(rightCase, { verdict: "correct", headline: "You got 2.04 s.", strength: "", continueFrom: "" });
  t("a correct student's own answer quoted back is not a leak", r.verdictRight && !r.answerLeaks.length);

  r = scoreCase(wrongCase, { verdict: "correct", headline: "", strength: "", continueFrom: "" });
  t("an error judged correct is a missed error", r.missed && !r.verdictRight && r.categoryRight === null);

  r = scoreCase(wrongCase, { ...good, firstError: { ...good.firstError, category: "setup" } });
  t("wrong category is caught", r.categoryRight === false);

  r = scoreCase(wrongCase, { ...good, firstError: { ...good.firstError, fix: "so t = 2.04 s" } });
  t("final answer in the fix is a leak", r.answerLeaks.includes("firstError.fix"));

  r = scoreCase(wrongCase, good, { concept: "Time of flight using the vertical component" });
  t("a label naming the method is a spoiler", r.labelSpoilers.length === 1);

  const s = summarize([
    scoreCase(rightCase, { ...good, verdict: "error_found" }),
    scoreCase(rightCase, { verdict: "correct", headline: "", strength: "", continueFrom: "" }),
    scoreCase(wrongCase, good),
    { id: "x", failed: true },
  ]);
  t("summary: 1 of 2 correct attempts flagged → 50% false alarms", s.falseAlarmRate === "50%");
  t("summary: failed runs are counted, not scored", s.failedToRun === 1 && s.verdictAccuracy === "67%");

  // A6: the headline may say where the problem is, never what it is.
  const fallCase = { id: "f", problem: "A ball is dropped from 20 m. How fast is it going at the ground?", expect: { correct: false } };
  const fallErr = { category: "conceptual", severity: "significant", line: "v = 9.8 × 20", locate: "Line 2: which quantity goes with g", nudge: "What does the 20 stand for?", diagnosis: "Your work treats the drop distance as if it were the fall time.", fix: "Use v² = 2gh, or find the time first." };
  r = scoreCase(fallCase, { verdict: "error_found", headline: "Your working holds until line 2, where a distance gets used as if it were a time.", strength: "", firstError: fallErr, continueFrom: "" });
  t("headline naming the mistake is a leak (distance, time)", r.headlineLeak.includes("distance") && r.headlineLeak.includes("time"));
  r = scoreCase(fallCase, { verdict: "error_found", headline: "Your working holds until line 2.", strength: "", firstError: fallErr, continueFrom: "" });
  t("headline saying only where is clean", r.headlineLeak.length === 0);
  r = scoreCase(fallCase, { verdict: "error_found", headline: "Your ball-drop setup holds until line 2.", strength: "", firstError: { ...fallErr, diagnosis: "The ball's drop is treated as a time." }, continueFrom: "" });
  t("the problem's own words don't count as a leak", r.headlineLeak.length === 0);
  t("summary counts headline leaks", summarize([scoreCase(fallCase, { verdict: "error_found", headline: "Line 2 uses a distance as a time.", strength: "", firstError: fallErr, continueFrom: "" })]).headlineLeaks === 1);

  let failed = 0;
  for (const [name, cond] of checks) {
    console.log(`${cond ? "✓" : "✗"} ${name}`);
    if (!cond) failed++;
  }
  console.log(`\n${checks.length - failed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}
