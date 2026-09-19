/**
 * Client-side helper for reading a failed fetch Response.
 *
 * Not every error body is JSON. A request over the platform's body limit comes
 * back as plain "Request Entity Too Large", and gateway/timeout pages are HTML.
 * Calling `res.json()` on those throws a SyntaxError, and because that throw
 * happens while building the error message, the parse error REPLACES the real
 * failure — the student saw `Unexpected token 'R', "Request En"... is not valid
 * JSON` instead of "that photo is too big". So read the body defensively and
 * map the statuses this app actually hits.
 */
export async function readApiError(
  res: Response,
  fallback: string,
): Promise<string> {
  // The platform rejects oversized bodies before our route runs, so this one
  // never arrives as JSON.
  if (res.status === 413) {
    return "That photo is too large to send. Retake it a little further back and try again.";
  }

  const raw = await res.text().catch(() => "");
  try {
    const parsed = JSON.parse(raw) as { error?: unknown };
    if (typeof parsed?.error === "string" && parsed.error.trim()) {
      return parsed.error;
    }
  } catch {
    // Not JSON — fall through to the status-based messages below.
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    return Number.isFinite(retryAfter) && retryAfter > 0
      ? `You're going a bit fast — try again in ${retryAfter}s.`
      : "You're going a bit fast — give it a few seconds and try again.";
  }
  if (res.status === 401) return "Your session expired. Reload and enter the access code.";
  if (res.status >= 500) return "The server had a problem with that one. Try again in a moment.";

  return fallback;
}
