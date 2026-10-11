/**
 * The attempt gate (ATTEMPT_SEEN_NOTE in lib/ai/shared.ts): when the model
 * sees no attempt at the problem in what was sent (a photo of a desk, a blank
 * page), check-work and practice marking refuse with this code instead of
 * marking it, so nothing is invented and a practice problem's solution isn't
 * spent on a photo that held no working.
 */
export const NO_WORK_SEEN = "no_work_seen";

/** What the student reads; the photo wording when the attempt was a photo. */
export function noWorkMessage(photo: boolean): string {
  return photo
    ? "I can't see your working for this problem in that photo. Take another with your working in the frame."
    : "That doesn't look like an attempt at this problem. Write out your working, or send a photo of it.";
}

/**
 * The refusal for a marking result, or null to mark it as usual. Only an
 * explicit `attemptSeen: false` refuses (fail open, like hasStemContent), and
 * only when something was sent: "just show me the solution" sends nothing and
 * is never refused.
 */
export function noWorkRefusal(
  attempt: { text?: string; imageDataUrl?: string },
  result: { attemptSeen?: boolean },
): { code: typeof NO_WORK_SEEN; error: string } | null {
  const photo = !!attempt.imageDataUrl;
  const sent = photo || !!attempt.text?.trim();
  if (!sent || result.attemptSeen !== false) return null;
  return { code: NO_WORK_SEEN, error: noWorkMessage(photo) };
}
