/**
 * The access gate: which codes exist, when each expires, and the cookie that
 * proves someone unlocked with one.
 *
 * Codes come from env, no database:
 *   ACCESS_CODES = "maya2026:2026-10-31, studygroup:2026-12-20, teacher:never"
 *   ACCESS_CODE  = the older single shared code; treated as `code:never`.
 * The gate is off only when both are unset. Add or cancel a code by editing the
 * list and redeploying.
 *
 * The cookie never contains a code. It is `v2.<id>.<sig>`: `id` is a short HMAC
 * of the code (it says WHICH code without revealing it) and `sig` signs the id.
 * The middleware looks the id up in the CURRENT list and reads the expiry from
 * there, not from the cookie. So removing a line locks that code's holders out
 * on their next request, extending a date extends existing cookies, and a
 * passing date locks out people already inside, not just new logins.
 *
 * Web Crypto (`crypto.subtle`), not node:crypto: the middleware that checks the
 * cookie runs on the edge runtime. The unlock route runs on Node, which has the
 * same global.
 */

export const ACCESS_COOKIE = "stem_access";

/** Longest a cookie lives, even for a code that never expires. */
export const MAX_COOKIE_SECONDS = 60 * 60 * 24 * 30;

export interface AccessCode {
  /** Short HMAC of the code; what the cookie carries. */
  id: string;
  code: string;
  /** Epoch ms the code stops working, or null for never. */
  expiresAt: number | null;
}

