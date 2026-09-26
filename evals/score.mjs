/**
 * Scoring for the check-work evals. Pure functions, no network, so the scorer
 * itself can be checked against canned responses (`node evals/run.mjs
 * --selftest`) before its numbers are trusted.
 *
 * A case (evals/cases/*.json):
 *   id, problem, attempt: { text } | { image: "evals/images/x.jpg" }
 *   expect: {
 *     correct:     true when the attempt is right (any valid method)
 *     categories?: acceptable firstError categories, for a wrong attempt
 *     line?:       fragment(s) of the flagged step, matched in line or locate
 *   }
 *   finalAnswer?:   strings that must appear ONLY in continueFrom
 *   mustNotReveal?: terms the safe concept label must not contain
 */

/** Words that say nothing about WHAT went wrong, only where or how it reads. */
const STOP = new Set(
  (
    "your you this that with from until holds hold there here then than step steps line lines work working " +
    "something about where which what when were have been into used using gets like just only first second " +
    "third last next point part setup still looks look good right fine well goes going does make makes made " +
    "answer problem question check correct wrong error mistake before after them they their also both each " +
    "some more most much very will would could should"
  ).split(" "),
);

/** A light stem, so "dropped" / "drop" and "times" / "time" compare equal. */
function stem(w) {
  let s = w.replace(/(ing|ed|es|s)$/, "");
  if (s.length < 3) s = w;
  // dropped → dropp → drop
  if (/([b-df-hj-np-tv-z])\1$/.test(s)) s = s.slice(0, -1);
  return s;
}

/** Content words (stemmed): lowercase, 4+ letters, not a stop word. */
function contentWords(s) {
  return new Set(
    String(s ?? "")
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map(stem),
  );
}

/**
 * Words in the headline that give the diagnosis away: they also appear in the
 * diagnosis or the fix, and are not just the step's name, the flagged line or
 * the problem's own wording. The headline is read BEFORE the nudge, so it may
 * say where the problem is, never what it is.
 */
export function headlineLeak(check, problemText = "") {
  const e = check?.firstError;
  if (!e || check?.verdict === "correct") return [];
  const stepName = String(e.locate ?? "").split(":")[0];
  const allowed = new Set([
    ...contentWords(e.line),
    ...contentWords(stepName),
    ...contentWords(problemText),
  ]);
  const reveals = new Set([...contentWords(e.diagnosis), ...contentWords(e.fix)]);
  return [...contentWords(check.headline)].filter((w) => reveals.has(w) && !allowed.has(w));
}

const norm = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[−–]/g, "-");

/** The pieces a student sees before choosing "Show the rest". */
const EARLY_FIELDS = ["headline", "strength"];
const EARLY_ERROR_FIELDS = ["line", "locate", "nudge", "diagnosis", "fix"];

/**
 * Score one case.
 * @param {object} c         the case
 * @param {object} check     the WorkCheck the app returned
 * @param {object} [analysis] the ProblemAnalysis, for the label spoiler check
 */
export function scoreCase(c, check, analysis) {
  const saidCorrect = check?.verdict === "correct";
  const r = {
    id: c.id,
    expectedCorrect: !!c.expect.correct,
    verdict: check?.verdict ?? "(none)",
    verdictRight: saidCorrect === !!c.expect.correct,
    // The worst failure: a correct student told they're wrong.
    falseAlarm: !!c.expect.correct && !saidCorrect,
    missed: !c.expect.correct && saidCorrect,
    category: check?.firstError?.category ?? null,
    categoryRight: null,
    lineRight: null,
    answerLeaks: [],
    labelSpoilers: [],
    headlineLeak: headlineLeak(check, c.problem),
  };

  if (!c.expect.correct && !saidCorrect) {
    if (c.expect.categories?.length) {
      r.categoryRight = c.expect.categories.includes(r.category);
    }
    if (c.expect.line) {
      // Several fragments may be fair: the formula line or the substitution.
      const e = check?.firstError ?? {};
      r.lineRight = [].concat(c.expect.line).some(
        (frag) => norm(e.line).includes(norm(frag)) || norm(e.locate).includes(norm(frag)),
      );
    }
  }

  // The final answer must stay behind "Show the rest". Only for wrong
  // attempts: a correct student's own answer may be quoted back to them.
  for (const ans of c.expect.correct ? [] : c.finalAnswer ?? []) {
    const fields = [
      ...EARLY_FIELDS.map((f) => [f, check?.[f]]),
      ...EARLY_ERROR_FIELDS.map((f) => [`firstError.${f}`, check?.firstError?.[f]]),
    ];
    for (const [name, value] of fields) {
      if (norm(value).includes(norm(ans))) r.answerLeaks.push(name);
    }
  }

  // The label shown before any work must not name the method or the fix.
  if (analysis) {
    for (const term of c.mustNotReveal ?? []) {
      if (norm(analysis.concept).includes(norm(term))) r.labelSpoilers.push(term);
    }
  }
  return r;
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");

export function summarize(results) {
  const ok = results.filter((r) => !r.failed);
  const correctCases = ok.filter((r) => r.expectedCorrect);
  const errorCases = ok.filter((r) => !r.expectedCorrect);
  const cat = ok.filter((r) => r.categoryRight !== null);
  const line = ok.filter((r) => r.lineRight !== null);
  return {
    cases: results.length,
    failedToRun: results.length - ok.length,
    verdictAccuracy: pct(ok.filter((r) => r.verdictRight).length, ok.length),
    falseAlarmRate: pct(correctCases.filter((r) => r.falseAlarm).length, correctCases.length),
    missedErrorRate: pct(errorCases.filter((r) => r.missed).length, errorCases.length),
    categoryMatch: pct(cat.filter((r) => r.categoryRight).length, cat.length),
    lineMatch: pct(line.filter((r) => r.lineRight).length, line.length),
    answerLeaks: ok.filter((r) => r.answerLeaks.length).length,
    labelSpoilers: ok.filter((r) => r.labelSpoilers.length).length,
    headlineLeaks: ok.filter((r) => r.headlineLeak?.length).length,
  };
}
