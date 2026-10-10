import { NextResponse } from "next/server";
import { serverSupabase } from "@/lib/supabase/server";
import { adminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST: delete the signed-in account and everything in it. Photos first
 * (storage has no cascade), then the auth user, whose foreign keys take the
 * profile and every session row with it. Then the session cookies go.
 */
export async function POST(req: Request) {
  // A JSON body means a same-site fetch: a cross-site form can't send one
  // without a preflight, on top of the session cookies being SameSite=Lax.
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  const supabase = await serverSupabase();
  const admin = adminSupabase();
  if (!supabase || !admin) {
    return NextResponse.json({ error: "Accounts aren't set up yet." }, { status: 503 });
  }
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const photos = admin.storage.from("photos");
  for (;;) {
    const { data, error } = await photos.list(user.id, { limit: 1000 });
    if (error) {
      console.error("[account] listing photos failed:", error.message);
      return NextResponse.json({ error: "Couldn't delete your photos. Please try again." }, { status: 500 });
    }
    if (!data?.length) break;
    const { error: rmError } = await photos.remove(data.map((f) => `${user.id}/${f.name}`));
    if (rmError) {
      console.error("[account] removing photos failed:", rmError.message);
      return NextResponse.json({ error: "Couldn't delete your photos. Please try again." }, { status: 500 });
    }
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[account] delete failed:", error.message);
    return NextResponse.json({ error: "Couldn't delete your account. Please try again." }, { status: 500 });
  }
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