export interface AccessConfig {
  /** False only when neither ACCESS_CODE nor ACCESS_CODES is set. */
  enabled: boolean;
  codes: AccessCode[];
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
 * Compare two strings without an early exit on the first differing character,
 * so response timing doesn't reveal how much of a guess was right.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * The signing key. ACCESS_SECRET when set — recommended with ACCESS_CODES,
 * because without it the key is derived from the codes themselves and any edit
 * to the list logs everyone out. Falls back to ACCESS_CODE (which keeps the
 * previous deploy's cookies valid), then to the sorted list.
 */
function signingKey(single: string, listed: string[]): string {
  return (
    process.env.ACCESS_SECRET?.trim() ||
    single ||
    [...listed].sort().join("\n")
  );
}

/**
 * Parse one expiry. A bare date is inclusive: "2026-10-31" works until the end
 * of that day in UTC. Returns undefined for anything unparseable.
 */
function parseExpiry(raw: string): number | null | undefined {
  const v = raw.trim();
  if (v.toLowerCase() === "never") return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (day) {
    const [, y, m, d] = day.map(Number);
    const start = Date.UTC(y, m - 1, d);
    // Reject impossible dates rather than letting Date roll "02-30" forward.
    if (new Date(start).getUTCDate() !== d) return undefined;
    return start + 24 * 60 * 60 * 1000;
  }
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

let cache: { raw: string; config: Promise<AccessConfig> } | null = null;

/** The configured codes. Cached per env value: the middleware asks every request. */
export function accessConfig(): Promise<AccessConfig> {
  const single = process.env.ACCESS_CODE?.trim() ?? "";
  const list = process.env.ACCESS_CODES?.trim() ?? "";
  const secret = process.env.ACCESS_SECRET?.trim() ?? "";
  const raw = `${single}\u0000${list}\u0000${secret}`;
  if (cache?.raw !== raw) cache = { raw, config: buildConfig(single, list) };
  return cache.config;
}

async function buildConfig(single: string, list: string): Promise<AccessConfig> {
  const parsed: { code: string; expiresAt: number | null }[] = [];
  for (const entry of list.split(/[,\n]/).map((e) => e.trim()).filter(Boolean)) {
    // Split on the FIRST colon: an ISO datetime expiry has colons of its own.
    const colon = entry.indexOf(":");
    const code = colon > 0 ? entry.slice(0, colon).trim() : "";
    const expiresAt = colon > 0 ? parseExpiry(entry.slice(colon + 1)) : undefined;
    if (!code || expiresAt === undefined) {
      // Logged without the entry itself, which may be a real code.
      console.warn("[access] skipping an ACCESS_CODES entry that isn't `code:YYYY-MM-DD` or `code:never`");
      continue;
    }
    if (parsed.some((p) => p.code === code)) {
      console.warn("[access] duplicate code in ACCESS_CODES; the first entry wins");
      continue;
    }
    parsed.push({ code, expiresAt });
  }
  if (single && !parsed.some((p) => p.code === single)) {
    parsed.push({ code: single, expiresAt: null });
  }

  // Enabled if EITHER variable is set, even when nothing in it parsed. A typo
  // in the list must leave the gate closed, never silently open the app.
  const enabled = Boolean(single || list);
  const key = signingKey(single, parsed.map((p) => p.code));
  const codes = await Promise.all(
    parsed.map(async (p) => ({
      ...p,
      id: (await hmacHex(key, `mindgap-access:id:${p.code}`)).slice(0, 16),
    })),
  );
  if (enabled && codes.length === 0) {
    console.warn("[access] ACCESS_CODES has no usable entries: the gate is closed to everyone");
  }
  return { enabled, codes };
}

async function keyFor(): Promise<string> {
  const { codes } = await accessConfig();
  return signingKey(process.env.ACCESS_CODE?.trim() ?? "", codes.map((c) => c.code));
}

export function isExpired(code: AccessCode, now = Date.now()): boolean {
  return code.expiresAt !== null && now >= code.expiresAt;
}

/** Seconds a fresh cookie should live: 30 days, or less if the code ends sooner. */
export function cookieMaxAge(code: AccessCode, now = Date.now()): number {
  if (code.expiresAt === null) return MAX_COOKIE_SECONDS;
  return Math.max(0, Math.min(MAX_COOKIE_SECONDS, Math.floor((code.expiresAt - now) / 1000)));
}

/** The cookie value for someone who unlocked with `code`. */
export async function cookieFor(code: AccessCode): Promise<string> {
  const sig = await hmacHex(await keyFor(), `mindgap-access:v2:${code.id}`);
  return `v2.${code.id}.${sig}`;
}

/**
 * Match a submitted code against EVERY configured code, with no early exit, so
 * timing doesn't reveal which (or whether any) code was close. Tokens are
 * compared, not the raw strings.
 */
export async function matchCode(submitted: string): Promise<AccessCode | null> {
  const { codes } = await accessConfig();
  // No usable codes (a mistyped ACCESS_CODES): nothing can match, and there is
  // no key to sign with — Web Crypto rejects a zero-length HMAC key, which
  // turned a typo into a 500 instead of "Incorrect code".
  if (codes.length === 0) return null;
  const key = await keyFor();
  const guess = await hmacHex(key, `mindgap-access:match:${submitted}`);
  let found: AccessCode | null = null;
  for (const c of codes) {
    const token = await hmacHex(key, `mindgap-access:match:${c.code}`);
    if (constantTimeEqual(guess, token) && !found) found = c;
  }
  return found;
}

export type CookieCheck =
  | { ok: true; code: AccessCode | null }
  | { ok: false; reason: "missing" | "invalid" | "expired" };

/**
 * Check a cookie against the CURRENT configuration. Expiry comes from the env
 * list, so edits to it apply to people already inside.
 */
export async function checkCookie(value: string | undefined, now = Date.now()): Promise<CookieCheck> {
  if (!value) return { ok: false, reason: "missing" };
  const { codes } = await accessConfig();
  // Same guard as matchCode: no codes, nothing to admit, no key to verify with.
  if (codes.length === 0) return { ok: false, reason: "invalid" };

  if (value.startsWith("v2.")) {
    const [, id, sig] = value.split(".");
    if (!id || !sig) return { ok: false, reason: "invalid" };
    const expected = await hmacHex(await keyFor(), `mindgap-access:v2:${id}`);
    if (!constantTimeEqual(sig, expected)) return { ok: false, reason: "invalid" };
    const code = codes.find((c) => c.id === id);
    if (!code) return { ok: false, reason: "invalid" }; // removed from the list
    if (isExpired(code, now)) return { ok: false, reason: "expired" };
    return { ok: true, code };
  }

  // Cookies issued before per-code expiry (a bare HMAC of the single
  // ACCESS_CODE). Still honoured while that code is configured, so this deploy
  // doesn't force everyone to re-enter it; they upgrade on their next unlock.
  const single = process.env.ACCESS_CODE?.trim();
  if (single) {
    const legacy = await hmacHex(
      process.env.ACCESS_SECRET?.trim() || single,
      `mindgap-access:v1:${single}`,
    );
    if (constantTimeEqual(value, legacy)) return { ok: true, code: null };
  }
  return { ok: false, reason: "invalid" };
}
