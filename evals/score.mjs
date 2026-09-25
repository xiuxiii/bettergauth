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
  };
}
