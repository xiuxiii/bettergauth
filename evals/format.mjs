/**
 * The eval report as lines of text: one result (formatResult) and the summary
 * block (formatSummary). Pure, no node imports, so the CLI (evals/run.mjs)
 * and the owner page print the same thing. Each array element is one
 * console.log; "" is a blank line.
 */

import { signed, summarize } from "./score.mjs";

/** ✓ / ✗, or · for "not scored" (null). */
export const mark = (b) => (b === null ? "·" : b ? "✓" : "✗");

/** The lines `npm run eval` prints for one case's result. */
export function formatResult(r) {
  if (r.failed) return [`! ${r.id.padEnd(31)} ${r.error}`];
  const secs = `${(r.ms / 1000).toFixed(1)}s`;
  if (r.kind === "notStem") {
    return [`${mark(r.turnedAway)} ${r.id.padEnd(31)} ${r.turnedAway ? "turned away" : "TUTORED A NON-PROBLEM"}  ${secs}`];
  }
  if (r.kind === "detect") {
    const notes = [r.missing && `missing ${r.missing}`, r.extra && `extra ${r.extra}`].filter(Boolean);
    const iouText = r.meanIoU === null ? "n/a" : r.meanIoU.toFixed(2);
    const lines = [
      `${mark(r.hits === r.total)} ${r.id.padEnd(31)} detect ${r.hits}/${r.total} hit  IoU ${iouText}  dy ${signed(r.meanDy)}  ${secs}${notes.length ? "  ← " + notes.join(", ") : ""}`,
    ];
    for (const q of r.questions) {
      if (!q.found) {
        lines.push(`  ✗ ${q.label}  not found`);
        continue;
      }
      const off = q.hit ? "" : `  dy ${signed(q.dy)}${Math.abs(q.dx) > 0.02 ? `  dx ${signed(q.dx)}` : ""}`;
      lines.push(`  ${mark(q.hit)} ${q.label}  IoU ${q.iou.toFixed(2)}${off}`);
    }
    return lines;
  }
  if (r.kind === "tutor") {
    const why = [
      r.missing.length && `missing ${r.missing.join(" | ")}`,
      r.forbidden.length && `said ${r.forbidden.join(" | ")}`,
    ].filter(Boolean);
    return [`${mark(r.passed)} ${r.id.padEnd(31)} tutor reply  ${secs}${why.length ? "  ← " + why.join("; ") : ""}`];
  }
  const notes = [
    r.falseAlarm && "FALSE ALARM",
    r.missed && "missed error",
    r.answerLeaks.length && `answer leaked in ${r.answerLeaks.join(", ")}`,
    r.labelSpoilers.length && `label "${r.label}" reveals ${r.labelSpoilers.join(", ")}`,
    r.headlineLeak?.length && `headline gives away: ${r.headlineLeak.join(", ")}`,
    r.strayQuotes?.length && `stray quote in ${r.strayQuotes.join(", ")}`,
  ].filter(Boolean);
  return [
    `${mark(r.verdictRight)} ${r.id.padEnd(31)} ${r.verdict.padEnd(17)} cat ${mark(r.categoryRight)} line ${mark(r.lineRight)}  ${secs}${notes.length ? "  ← " + notes.join("; ") : ""}`,
  ];
}

/**
 * The summary block after the per-case lines. `detectOnly` (the CLI passes
 * `--kind detect`; by default, every result is a detect case) leaves out the
 * check/notStem/tutor lines, which would be a page of n/a.
 */
export function formatSummary(
  results,
  { detectOnly = results.length > 0 && results.every((r) => r.kind === "detect") } = {},
) {
  const s = summarize(results);
  const lines = [];
  if (!detectOnly) {
    lines.push(
      "",
      `Verdict accuracy     ${s.verdictAccuracy}`,
      `False "you're wrong" ${s.falseAlarmRate}   (correct attempts judged wrong — the number to keep at 0)`,
      `Missed errors        ${s.missedErrorRate}`,
      `First-error category ${s.categoryMatch}`,
      `First-error line     ${s.lineMatch}`,
      `Answer leaks         ${s.answerLeaks} case(s)   (final answer before "Show the rest")`,
      `Label spoilers       ${s.labelSpoilers} case(s)   (concept label names the method)`,
      `Headline leaks       ${s.headlineLeaks} case(s)   (headline says what's wrong, not just where)`,
      `Stray quotes         ${s.strayQuotes} case(s)   (a field ending in a dangling ' or ")`,
      `Not-homework         ${s.notStemTurnedAway} turned away`,
      `Tutor replies        ${s.tutorPassed} passed`,
      "",
    );
  }
  if (results.some((r) => r.kind === "detect")) {
    if (detectOnly) lines.push("");
    lines.push(
      `Detection hits       ${s.detectHitRate}   (label found, centre inside, IoU >= 0.5)`,
      `Detection mean IoU   ${s.detectMeanIoU}   (a missing label counts as 0)`,
      `Detection mean dy    ${s.detectMeanDy}   (page heights; negative = boxes too high)`,
      `Detection mean dx    ${s.detectMeanDx}   (page widths; negative = boxes too far left)`,
      `Detection missing    ${s.detectMissing}   (true questions with no predicted label)`,
      `Detection extra      ${s.detectExtra}   (predicted labels matching no true question)`,
    );
  }
  if (s.failedToRun) lines.push("", `${s.failedToRun} case(s) failed to run.`);
  return lines;
}
