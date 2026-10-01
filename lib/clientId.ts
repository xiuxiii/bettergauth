import { constantTimeEqual } from "@/lib/accessToken";

/**
 * Who a request comes from, for counting only: the rate limits
 * (lib/rateLimit.ts) and the usage counts (lib/usageServer.ts).
 */

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  return (
    xff?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

let hmacKey: Promise<CryptoKey> | null = null;

/**
 * The client's id in a store: an HMAC of the IP, never the IP itself. Keyed,
 * because a plain SHA-256 of an IPv4 address can be reversed by hashing all 4
 * billion of them; without the secret this can't. The key is ACCESS_SECRET,
 * else ACCESS_CODE, else a fixed string (local dev, where nothing is shared).
 */
export async function clientId(req: Request): Promise<string> {
  hmacKey ??= crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(
      "mindgap-client-id:" +
        (process.env.ACCESS_SECRET?.trim() || process.env.ACCESS_CODE?.trim() || "dev"),
    ),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", await hmacKey, new TextEncoder().encode(clientIp(req)));
  return Array.from(new Uint8Array(mac.slice(0, 16)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The eval runner's way past the limiter and out of the usage counts: `npm run
 * eval` fires several paid calls per case and would otherwise eat the day's
 * cap and pose as students. Honoured only when the server has
 * EVAL_BYPASS_TOKEN set AND the request's x-eval-bypass header matches it; with
 * the env var unset (the default, production included) the header does nothing.
 */
export function evalBypass(req: Request): boolean {
  const token = process.env.EVAL_BYPASS_TOKEN?.trim();
  const sent = req.headers.get("x-eval-bypass");
  return !!token && !!sent && constantTimeEqual(sent, token);
}
