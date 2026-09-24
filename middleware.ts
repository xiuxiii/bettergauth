import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE, constantTimeEqual, expectedToken } from "@/lib/accessToken";

/**
 * Lightweight shared-access gate. Protects the app and AI routes behind a code
 * so a public URL can't drain the API key. It is OFF unless `ACCESS_CODE` is
 * set — so local dev and the current deploy keep working until you set the code
 * (in the Vercel dashboard, no laptop needed). See docs/deploy.md.
 */

export async function middleware(req: NextRequest) {
  const code = process.env.ACCESS_CODE?.trim();
  if (!code) return NextResponse.next(); // gate disabled

  const { pathname } = req.nextUrl;
  // Always reachable: the unlock flow itself and the health check.
  if (
    pathname.startsWith("/unlock") ||
    pathname.startsWith("/api/unlock") ||
    pathname.startsWith("/api/health")
  ) {
    return NextResponse.next();
  }

  // The cookie holds an HMAC of the code, never the code (lib/accessToken.ts).
  const cookie = req.cookies.get(ACCESS_COOKIE)?.value ?? "";
  if (cookie && constantTimeEqual(cookie, await expectedToken(code))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Locked. Enter the access code first." },
      { status: 401 },
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next's static assets, the app icons and the
  // web manifest — those must load before unlock.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|apple-icon.png|icon-192.png|icon-512.png).*)",
  ],
};
