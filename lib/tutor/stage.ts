/**
 * Where a tutoring session stands, and how far a diagnosis has been revealed.
 *
 * Pure functions over the transcript, with no React, so the chips, the problem
 * card and the feedback card all read one answer, and the logic can be checked
 * on its own.
 */

import type { WorkCheck } from "@/lib/tutor/types";

/**
 * - fresh: nothing checked yet.
 * - diagnosed: the latest check found something, and the rest of the way has
 *   not been revealed.
 * - resolved: a correct check, the rest revealed, or a worked solution shown.
 *
 * Most students never reach "resolved" formally: they take a hint, finish on
 * paper and close the app. So nothing that matters mid-problem may be gated on
 * it; it only unlocks things that would otherwise spoil the problem, like the
 * key idea.
 */
export type SessionStage = "fresh" | "diagnosed" | "resolved";

/**
 * How far a check's pieces are shown. 0 = headline, flagged line and nudge;
 * 1 = plus what the work assumes and the fix; 2 = plus the rest of the way.
 */
export type RevealStep = 0 | 1 | 2;

/** The parts of a transcript message the stage depends on. */
export interface StageMessage {
  workCheck?: WorkCheck;
  reveal?: RevealStep;
  solution?: unknown;
}

/** Whether a check has anything behind "Show me the fix". */
export function hasFix(check: WorkCheck): boolean {
  const e = check.firstError;
  return !!e && !!(e.diagnosis.trim() || e.fix.trim());
}

/** Whether a check has anything behind "Show the rest". */
export function hasRest(check: WorkCheck): boolean {
  return !!check.continueFrom.trim();
}

/**
 * Where a check starts. A correct check has nothing to hide. Direct mode skips
 * the nudge and opens on the fix, but the final answer still waits behind
 * "Show the rest".
 */
export function initialReveal(check: WorkCheck, direct: boolean): RevealStep {
  if (check.verdict === "correct") return 2;
  return direct && hasFix(check) ? 1 : 0;
}

/**
 * The step after `from`, skipping any step that has nothing in it: a check
 * with no fix goes straight to the rest. Never a dead end.
 */
export function nextReveal(check: WorkCheck, from: RevealStep): RevealStep {
  if (from === 0 && hasFix(check)) return 1;
  return 2;
}

/** True once there is nothing left to reveal. */
export function fullyRevealed(check: WorkCheck, reveal: RevealStep): boolean {
  if (reveal === 2) return true;
  // Nothing behind the remaining buttons, so there are no buttons.
  return !hasRest(check) && (reveal === 1 || !hasFix(check));
}

export function sessionStage(messages: readonly StageMessage[]): SessionStage {
  if (messages.some((m) => m.solution)) return "resolved";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m.workCheck) continue;
    if (m.workCheck.verdict === "correct") return "resolved";
    return fullyRevealed(m.workCheck, m.reveal ?? 0) ? "resolved" : "diagnosed";
  }
  return "fresh";
}

/** The parts of a transcript message `hintGiven` reads. */
export interface HintMessage {
  role?: string;
  opener?: boolean;
  action?: string;
}

/**
 * Whether the student has had a hint: the opening nudge (itself a hint) or a
 * tapped Hint. After a hint the natural next ask is "why?", so the chips put
 * Explain why in the bar and move Hint into More.
 */
export function hintGiven(messages: readonly HintMessage[]): boolean {
  return messages.some(
    (m) => m.role === "tutor" && (m.opener || m.action === "hint"),
  );
}
