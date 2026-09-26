import { NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/accessToken";

/**
 * In-memory rate limiter for the AI routes. Every route it guards is a model
 * call, most of them vision calls on a multi-hundred-KB photo, so this is what
 * stands between a leaked access code (or one enthusiastic visitor) and the API
 * bill.
 *
 * Two windows per client key (IP):
 * - per minute (RATE_LIMIT_PER_MIN, default 30): a burst brake.
 * - per day (RATE_LIMIT_PER_DAY, default 150): the actual spend ceiling. A
 *   minute cap alone still allows 43,200 calls a day from one IP.
 *
 * Only ADMITTED requests count toward the day. Someone hammering past the
 * minute brake is already getting 429s; letting those rejections also burn the
 * day's allowance would lock a real student out for 24 hours over one burst.
 *
 * TODO(shared store): this is module memory, so on Vercel both windows are per
 * WARM INSTANCE — a cold start resets them and parallel instances each keep
 * their own counts. Good enough as a brake for a gated, low-traffic app; not a
 * real global cap. Before the app goes public, move both counters to a shared
 * store (Upstash Redis via @upstash/ratelimit, or Vercel KV) keyed the same way.
 * The call sites (`const limited = rateLimited(req)`) won't need to change,
 * though the function will become async.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

function envLimit(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

type Bucket = { count: number; resetAt: number };
const minuteBuckets = new Map<string, Bucket>();
const dayBuckets = new Map<string, Bucket>();

function prune(map: Map<string, Bucket>, now: number) {
  if (map.size < 5000) return;
  for (const [k, b] of map) if (now >= b.resetAt) map.delete(k);
}

function bucket(map: Map<string, Bucket>, key: string, now: number, windowMs: number) {
  let b = map.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    map.set(key, b);
  }
  return b;
}

function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (
    xff?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

/**
 * The eval runner's way past the limiter: `npm run eval` fires several paid
 * calls per case and would otherwise eat the day's cap. Honoured only when the
 * server has EVAL_BYPASS_TOKEN set AND the request's x-eval-bypass header
 * matches it; with the env var unset (the default, production included) the
 * header does nothing.
 */
function evalBypass(req: Request): boolean {
  const token = process.env.EVAL_BYPASS_TOKEN?.trim();
  const sent = req.headers.get("x-eval-bypass");
  return !!token && !!sent && constantTimeEqual(sent, token);
}

function tooMany(message: string, resetAt: number, now: number): NextResponse {
  const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/**
 * Returns a 429 response when the caller is over either limit, or null to
 * proceed. Call at the top of a route's handler:
 * `const limited = rateLimited(req); if (limited) return limited;`
 */
export function rateLimited(req: Request): NextResponse | null {
  if (evalBypass(req)) return null;
  const now = Date.now();
  prune(minuteBuckets, now);
  prune(dayBuckets, now);
  const key = clientKey(req);

  // Minute brake first. Rejections here count toward the minute (so a hammering
  // client stays blocked) but never toward the day.
  const minute = bucket(minuteBuckets, key, now, MINUTE_MS);
  minute.count++;
  if (minute.count > envLimit("RATE_LIMIT_PER_MIN", 30)) {
    return tooMany(
      "You're going a bit fast — give it a few seconds and try again.",
      minute.resetAt,
      now,
    );
  }

  const day = bucket(dayBuckets, key, now, DAY_MS);
  if (day.count >= envLimit("RATE_LIMIT_PER_DAY", 150)) {
    // Shown verbatim by readApiError. Hours, because a Retry-After of ~50,000
    // seconds means nothing to a student.
    const hours = Math.max(1, Math.ceil((day.resetAt - now) / 3_600_000));
    return tooMany(
      `That's today's limit for this device. It resets in about ${hours} hour${hours === 1 ? "" : "s"}.`,
      day.resetAt,
      now,
    );
  }
  day.count++;
  return null;
}

/**
 * Guess limit for the access gate. Only FAILED codes count, per client key:
 * after UNLOCK_MAX_FAILS wrong codes in UNLOCK_WINDOW_MS, /api/unlock answers
 * 429 until the window ends. Before this, codes could be guessed as fast as
 * requests could be sent. A correct code clears the count.
 */
const UNLOCK_MAX_FAILS = 10;
const UNLOCK_WINDOW_MS = 15 * 60_000;
const unlockFails = new Map<string, Bucket>();

/** A 429 when this client has used up its wrong guesses, else null. */
export function unlockLocked(req: Request): NextResponse | null {
  const now = Date.now();
  prune(unlockFails, now);
  const b = unlockFails.get(clientKey(req));
  if (!b || now >= b.resetAt || b.count < UNLOCK_MAX_FAILS) return null;
  const minutes = Math.max(1, Math.ceil((b.resetAt - now) / 60_000));
  return tooMany(
    `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    b.resetAt,
    now,
  );
}

/** Count a wrong code against this client. */
export function noteUnlockFailure(req: Request): void {
  const now = Date.now();
  bucket(unlockFails, clientKey(req), now, UNLOCK_WINDOW_MS).count++;
}

/** A correct code: start this client's count over. */
export function clearUnlockFailures(req: Request): void {
  unlockFails.delete(clientKey(req));
}
