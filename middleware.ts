import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ACCESS_COOKIE, accessConfig, checkCookie } from "@/lib/accessToken";

/**
 * Lightweight shared-access gate. Protects the app and AI routes behind a code
 * so a public URL can't drain the API key. It is OFF unless `ACCESS_CODE` is
 * set — so local dev and the current deploy keep working until you set the code
 * (in the Vercel dashboard, no laptop needed). See docs/deploy.md.
 */

export async function middleware(req: NextRequest) {
  // Off only when neither ACCESS_CODE nor ACCESS_CODES is set.
  if (!(await accessConfig()).enabled) return NextResponse.next();

  const { pathname } = req.nextUrl;
  // Always reachable: the unlock flow itself and the health check.
  if (
    pathname.startsWith("/unlock") ||
    pathname.startsWith("/api/unlock") ||
    pathname.startsWith("/api/health")
  ) {
    return NextResponse.next();
  }

  // The cookie names a code without containing it; its expiry is read from the
  // CURRENT env list (lib/accessToken.ts), so edits apply to people already in.
  const check = await checkCookie(req.cookies.get(ACCESS_COOKIE)?.value);
  if (check.ok) return NextResponse.next();
  const expired = check.reason === "expired";

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: expired
          ? "Your access code has expired. Reload and enter a new one."
          : "Locked. Enter the access code first.",
      },
      { status: 401 },
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/unlock";
  url.search = expired ? "?expired=1" : "";
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except Next's static assets, the app icons and the
  // web manifest — those must load before unlock.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|apple-icon.png|icon-192.png|icon-512.png).*)",
  ],
};
