/**
 * Accounts are for 13 and up: below that, US law (COPPA) and similar rules
 * elsewhere require verified parental consent before keeping a child's data.
 * The student gives a birth month and year; only "old enough, on this date"
 * is stored (profiles.age_ok_at), never the birth date.
 *
 * Conservative on purpose: someone born in the current month 13 years ago
 * might not have had their birthday yet, so they count as 12 until the month
 * is over. Pure, so `npm test` checks it.
 */
export const MIN_AGE = 13;

export type AgeCheck =
  | { ok: true }
  | { ok: false; reason: "invalid" | "too_young" };

export function checkAge(birthYear: unknown, birthMonth: unknown, now: Date = new Date()): AgeCheck {
  const y = Number(birthYear);
  const m = Number(birthMonth); // 1-12
  const thisYear = now.getUTCFullYear();
  const thisMonth = now.getUTCMonth() + 1;
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) return { ok: false, reason: "invalid" };
  if (y < thisYear - 120 || y > thisYear || (y === thisYear && m > thisMonth)) return { ok: false, reason: "invalid" };
  const years = thisYear - y;
  const old = years > MIN_AGE || (years === MIN_AGE && thisMonth > m);
  return old ? { ok: true } : { ok: false, reason: "too_young" };
}
