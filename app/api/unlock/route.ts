import { NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  accessConfig,
  cookieFor,
  cookieMaxAge,
  isExpired,
  matchCode,
} from "@/lib/accessToken";
import {
  clearUnlockFailures,
  noteUnlockFailure,
  unlockLocked,
} from "@/lib/rateLimit";

export const runtime = "nodejs";

/**
 * POST /api/unlock  { code }
 * Checks the code against every configured access code (ACCESS_CODES and the
 * older single ACCESS_CODE) and, on a live match, sets an httpOnly cookie the
 * middleware admits. The cookie names the code by an HMAC id and never contains
 * it; it lives 30 days or until the code expires, whichever is sooner.
 */
export async function POST(req: Request) {
  // Gate disabled — nothing to unlock.
  if (!(await accessConfig()).enabled) return NextResponse.json({ ok: true });

  // Checked before the code is even looked at: past the limit, a right guess
  // gets the same 429 as a wrong one, so the limit can't be probed around.
  const locked = unlockLocked(req);
  if (locked) return locked;

  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const submitted = typeof body?.code === "string" ? body.code.trim() : "";
  const match = submitted ? await matchCode(submitted) : null;

  if (!match) {
    noteUnlockFailure(req);
    return NextResponse.json({ error: "Incorrect code." }, { status: 401 });
  }
  // Saying so is kinder than "incorrect": they were given this code, and need
  // to know to ask for a new one rather than retype it.
  if (isExpired(match)) {
    noteUnlockFailure(req);
    return NextResponse.json({ error: "That code has expired." }, { status: 401 });
  }
  clearUnlockFailures(req);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, await cookieFor(match), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: cookieMaxAge(match),
  });
  return res;
}
