import { NextResponse } from "next/server";
import { clientId as clientKey, evalBypass } from "@/lib/clientId";
import { countUsage } from "@/lib/usageServer";
import {
  FallbackStore,
  MemoryStore,
  RedisRestStore,
  admit,
  clearUnlockFails,
  noteUnlockFail,
  unlockLockedUntil,
  type LimitStore,
} from "@/lib/limitStore";
import { redisEnv } from "@/lib/redisRest";

/**
 * Rate limits for the AI routes and the access gate. Every AI route is a model
 * call, most of them vision calls on a multi-hundred-KB photo, so this is what
 * stands between a leaked access code (or one enthusiastic visitor) and the API
 * bill.
 *
 * Two windows per client (IP):
 * - per minute (RATE_LIMIT_PER_MIN, default 30): a burst brake.
 * - per day (RATE_LIMIT_PER_DAY, default 150): the actual spend ceiling. A
 *   minute cap alone still allows 43,200 calls a day from one IP.
 * Plus the gate's guess limit (10 wrong codes per 15 minutes).
 *
 * Where the counts live (lib/limitStore.ts):
 * - With UPSTASH_REDIS_REST_URL + _TOKEN (or Vercel's KV_REST_API_URL +
 *   _TOKEN), in that shared Redis: one count across every instance, surviving
 *   cold starts, so the daily cap is a real ceiling. Clients are keyed by a
 *   keyed hash of their IP (lib/clientId.ts), so the store never holds a
 *   student's address. If Redis
 *   is slow or down, each request falls back to memory (fail open) and logs.
 * - Without them, in module memory: per warm instance on Vercel and reset by a
 *   cold start, so a brake rather than a ceiling. Fine for local dev.
 */

function envLimit(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const STORE_TIMEOUT_MS = 800;
const memory = new MemoryStore();
let store: LimitStore | null = null;
let lastStoreError = 0;

/** "redis" or "memory": which store the limits are counted in. */
export function rateLimitStoreKind(): "redis" | "memory" {
  return redisEnv() ? "redis" : "memory";
}

function getStore(): LimitStore {
  if (store) return store;
  const redis = redisEnv();
  store = redis
    ? new FallbackStore(
        new RedisRestStore(redis.url, redis.token),
        memory,
        STORE_TIMEOUT_MS,
        (err) => {
          // At most once a minute: an outage would otherwise log every request.
          const now = Date.now();
          if (now - lastStoreError < 60_000) return;
          lastStoreError = now;
          console.error("[rateLimit] store unavailable, counting in memory:", err);
        },
      )
    : memory;
  return store;
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
 * `const limited = await rateLimited(req); if (limited) return limited;`
 */
export async function rateLimited(req: Request): Promise<NextResponse | null> {
  if (evalBypass(req)) return null;
  const now = Date.now();
  const verdict = await admit(
    getStore(),
    await clientKey(req),
    {
      perMin: envLimit("RATE_LIMIT_PER_MIN", 30),
      perDay: envLimit("RATE_LIMIT_PER_DAY", 150),
    },
    now,
  );
  if (verdict.ok) return null;
  countUsage(req, { [`limited.${verdict.reason}`]: 1 });

  if (verdict.reason === "minute") {
    return tooMany(
      "You're going a bit fast — give it a few seconds and try again.",
      verdict.resetAt,
      now,
    );
  }
  // Shown verbatim by readApiError. Hours, because a Retry-After of ~50,000
  // seconds means nothing to a student.
  const hours = Math.max(1, Math.ceil((verdict.resetAt - now) / 3_600_000));
  return tooMany(
    `That's today's limit for this device. It resets in about ${hours} hour${hours === 1 ? "" : "s"}.`,
    verdict.resetAt,
    now,
  );
}

/**
 * The access gate's guess limit (lib/limitStore.ts): only FAILED codes count,
 * and after 10 in 15 minutes /api/unlock answers 429 until the window ends.
 * Before this, codes could be guessed as fast as requests could be sent.
 */

/** A 429 when this client has used up its wrong guesses, else null. */
export async function unlockLocked(req: Request): Promise<NextResponse | null> {
  const now = Date.now();
  const until = await unlockLockedUntil(getStore(), await clientKey(req), now);
  if (until === null) return null;
  const minutes = Math.max(1, Math.ceil((until - now) / 60_000));
  return tooMany(
    `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    until,
    now,
  );
}

/** Count a wrong code against this client. */
export async function noteUnlockFailure(req: Request): Promise<void> {
  await noteUnlockFail(getStore(), await clientKey(req), Date.now());
}

/** A correct code: start this client's count over. */
export async function clearUnlockFailures(req: Request): Promise<void> {
  await clearUnlockFails(getStore(), await clientKey(req));
}
