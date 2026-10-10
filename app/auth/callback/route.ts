import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";
import { afterSignIn } from "@/lib/account/afterSignIn";

export const dynamic = "force-dynamic";

/**
 * Where "Continue with Google" comes back to: trades the one-time code for a
 * session (cookies), then on to the age step or wherever sign-in started.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const supabase = await serverSupabase();
  const code = url.searchParams.get("code");
  if (!supabase || !code) return NextResponse.redirect(new URL("/signin?error=link", url.origin));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth] code exchange failed:", error.message);
    return NextResponse.redirect(new URL("/signin?error=link", url.origin));
  }
  return NextResponse.redirect(new URL(await afterSignIn(supabase, url.searchParams.get("next")), url.origin));
}
