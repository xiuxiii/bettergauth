import "server-only";

import { NextResponse } from "next/server";

/**
 * What the owner routes (/api/owner/*) share. Every one of them is behind the
 * access gate (middleware) AND debugGate(code): a 404 to anyone else, the
 * same rule as /api/usage, so the routes don't advertise themselves, and a
 * 429 once a client has made too many wrong guesses.
 *
 * No file paths in here: the build's file tracing follows them into every
 * route that imports this module. The case files are evalCases.ts (cases,
 * eval) and the photos are read in eval/route.ts only.
 */

export const NO_STORE = { "cache-control": "no-store" };

export function notFound() {
  return NextResponse.json({ error: "Not found." }, { status: 404, headers: NO_STORE });
}
