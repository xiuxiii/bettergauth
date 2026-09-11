import { NextResponse } from "next/server";

/**
 * Standard error response for API routes. Always logs the full error
 * server-side; only exposes the underlying detail (message + status/type) to the
 * client when DEBUG_ERRORS is set — so the owner can flip that env var (e.g. in
 * Vercel) and see the real cause without reading server logs, then turn it off.
 */
export function errorResponse(
  err: unknown,
  fallbackMessage: string,
  status = 500,
) {
  console.error(fallbackMessage, err);

  const body: { error: string; detail?: Record<string, unknown> } = {
    error: fallbackMessage,
  };

  if (process.env.DEBUG_ERRORS) {
    const e = err as { message?: unknown; status?: unknown; error?: { type?: unknown } };
    body.detail = {
      message: typeof e?.message === "string" ? e.message : String(err),
      status: e?.status,
      type: e?.error?.type,
    };
  }

  return NextResponse.json(body, { status });
}
