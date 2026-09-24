import { NextResponse } from "next/server";
import {
  ACCESS_COOKIE,
  accessToken,
  constantTimeEqual,
  expectedToken,
} from "@/lib/accessToken";

export const runtime = "nodejs";

/**
 * POST /api/unlock  { code }
 * Verifies the shared access code (server-side) and, on match, sets an
 * httpOnly cookie the middleware admits. The cookie carries an HMAC of the code,
 * not the code, and the comparison is constant-time (lib/accessToken.ts).
 */
export async function POST(req: Request) {
  const code = process.env.ACCESS_CODE?.trim();
  // Gate disabled — nothing to unlock.
  if (!code) return NextResponse.json({ ok: true });

  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const submitted = typeof body?.code === "string" ? body.code.trim() : "";

  // Sign what they typed with the SERVER's key and compare tokens: fixed-length,
  // constant-time, and the raw guess is never compared character by character.
  const expected = await expectedToken(code);
  const ok =
    !!submitted && constantTimeEqual(await accessToken(submitted, code), expected);

  if (ok) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ACCESS_COOKIE, expected, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    return res;
  }
  return NextResponse.json({ error: "Incorrect code." }, { status: 401 });
}
