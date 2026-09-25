import { NextResponse } from "next/server";

/**
 * Standard error response for API routes. Always logs the full error
 * server-side; only exposes the underlying detail (message + status/type) to the
 * client when DEBUG_ERRORS is set — so the owner can flip that env var (e.g. in
 * Vercel) and see the real cause without reading server logs, then turn it off.
 *
 * Upstream failures the student can't fix by retrying are classified first, so
 * they don't get flattened into a generic 500 with "Please try again." A paused
 * account answering "Could not analyze the problem. Please try again." sends the
 * student into a retry loop against a wall.
 */

/**
 * The parts of an Anthropic SDK `APIError` we read. Matched structurally rather
 * than with `instanceof` so a wrapped or re-thrown error still classifies.
 */
type UpstreamError = {
  status?: unknown;
  /** `error.type` from the response body, e.g. "rate_limit_error". */
  type?: unknown;
  message?: unknown;
  headers?: { get?: (name: string) => string | null };
  /** The raw JSON body: { type: "error", error: { type, message, details } }. */
  error?: {
    error?: {
      type?: unknown;
      message?: unknown;
      details?: { error_code?: unknown };
    };
  };
};

type Classified = {
  status: number;
  /** Machine-readable reason, visible to the client without DEBUG_ERRORS. */
  code: string;
  message: string;
  retryAfter?: string;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Identify the upstream conditions worth reporting honestly.
 *
 * Spend limits arrive two different ways (docs: api/rate-limits):
 *   - a limit the owner set        -> 400 invalid_request_error, message begins
 *                                     "You have reached your specified API usage limits"
 *                                     (or "...specified workspace API usage limits")
 *   - the account tier's own cap   -> 429 rate_limit_error with
 *                                     details.error_code "enforced_spend_limit_reached"
 *                                     and NO retry-after; paused until 00:00 UTC
 *                                     on the 1st of next month
 * Neither is retryable, and the second looks exactly like an ordinary rate limit
 * unless you read the detail code.
 */
function classify(err: unknown): Classified | null {
  if (!err || typeof err !== "object") return null;
  const e = err as UpstreamError;
  const status = typeof e.status === "number" ? e.status : undefined;
  if (status === undefined) return null;

  const body = e.error?.error;
  const bodyType = str(e.type) || str(body?.type);
  const bodyMessage = str(body?.message) || str(e.message);
  const errorCode = str(body?.details?.error_code);
  const retryAfter = e.headers?.get?.("retry-after") ?? undefined;

  const spendPaused =
    // The tier's monthly cap.
    errorCode === "enforced_spend_limit_reached" ||
    // A limit the owner set in Console → Billing → Spend limits.
    /You have reached your specified (workspace )?API usage limits/i.test(
      bodyMessage,
    ) ||
    // Card declined, credits exhausted, org suspended.
    bodyType === "billing_error";

  if (spendPaused) {
    return {
      status: 402,
      code: "spend_limit",
      message:
        "MindGap has reached its usage budget, so the tutor is paused. Retrying won't help — this needs the account's spend limit raised.",
    };
  }

  if (status === 429 || bodyType === "rate_limit_error") {
    return {
      status: 429,
      code: "upstream_rate_limit",
      message: retryAfter
        ? `The tutor is busy right now. Try again in ${retryAfter}s.`
        : "The tutor is busy right now. Give it a few seconds and try again.",
      retryAfter: retryAfter ?? undefined,
    };
  }

  if (status === 529 || bodyType === "overloaded_error") {
    return {
      status: 503,
      code: "upstream_overloaded",
      message: "The tutor is overloaded right now. Try again in a moment.",
    };
  }

  // A reserved provider slot (ProviderNotImplementedError in lib/ai/types.ts).
  if (bodyType === "not_implemented_error") {
    return {
      status: 501,
      code: "provider_not_implemented",
      message:
        "The selected AI provider isn't wired up yet. Set AI_PROVIDER back to anthropic on the server.",
    };
  }

  if (status === 401 || bodyType === "authentication_error") {
    return {
      status: 503,
      code: "upstream_auth",
      message:
        "The tutor isn't set up correctly: its API key was rejected. This needs fixing on the server, not a retry.",
    };
  }

  return null;
}

export function errorResponse(
  err: unknown,
  fallbackMessage: string,
  status = 500,
) {
  console.error(fallbackMessage, err);

  const classified = classify(err);
  // An explicit status from the caller wins; otherwise the classification does.
  const outStatus = status === 500 && classified ? classified.status : status;

  const body: {
    error: string;
    code?: string;
    detail?: Record<string, unknown>;
  } = {
    error: classified ? classified.message : fallbackMessage,
  };
  if (classified) body.code = classified.code;

  if (process.env.DEBUG_ERRORS) {
    const e = err as UpstreamError;
    body.detail = {
      message: typeof e?.message === "string" ? e.message : String(err),
      status: e?.status,
      type: e?.type ?? e?.error?.error?.type,
      errorCode: e?.error?.error?.details?.error_code,
    };
  }

  const headers = classified?.retryAfter
    ? { "Retry-After": classified.retryAfter }
    : undefined;

  return NextResponse.json(body, { status: outStatus, headers });
}
