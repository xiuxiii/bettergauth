import { constantTimeEqual } from "@/lib/accessToken";

/**
 * Whether a request may see debug detail (the raw model output behind
 * `?debug=boxes`, the provider details on /api/health).
 *
 * Always outside production, so local dev just works. In production only when
 * the server has DEBUG_CODE set AND the request presents it; unset (the
 * default) means never — this output was reachable by anyone before.
 */
export function debugAllowed(presented: unknown): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const code = process.env.DEBUG_CODE?.trim();
  return !!code && typeof presented === "string" && constantTimeEqual(presented, code);
}

export type DebugCheck = "allowed" | "denied" | "locked";

/**
 * debugAllowed for a route anyone can reach with `?code=`: in production a
 * WRONG code is a wrong guess, counted against the same per-client limit as
 * the access gate's codes (lib/rateLimit.ts debugGate), so DEBUG_CODE can't
 * be guessed at /api/health as fast as requests can be sent. Past the limit
 * every code, right or wrong, gets "locked", like /api/unlock. A request
 * with no code is an ordinary visitor, never counted; nor is any code when
 * DEBUG_CODE is unset, since there is nothing to guess.
 */
export async function checkDebugCode(
  presented: unknown,
  guesses: { locked(): Promise<boolean>; fail(): Promise<void> },
): Promise<DebugCheck> {
  if (process.env.NODE_ENV !== "production") return "allowed";
  if (typeof presented !== "string" || !presented) return "denied";
  if (!process.env.DEBUG_CODE?.trim()) return "denied";
  if (await guesses.locked()) return "locked";
  if (debugAllowed(presented)) return "allowed";
  await guesses.fail();
  return "denied";
}
