import { NextResponse } from "next/server";

/**
 * Lightweight in-memory rate limiter for the AI routes — a burst brake so a
 * single visitor (even one past the access gate, or a leaked code) can't drain
 * the API key by hammering requests.
 *
 * Fixed window per client key (IP), counted in module memory. On Vercel this is
 * per warm serverless instance, not distributed — a strong brake for a gated,
 * low-traffic app, not an airtight global cap. Swap in a shared store
 * (Upstash/Vercel KV) when the app goes public. Tune the ceiling without a code
 * change via the RATE_LIMIT_PER_MIN env var.
 */

const WINDOW_MS = 60_000;

function maxPerWindow(): number {
  const n = Number(process.env.RATE_LIMIT_PER_MIN);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function prune(now: number) {
  if (buckets.size < 5000) return;
  for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
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
 * Returns a 429 response when the caller is over the limit, or null to proceed.
 * Call at the top of a route's handler: `const limited = rateLimited(req); if
 * (limited) return limited;`
 */
export function rateLimited(req: Request): NextResponse | null {
  const now = Date.now();
  prune(now);

  const key = clientKey(req);
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(key, b);
  }
  b.count++;

  if (b.count > maxPerWindow()) {
    const retryAfter = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    return NextResponse.json(
      { error: "You're going a bit fast — give it a few seconds and try again." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }
  return null;
}
