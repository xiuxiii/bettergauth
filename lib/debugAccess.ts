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
