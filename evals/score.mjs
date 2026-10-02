/**
 * Scoring for the check-work evals. Pure functions, no network, so the scorer
 * itself can be checked against canned responses (`node evals/run.mjs
 * --selftest`) before its numbers are trusted.
 *
 * A case (evals/cases/*.json), one of four kinds:
 *
 * check (default) — analyze, then check-work, the way the app does:
 *   id, problem, and either attempt: { text } (analyzed as typed text) or
 *   image: "evals/images/x.jpg" (a photo of the question and the working,
 *   analyzed and checked as the same photo; `problem` is then reference only)
 *   expect: {
 *     correct:     true when the attempt is right (any valid method)
 *     categories?: acceptable firstError categories, for a wrong attempt
 *     line?:       fragment(s) of the flagged step, matched in line or locate
 *   }
 *   finalAnswer?:   strings that must appear ONLY in continueFrom
 *   mustNotReveal?: terms the safe concept label must not contain
 *
 * notStem — a photo or text with nothing to tutor; analyze must say so:
 *   id, kind: "notStem", image | text
 *
 * tutor — one tutor reply, e.g. to a student disputing the tutor:
 *   id, kind: "tutor", problem (a ProblemAnalysis), history, studentText,
 *   action? (default "ask"), mustMatch?: regex[], mustNotMatch?: regex[]
 *   (case-insensitive, against the reply text)
 *
 * detect — question detection on a photographed page; do the boxes land on
 *   the right questions:
 *   id, kind: "detect", image, gridImage? (the same page with a grid drawn
 *   on, sent instead with --grid), width, height (the image's true pixels),
 *   questions: [{ label: "27", rect: { x, y, w, h } }]   (normalized 0..1,
 *   x,y = top-left). A true question is a hit when a predicted question has
 *   the same label (see normLabel), its centre lies inside the true rect and
 *   IoU >= 0.5. A missing label counts as IoU 0.
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
    strayQuotes: strayQuotes(check),
    kind: "check",
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

/** Fields ending in a quote mark left dangling after the sentence's end. */
export function strayQuotes(check) {
  const e = check?.firstError ?? {};
  const fields = {
    headline: check?.headline, strength: check?.strength, continueFrom: check?.continueFrom,
    "firstError.locate": e.locate, "firstError.nudge": e.nudge,
    "firstError.diagnosis": e.diagnosis, "firstError.fix": e.fix,
  };
  return Object.entries(fields)
    .filter(([, v]) => /[.!?…)]\s*['"‘’“”`]+$/u.test(String(v ?? "").trim()))
    .map(([k]) => k);
}

/** A not-homework input must be turned away by the analysis. */
export function scoreNotStem(c, analysis) {
  return {
    id: c.id,
    kind: "notStem",
    turnedAway: analysis?.hasStemContent === false,
  };
}

/** A tutor reply must match every mustMatch and no mustNotMatch pattern. */
export function scoreTutor(c, reply) {
  const text = String(reply ?? "");
  const missing = (c.mustMatch ?? []).filter((re) => !new RegExp(re, "i").test(text));
  const forbidden = (c.mustNotMatch ?? []).filter((re) => new RegExp(re, "i").test(text));
  return {
    id: c.id,
    kind: "tutor",
    passed: missing.length === 0 && forbidden.length === 0,
    missing,
    forbidden,
  };
}

/**
 * The question number and part letter a label names, so the model's
 * "Question 27", "Q27", "27." and the case's "27" compare equal, and
 * "3(b)", "Q 3 (b)" and "3b" too. A label with no number is kept as its
 * lowercase letters and digits.
 */
export function normLabel(label) {
  const s = String(label ?? "").toLowerCase();
  const m = s.match(/(\d+)\s*(?:\(\s*([a-z])\s*\)|([a-z])(?![a-z]))?/);
  if (!m) return s.replace(/[^a-z0-9]/g, "");
  return m[1].replace(/^0+(?=\d)/, "") + (m[2] ?? m[3] ?? "");
}

function iou(a, b) {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Score one detection against a detect case's true questions.
 * dx / dy are the predicted centre minus the true centre, as fractions of the
 * page (negative dy = the box sits too high), only where the label matched.
 */
export function scoreDetect(c, detection) {
  const predicted = (detection?.questions ?? []).filter((q) => q?.rect);
  const truthKeys = new Set(c.questions.map((q) => normLabel(q.label)));
  const questions = c.questions.map((t) => {
    const p = predicted.find((q) => normLabel(q.label) === normLabel(t.label));
    if (!p) return { label: t.label, found: false, hit: false, iou: 0, dx: null, dy: null };
    const tr = t.rect, pr = p.rect;
    const cx = pr.x + pr.w / 2, cy = pr.y + pr.h / 2;
    const centerIn = cx >= tr.x && cx <= tr.x + tr.w && cy >= tr.y && cy <= tr.y + tr.h;
    const v = iou(tr, pr);
    return {
      label: t.label,
      found: true,
      predictedLabel: p.label,
      hit: centerIn && v >= 0.5,
      iou: v,
      dx: cx - (tr.x + tr.w / 2),
      dy: cy - (tr.y + tr.h / 2),
    };
  });
  const found = questions.filter((q) => q.found);
  return {
    id: c.id,
    kind: "detect",
    questions,
    hits: questions.filter((q) => q.hit).length,
    total: questions.length,
    meanIoU: mean(questions.map((q) => q.iou)),
    meanDy: mean(found.map((q) => q.dy)),
    meanDx: mean(found.map((q) => q.dx)),
    missing: questions.length - found.length,
    extra: predicted.filter((q) => !truthKeys.has(normLabel(q.label))).length,
  };
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");

const fixed = (x, d) => (x === null ? "n/a" : x.toFixed(d));
/** Signed, 3 decimals: "+0.012", "-0.054". */
export const signed = (x) => (x === null || x === undefined ? "n/a" : `${x >= 0 ? "+" : "-"}${Math.abs(x).toFixed(3)}`);

export function summarize(results) {
  const ran = results.filter((r) => !r.failed);
  const notStem = ran.filter((r) => r.kind === "notStem");
  const tutor = ran.filter((r) => r.kind === "tutor");
  const detect = ran.filter((r) => r.kind === "detect");
  const detectQs = detect.flatMap((r) => r.questions);
  const detectFound = detectQs.filter((q) => q.found);
  const detectHits = detectQs.filter((q) => q.hit).length;
  const ok = ran.filter((r) => !r.kind || r.kind === "check");
  const correctCases = ok.filter((r) => r.expectedCorrect);
  const errorCases = ok.filter((r) => !r.expectedCorrect);
  const cat = ok.filter((r) => r.categoryRight !== null);
  const line = ok.filter((r) => r.lineRight !== null);
  return {
    cases: results.length,
    failedToRun: results.length - ran.length,
    verdictAccuracy: pct(ok.filter((r) => r.verdictRight).length, ok.length),
    falseAlarmRate: pct(correctCases.filter((r) => r.falseAlarm).length, correctCases.length),
    missedErrorRate: pct(errorCases.filter((r) => r.missed).length, errorCases.length),
    categoryMatch: pct(cat.filter((r) => r.categoryRight).length, cat.length),
    lineMatch: pct(line.filter((r) => r.lineRight).length, line.length),
    answerLeaks: ok.filter((r) => r.answerLeaks.length).length,
    labelSpoilers: ok.filter((r) => r.labelSpoilers.length).length,
    headlineLeaks: ok.filter((r) => r.headlineLeak?.length).length,
    strayQuotes: ok.filter((r) => r.strayQuotes?.length).length,
    notStemTurnedAway: `${notStem.filter((r) => r.turnedAway).length}/${notStem.length}`,
    tutorPassed: `${tutor.filter((r) => r.passed).length}/${tutor.length}`,
    // Detection, pooled over every true question in every detect case.
    detectHitRate: `${detectHits}/${detectQs.length} (${pct(detectHits, detectQs.length)})`,
    detectMeanIoU: fixed(mean(detectQs.map((q) => q.iou)), 2),
    detectMeanDy: signed(mean(detectFound.map((q) => q.dy))),
    detectMeanDx: signed(mean(detectFound.map((q) => q.dx))),
    detectMissing: detect.reduce((n, r) => n + r.missing, 0),
    detectExtra: detect.reduce((n, r) => n + r.extra, 0),
  };
}
