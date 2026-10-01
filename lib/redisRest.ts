/**
 * The one Redis client: Upstash's REST API, which is what Vercel's KV / Redis
 * integration provisions. A pipeline is one POST of commands to `/pipeline`;
 * plain fetch, no SDK. Used by the rate limits (lib/limitStore.ts) and the
 * usage counts (lib/usage.ts). Pure: no Next, so `npm test` can import it.
 */

export type RedisCommand = (string | number)[];
type PipelineReply = { result?: unknown; error?: string }[];

/** The store's URL and token from env, or null when none is configured. */
export function redisEnv(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim();
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

/** Run commands in one round trip; the results, in order. Throws on any error. */
export async function redisPipeline(
  url: string,
  token: string,
  commands: RedisCommand[],
  fetchImpl: typeof fetch = fetch,
): Promise<unknown[]> {
  const res = await fetchImpl(`${url.replace(/\/+$/, "")}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands.map((c) => c.map(String))),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const replies = (await res.json()) as PipelineReply;
  if (!Array.isArray(replies)) throw new Error("redis: unexpected reply");
  const failed = replies.find((r) => r?.error);
  if (failed) throw new Error(`redis: ${failed.error}`);
  return replies.map((r) => r.result);
}

/** Race a store call against a timeout, so a slow store never holds a request. */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
