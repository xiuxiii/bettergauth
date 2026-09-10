import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * POST /api/unlock  { code }
 * Verifies the shared access code (server-side) and, on match, sets an
 * httpOnly cookie the middleware admits. The code is never sent to the client.
 */
export async function POST(req: Request) {
  const code = process.env.ACCESS_CODE?.trim();
  // Gate disabled — nothing to unlock.
  if (!code) return NextResponse.json({ ok: true });

  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const submitted = typeof body?.code === "string" ? body.code.trim() : "";

  if (submitted && submitted === code) {
    const res = NextResponse.json({ ok: true });
    res.cookies.set("stem_access", code, {
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
