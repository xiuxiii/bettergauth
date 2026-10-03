/**
 * Compile-time checks for the usage counter names (lib/usage.ts), run by
 * `npx tsc --noEmit`. A misspelt counter must be a type error, not a new,
 * silently empty counter.
 */
import type { Counts, UsageCounter } from "@/lib/usage";

export const ok: UsageCounter[] = [
  "session.photo",
  "verdict.error_found",
  "category.units_notation",
  "turn.go_deeper",
  "practice.incorrect",
  "error.check.502",
  "cancelled.tutor",
  "fallback.analyzeProblem",
];

// @ts-expect-error a typo is not a counter
export const typo: UsageCounter = "sesion.photo";
// @ts-expect-error nor is a verdict that doesn't exist
export const verdict: UsageCounter = "verdict.maybe";
// @ts-expect-error nor a cancelled route that doesn't exist
export const cancelled: UsageCounter = "cancelled.chat";
// @ts-expect-error nor a tutor action that doesn't exist
export const counts: Counts = { "turn.solve_it": 1 };
