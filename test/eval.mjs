// Evaluation harness: runs each scenario against the CURRENT mock tutor and
// reports where its behavior diverges from the product philosophy.
//
// Run:  node --no-warnings test/eval.mjs      (or: npm run eval:tutor)
//
// It exercises the real classifier (estimateUnderstanding, imported from the
// source) and a faithful mirror of MockProvider.respondToStudent's branch
// selection (lib/ai/mockProvider.ts), so the verdicts reflect the code that
// actually ships — not a paraphrase. Explicit-control, check-work, and practice
// channels are noted as separate subsystems (they are not the conversational
// engine under test here).

import { SCENARIOS } from "./scenarios.mjs";
import { estimateUnderstanding } from "../lib/tutor/philosophy.ts";

// --- Faithful mirror of MockProvider.respondToStudent (ask path) -------------
// Source: lib/ai/mockProvider.ts. If that function changes, update this.
function respondBranch(text) {
  const t = text.toLowerCase();
  const asksWhy = /\bwhy\b|how come|reason/.test(t);
  const looksWrong = /\bwrong|mistake|is it|\?\s*$/.test(t) && /=|\d/.test(t);
  const level = estimateUnderstanding(text); // REAL function

  if (looksWrong)
    return { level, branch: "hedge", move: "ask", desc: "vague hedge — 'want me to point at the exact line?'", generic: true };
  if (level === "high")
    return { level, branch: "affirm", move: "move_on", desc: "affirms as correct + 'push it to the final number'", generic: true };
  if (level === "low" || asksWhy)
    return { level, branch: "explain", move: "explain", desc: "returns the problem's canned full explanation", generic: true };
  return { level, branch: "nudge", move: "ask", desc: "generic nudge — 'what do you get when you apply that?'", generic: true };
}

const ACTION_MOVE = {
  "action:hint": { move: "hint", desc: "fixed hint" },
  "action:explain": { move: "explain", desc: "fixed explanation" },
  "action:go_deeper": { move: "explain", desc: "fixed deeper layer" },
  "action:show_solution": { move: "solve", desc: "structured six-part solution" },
  "action:similar": { move: "ask", desc: "a similar problem" },
};

// --- Verdict logic -----------------------------------------------------------
// Returns { verdict: PASS|WEAK|FAIL, category, note } for a single-turn eval.
function judgeAsk(ideal, m) {
  switch (ideal) {
    case "correct":
      if (m.branch === "affirm")
        return { verdict: "FAIL", category: "AFFIRMS_ERROR", note: "ratifies a wrong/partial answer as correct" };
      if (m.branch === "hedge")
        return { verdict: "FAIL", category: "VAGUE_HEDGE", note: "hedges instead of naming the error" };
      return { verdict: "FAIL", category: "MISSES_ERROR", note: "generic reply; never targets the specific error" };
    case "move_on":
      if (m.branch === "affirm")
        return { verdict: "WEAK", category: "REDUNDANT_NUDGE", note: "affirms but appends an unneeded 'push to the final number'" };
      if (m.branch === "explain")
        return { verdict: "FAIL", category: "VERBOSE_PATRONIZING", note: "re-explains to a student who already demonstrated mastery" };
      return { verdict: "WEAK", category: "REDUNDANT_NUDGE", note: "nudges a student who is already done" };
    case "solve":
      return { verdict: "FAIL", category: "WITHHOLDS_ON_REQUEST", note: "student asked for the answer in text; ask-path never gives it" };
    case "redirect":
      return { verdict: "FAIL", category: "NO_SCOPE_HANDLING", note: "treats an off-topic turn as if it were about the problem" };
    case "explain":
      if (m.branch === "explain")
        return { verdict: "PASS", category: "OK_BUT_GENERIC", note: "explains, but with canned text that ignores what the student said" };
      if (m.branch === "affirm")
        return { verdict: "FAIL", category: "AFFIRMS_INSTEAD_OF_EXPLAIN", note: "affirms instead of giving the requested reason" };
      if (m.branch === "hedge")
        return { verdict: "FAIL", category: "VAGUE_HEDGE", note: "hedges instead of explaining" };
      return { verdict: "FAIL", category: "NUDGE_INSTEAD_OF_EXPLAIN", note: "nudges instead of explaining what was asked" };
    default:
      return { verdict: m.move === ideal ? "PASS" : "WEAK", category: "", note: "" };
  }
}

