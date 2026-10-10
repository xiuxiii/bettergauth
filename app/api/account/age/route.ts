import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { checkAge } from "@/lib/account/age";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { year, month }: the 13+ step after a first sign-in (lib/account/age.ts).
 * 13+ → the profile is created with age_ok_at, which is what lets the
 * database accept this account's history (row-level security). Under 13 →
 * the account is deleted on the spot and signed out; nothing is kept.
 * Written with the service-role key: a student can't mark themselves 13+.
 */
export async function POST(req: Request) {
  const supabase = await serverSupabase();
  const admin = adminSupabase();
  if (!supabase || !admin) {
    return NextResponse.json({ error: "Accounts aren't set up yet." }, { status: 503 });
  }
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const verdict = checkAge(body?.year, body?.month);
  if (!verdict.ok && verdict.reason === "invalid") {
    return NextResponse.json({ error: "Please choose your birth month and year." }, { status: 400 });
  }
  if (!verdict.ok) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) console.error("[account] under-13 delete failed:", error.message);
    await supabase.auth.signOut();
    return NextResponse.json({ code: "too_young" }, { status: 403 });
  }

  const { error } = await admin
    .from("profiles")
    .upsert({ id: user.id, age_ok_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) {
    console.error("[account] profile write failed:", error.message);
    return NextResponse.json({ error: "Couldn't save that. Please try again." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
