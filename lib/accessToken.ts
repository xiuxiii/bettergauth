/**
 * The access-gate cookie's value.
 *
 * The cookie used to hold the access code itself, so anyone who could read the
 * cookie (a shared device, a devtools screenshot, a leaked HAR file) had the
 * code. It now holds an HMAC of the code instead: proof of having unlocked,
 * from which the code can't be recovered.
 *
 * Keyed by `ACCESS_SECRET`, falling back to the code when that isn't set. Either
 * way, changing the code changes the token, so rotating the code locks out
 * everyone holding an old cookie — which is what rotating it is for.
 *
 * Uses Web Crypto (`crypto.subtle`), not node:crypto, because the middleware
 * that checks it runs on the edge runtime. The unlock route runs on Node, where
 * the same global exists.
 */

export const ACCESS_COOKIE = "stem_access";

/** The key: a dedicated secret if configured, else the server's own code. */
function signingKey(code: string): string {
  return process.env.ACCESS_SECRET?.trim() || code;
}

const encoder = new TextEncoder();

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The token for `value`, signed with the SERVER's key. The unlock route signs
 * what the student typed and compares it with the token for the real code, so
 * a submitted guess never becomes part of the key.
 */
export function accessToken(value: string, code: string): Promise<string> {
  return hmacHex(signingKey(code), `mindgap-access:v1:${value}`);
}

// The middleware checks every request, and the expected token only changes when
// the code or secret does, so it is computed once per configuration.
let cached: { code: string; secret: string; token: Promise<string> } | null = null;

/** The token a valid cookie must carry for the currently configured code. */
export function expectedToken(code: string): Promise<string> {
  const secret = process.env.ACCESS_SECRET?.trim() ?? "";
  if (!cached || cached.code !== code || cached.secret !== secret) {
    cached = { code, secret, token: accessToken(code, code) };
  }
  return cached.token;
}

/**
 * Compare two strings without an early exit on the first differing character,
 * so response timing doesn't reveal how much of a guess was right. Tokens are
 * fixed-length hex, but a length mismatch is folded in rather than returned
 * early for the same reason.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
