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
/**
 * Iterate a newline-delimited JSON response as it arrives.
 *
 * A chunk boundary can fall anywhere, including mid-line and mid-UTF-8, so the
 * tail is buffered between reads and the decoder runs in streaming mode.
 */
export async function* readNdjson<T>(res: Response): AsyncGenerator<T> {
  const body = res.body;
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        // The connection dropped mid-answer, after fetch had already resolved.
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        throw new NetworkError();
      }
      const { done, value } = chunk;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line) yield JSON.parse(line) as T;
      }
    }
    const tail = buffer.trim();
    if (tail) yield JSON.parse(tail) as T;
  } finally {
    // Covers an early `break` by the caller as well as normal completion.
    reader.cancel().catch(() => {});
  }
}

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

/**
 * The connection dropped before any response arrived.
 *
 * `readApiError` only helps when a Response exists. When there is none — a phone
 * switching from wifi to cellular, the page backgrounded mid-request, a platform
 * cut-off — `fetch` rejects with the browser's own wording: "Failed to fetch"
 * (Chrome), "Load failed" (Safari), "NetworkError when attempting to fetch
 * resource" (Firefox). That text went straight onto the error card.
 *
 * It is tagged at the fetch call rather than recognised afterwards by being a
 * TypeError, because a plain bug (`undefined.foo`) is also a TypeError, and
 * dressing a real bug up as "check your connection" would hide it for good.
 */
export class NetworkError extends Error {
  constructor() {
    super("Couldn't reach MindGap. Check your connection and try again.");
    this.name = "NetworkError";
  }
}

/** `fetch`, but a dropped connection surfaces as a NetworkError. Aborts are
 *  left alone: a caller that aborted on purpose has its own handling. */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new NetworkError();
  }
}
