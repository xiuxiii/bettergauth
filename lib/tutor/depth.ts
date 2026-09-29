import type { TutorAction } from "@/lib/tutor/types";

/**
 * Does this tutor turn deserve thinking?
 *
 * DeepSeek answers without thinking by default: high-school maths and science
 * don't need it, and its reasoning is slow and billed. The prompts make every
 * answer concept-first either way. Thinking is for the turns where the student
 * asks for DEPTH: "Go deeper", "Explain why", or a typed question that asks
 * why or how something works, where a shallow answer would be the failure.
 * Hints, "continue", solutions and practice stay fast.
 *
 * Pure and React-free so it is unit-tested (tests/depth.test.mjs).
 */
export function wantsDeepThought(action: TutorAction, studentText?: string): boolean {
  if (action === "go_deeper" || action === "explain") return true;
  if (action !== "ask" && action !== "question") return false;
  return DEEP_QUESTION.test(studentText ?? "");
}

/**
 * Phrasings that ask for understanding rather than a next step. Word-bounded,
 * so "whyever" or "however" don't count, and deliberately short: a missed deep
 * question still gets a concept-first answer, just without the extra thought.
 */
const DEEP_QUESTION = new RegExp(
  [
    String.raw`\bwhy\b`,
    // "How does friction depend on…" asks how it works; "how do I do b"
    // asks for the next step, which a hint answers fine.
    String.raw`\bhow (come|does|is|are|would)\b`,
    String.raw`\bhow (do|can) (?!i\b|you\b|we\b)`,
    String.raw`\bwhat (does|do) .{1,60} mean\b`,
    String.raw`\bwhat if\b`,
    String.raw`\bwhat would happen\b`,
    String.raw`\bwhere does .{1,60} come from\b`,
    String.raw`\bdifference between\b`,
    String.raw`\bintuiti`,
    String.raw`\bderiv(e|ation)\b`,
    String.raw`\bprove\b|\bproof\b`,
    String.raw`\bexplain\b`,
    String.raw`\b(don'?t|do not) (get|understand)\b`,
    String.raw`\bdoesn'?t make sense\b`,
    String.raw`\bconfus`,
  ].join("|"),
  "i",
);
