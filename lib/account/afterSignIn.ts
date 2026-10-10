import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AGE_PAGE } from "@/lib/supabase/config";
import { safeBackPath } from "@/lib/safePath";

/**
 * Where a fresh sign-in goes next: the age step first if this account hasn't
 * confirmed it is 13+, else back where the student started (a path on this
 * site only, safeBackPath).
 */
export async function afterSignIn(supabase: SupabaseClient, next: string | null): Promise<string> {
  const back = safeBackPath(next);
  const { data } = await supabase.from("profiles").select("age_ok_at").maybeSingle();
  if (!data?.age_ok_at) return `${AGE_PAGE}?next=${encodeURIComponent(back)}`;
  return back;
}

/**
 * A redirect to a path on this site, as a relative Location. Not
 * `new URL(path, req.url)`: a self-hosted `next start` reports its own bind
 * address there (localhost), not the host the browser used, and the session
 * cookie just set for that host would be left behind on the hop.
 */
export function redirectHere(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}