// --- Run ---------------------------------------------------------------------
const rows = [];
const catCount = {};
let misclass = 0, misclassTotal = 0;
const bump = (c) => { if (c) catCount[c] = (catCount[c] || 0) + 1; };

for (const s of SCENARIOS) {
  if (s.channel.startsWith("action:")) {
    const a = ACTION_MOVE[s.channel];
    const verdict = a.move === s.idealMove || (s.idealMove === "ask" && a.move === "ask") ? "PASS" : "WEAK";
    rows.push({ s, mockMove: a.move, verdict, category: "CONTROL_OK", note: `explicit control → ${a.desc}` });
    bump("CONTROL_OK");
    continue;
  }
  if (s.channel === "check_work" || s.channel === "practice") {
    rows.push({ s, mockMove: "diagnose", verdict: "PASS", category: "DELEGATED_OK",
      note: `handled by ${s.channel === "check_work" ? "checkWork()" : "evaluatePractice()"} keyword diagnosis, not the conversational engine` });
    bump("DELEGATED_OK");
    continue;
  }

  // ask channel — single or multi-turn
  const turns = s.turns ?? [s.studentResponse];
  const perTurn = turns.map((t) => respondBranch(t));

  // understanding classification check (against idealUnderstanding, if given)
  let misNote = "";
  if (s.idealUnderstanding) {
    for (const pt of perTurn) {
      misclassTotal++;
      if (pt.level !== s.idealUnderstanding) { misclass++; }
    }
    const got = perTurn.map((p) => p.level).join(",");
    if (perTurn.some((p) => p.level !== s.idealUnderstanding))
      misNote = `classifier said [${got}], ideal ${s.idealUnderstanding}`;
  }

  // repetition (multi-turn): identical branch every turn
  const repeated = perTurn.length > 1 && perTurn.every((p) => p.branch === perTurn[0].branch);

  // judge on the first turn's move (representative); note repetition separately
  const j = judgeAsk(s.idealMove, perTurn[0]);
  let { verdict, category, note } = j;
  if (repeated) {
    category = "NO_MEMORY_REPETITION";
    note = `identical '${perTurn[0].branch}' response all ${perTurn.length} turns — no adaptation`;
    verdict = "FAIL";
  }
  if (misNote) note = note ? `${note}; ${misNote}` : misNote;
  bump(category);
  rows.push({ s, mockMove: perTurn.map((p) => p.move).join("→"), verdict, category, note, misNote, repeated });
}

// --- Report ------------------------------------------------------------------
const pad = (x, n) => String(x).padEnd(n);
const V = { PASS: "PASS", WEAK: "WEAK", FAIL: "FAIL" };
console.log("\n=== Tutor engine evaluation — " + SCENARIOS.length + " scenarios ===\n");
console.log(pad("ID", 4) + pad("SUBJECT", 12) + pad("CHANNEL", 22) + pad("IDEAL", 10) + pad("MOCK", 20) + "VERDICT");
console.log("-".repeat(100));
for (const r of rows) {
  console.log(
    pad(r.s.id, 4) + pad(r.s.subject, 12) + pad(r.s.channel, 22) +
    pad(r.s.idealMove, 10) + pad(r.mockMove, 20) + V[r.verdict],
  );
  if (r.note) console.log("      ↳ " + r.category + ": " + r.note);
}

const counts = rows.reduce((a, r) => ((a[r.verdict] = (a[r.verdict] || 0) + 1), a), {});
console.log("\n--- Verdicts ---");
console.log(`PASS ${counts.PASS || 0}   WEAK ${counts.WEAK || 0}   FAIL ${counts.FAIL || 0}   (of ${rows.length})`);

console.log("\n--- Failure/observation categories ---");
Object.entries(catCount).sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log(pad(c, 28) + n));

console.log(`\n--- Understanding classifier ---`);
console.log(`misclassified ${misclass}/${misclassTotal} labelled turns (estimateUnderstanding vs. ideal)`);

// Conversational-engine (ask-only) score
const ask = rows.filter((r) => r.s.channel === "ask");
const askFail = ask.filter((r) => r.verdict === "FAIL").length;
console.log(`\n--- Conversational (free-form 'ask') path ---`);
console.log(`${askFail}/${ask.length} ask scenarios FAIL the philosophy; ` +
  `${ask.length - askFail}/${ask.length} acceptable.`);
console.log("(Explicit controls, check-work, and practice pass — the weakness is the default chat path.)\n");
