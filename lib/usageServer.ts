import { AsyncLocalStorage } from "node:async_hooks";
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
 * response has gone (`after`), a stream's included: it closes first and is
 * counted once closed, so counting never slows a student down or holds a
 * last frame; a slow or failing store is dropped after STORE_TIMEOUT_MS with
 * at most one log line a minute.
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

/**
 * What code deep inside a call (the providers) needs to know about the
 * request it serves, without being handed it: whether it is eval traffic.
 * Every AI route's POST runs inside usageScope, and a stream built there
 * carries the scope with it after the handler returns.
 */
const scope = new AsyncLocalStorage<{ evalRequest: boolean }>();

/** Run an AI route's POST inside its request's scope (see `scope`). */
export function usageScope<T>(req: Request, fn: () => T): T {
  return scope.run({ evalRequest: evalBypass(req) }, fn);
}

/** Count something for this request (not for eval traffic). */
export function countUsage(req: Request, counts: Counts): void {
  if (evalBypass(req)) return;
  later(() => write(counts));
}

/**
 * A call handed from DeepSeek to Claude. The provider has no request to hand,
 * so eval traffic is recognised by its usageScope: counting it would set
 * fallbacks the students never had against their DeepSeek calls (over 100%).
 */
export function countFallback(method: string): void {
  if (scope.getStore()?.evalRequest) return;
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
 * `done` covers ordinary responses; a streaming route calls `stream()` while
 * the handler is still running, and `end(status)` once its stream is over
 * (CLIENT_CLOSED when the client went first), when the verdict is finally
 * known. The write waits for `end` in `after`, so the stream never waits for
 * the store.
 */
export function trackUsage(req: Request, route: UsageRoute) {
  const start = Date.now();
  const counts: Counts = {};
  let provider: string | undefined;
  let finished = false;
  let streaming = false;
  let ended: (status: number) => void = () => {};
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
    /**
     * This response is a stream: it finishes with `end`, not `done`. Call it
     * in the handler, where `after` can still hold the write until the stream
     * has ended (outside a request, `later` just runs it).
     */
    stream() {
      if (streaming) return;
      streaming = true;
      const status = new Promise<number>((resolve) => (ended = resolve));
      later(async () => record(await status));
    },
    /** Finish an ordinary response; counted once it has been sent. */
    done<T extends Response>(res: T): T {
      if (!streaming) later(() => record(res.status));
      return res;
    },
    /** Finish a stream, after closing it; the first status given wins. */
    end(status = 200): void {
      ended(status);
    },
  };
}

export type Usage = ReturnType<typeof trackUsage>;
