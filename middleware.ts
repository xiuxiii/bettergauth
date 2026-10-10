import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ACCESS_COOKIE, accessConfig, checkCookie } from "@/lib/accessToken";
import { AUTH_CALLBACK, AUTH_CONFIRM, supabaseConfig } from "@/lib/supabase/config";

/**
 * Lightweight shared-access gate. Protects the app and AI routes behind a code
 * so a public URL can't drain the API key. See docs/deploy.md.
 *
 * With accounts on (lib/supabase/config.ts), every request that gets through
 * also refreshes the student's Supabase session cookies.
 */

// /privacy is readable before unlocking, so a student or parent can check it
// first. The sign-in returns are open too: an emailed link often opens in the
// mail app's own browser, which has no access cookie yet; the student meets
// the gate right after, already signed in.
const OPEN_PATHS = new Set([
  "/unlock",
  "/api/unlock",
  "/api/health",
  "/privacy",
  AUTH_CALLBACK,
  AUTH_CONFIRM,
]);

export async function middleware(req: NextRequest) {
  // Off only when neither ACCESS_CODE nor ACCESS_CODES is set.
  if (!(await accessConfig()).enabled) return withSession(req);

  const { pathname } = req.nextUrl;
  // Always reachable: the unlock flow itself and the health check. Exact
  // paths, not prefixes: a prefix let /unlockanything, /api/unlock-* and
  // /api/healthz past the gate too.
  if (OPEN_PATHS.has(pathname)) {
    return withSession(req);
  }

  // The cookie names a code without containing it; its expiry is read from the
  // CURRENT env list (lib/accessToken.ts), so edits apply to people already in.
  const check = await checkCookie(req.cookies.get(ACCESS_COOKIE)?.value);
  if (check.ok) return withSession(req);
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

/**
 * Pass the request on, refreshing the Supabase session cookies when accounts
 * are on (an expired access token is swapped for a new one here, before any
 * page or route reads it). Without Supabase, a plain pass-through.
 */
async function withSession(req: NextRequest): Promise<NextResponse> {
  let res = NextResponse.next({ request: req });
  const cfg = supabaseConfig();
  if (!cfg) return res;
  let rewrote = false;
  const supabase = createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (list) => {
        rewrote = true;
        for (const { name, value } of list) req.cookies.set(name, value);
        res = NextResponse.next({ request: req });
        for (const { name, value, options } of list) res.cookies.set(name, value, options);
      },
    },
  });
  try {
    await supabase.auth.getClaims();
  } catch {
    // Supabase unreachable: the page still loads, signed out until it's back.
  }
  // A response carrying fresh auth cookies must never be cached and shared.
  if (rewrote) res.headers.set("Cache-Control", "private, no-store");
  return res;
}

export const config = {
  // Run on everything except Next's static assets, the app icons and the
  // web manifest — those must load before unlock.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|apple-icon.png|icon-192.png|icon-512.png).*)",
  ],
};
