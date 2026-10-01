import { after } from "next/server";
import { clientId, evalBypass } from "@/lib/clientId";
import { redisEnv, withTimeout } from "@/lib/redisRest";
import {
  MemoryUsageStore,
  RedisUsageStore,
  callCounts,
  dayKey,
  type Counts,
  type UsageCounter,
  type UsageRoute,
  type UsageStore,
} from "@/lib/usage";

/**
 * The routes' side of the usage counts (lib/usage.ts). Writes happen after the
 * response has gone (`after`), or at the end of a stream once its last frame
 * is out, so counting never slows a student down; a slow or failing store is
 * dropped after STORE_TIMEOUT_MS with at most one log line a minute.
 */

const STORE_TIMEOUT_MS = 800;
let store: UsageStore | null = null;
let lastError = 0;

export function usageStoreKind(): "redis" | "memory" {
  return redisEnv() ? "redis" : "memory";
}

export function usageStore(): UsageStore {
  if (store) return store;
  const redis = redisEnv();
  store = redis ? new RedisUsageStore(redis.url, redis.token) : new MemoryUsageStore();
  return store;
}

async function write(counts: Counts, deviceId?: string): Promise<void> {
  try {
    await withTimeout(usageStore().add(dayKey(Date.now()), counts, deviceId), STORE_TIMEOUT_MS);
  } catch (err) {
    const now = Date.now();
    if (now - lastError < 60_000) return;
    lastError = now;
    console.error("[usage] store unavailable, counts dropped:", err);
  }
}

/** After the response when there's a request to hang it on, else right away. */
function later(task: () => Promise<void>) {
  try {
    after(task);
  } catch {
    // Outside a request's scope (a stream that outlived its handler).
    void task();
  }
}

/** Count something for this request (not for eval traffic). */
export function countUsage(req: Request, counts: Counts): void {
  if (evalBypass(req)) return;
  later(() => write(counts));
}

/**
 * A call handed from DeepSeek to Claude. Counted without the request, so
 * eval traffic's fallbacks are included too.
 */
export function countFallback(method: string): void {
  later(() => write({ [`fallback.${method}`]: 1 } as Counts));
}

/**
 * One AI call, from the top of its route to its response. Collect counters as
 * the call goes, then finish with the status:
 *
 *   const usage = trackUsage(req, "analyze");
 *   ...
 *   usage.add("session.photo");
 *   return usage.done(NextResponse.json(analysis));
 *
 * `done` covers ordinary responses; a streaming route calls `stream()` and
 * awaits `flush` at the end of its stream, when the verdict is finally known.
 */
export function trackUsage(req: Request, route: UsageRoute) {
  const start = Date.now();
  const counts: Counts = {};
  let provider: string | undefined;
  let finished = false;
  let streaming = false;
  const skip = evalBypass(req);
  const device = skip ? Promise.resolve(undefined) : clientId(req).catch(() => undefined);

  async function record(status: number) {
    if (finished || skip) return;
    finished = true;
    const ms = Date.now() - start;
    const all: Counts = { ...counts, ...callCounts(route, ms, status, provider) };
    console.log(
      "[usage]",
      JSON.stringify({ route, ms, status, provider, ...counts }),
    );
    await write(all, await device);
  }

  return {
    add(counter: UsageCounter, n = 1) {
      counts[counter] = (counts[counter] ?? 0) + n;
    },
    /** The tutor picked for this call (its `name`). */
    provider<P extends { name: string }>(p: P): P {
      provider = p.name;
      return p;
    },
    /** This response is a stream: it finishes with `flush`, not `done`. */
    stream() {
      streaming = true;
    },
    /** Finish an ordinary response; counted once it has been sent. */
    done<T extends Response>(res: T): T {
      if (!streaming) later(() => record(res.status));
      return res;
    },
    /** Finish a stream; awaited just before the stream closes. */
    flush(status = 200): Promise<void> {
      return record(status);
    },
  };
}

export type Usage = ReturnType<typeof trackUsage>;
