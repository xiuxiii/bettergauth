/** Types for evals/format.mjs. */

import type { EvalResult } from "./runCase.mjs";

export function mark(b: boolean | null): string;
/** The lines `npm run eval` prints for one result. */
export function formatResult(r: EvalResult): string[];
/**
 * The summary block. `detectOnly` defaults to "every result is a detect
 * case" and leaves out the check/notStem/tutor lines.
 */
export function formatSummary(results: EvalResult[], options?: { detectOnly?: boolean }): string[];
