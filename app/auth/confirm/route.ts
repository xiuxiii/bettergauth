import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { serverSupabase } from "@/lib/supabase/server";
import { afterSignIn } from "@/lib/account/afterSignIn";

export const dynamic = "force-dynamic";

const EMAIL_TYPES = new Set<EmailOtpType>(["email", "magiclink", "signup"]);

/**
 * Where the emailed sign-in link lands (Supabase's email template points
 * here with a token_hash). Unlike a code exchange it works when the link is
 * opened in a different browser from the one that asked for it, which on a
 * phone is the usual case (the mail app opens links in its own browser).
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const supabase = await serverSupabase();
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  if (!supabase || !tokenHash || !type || !EMAIL_TYPES.has(type)) {
    return NextResponse.redirect(new URL("/signin?error=link", url.origin));
  }
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    console.error("[auth] email link failed:", error.message);
    return NextResponse.redirect(new URL("/signin?error=link", url.origin));
  }
  return NextResponse.redirect(new URL(await afterSignIn(supabase, url.searchParams.get("next")), url.origin));
}
