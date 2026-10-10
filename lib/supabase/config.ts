/**
 * Accounts are optional, and so is Supabase: with these variables unset (local
 * dev, the e2e profiles, a deploy that hasn't connected Supabase yet) every
 * account surface is hidden and MindGap works on-device exactly as before.
 *
 * NEXT_PUBLIC_* values are inlined into the client at build time, so they must
 * be read by their literal names here. They are public by design: the anon /
 * publishable key can only do what the database's row-level security allows
 * (supabase/migrations). The service-role key is server-only: see admin.ts.
 */
export type SupabaseConfig = { url: string; anonKey: string };

export function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  // Vercel's Supabase integration names it either way, by project age.
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && anonKey ? { url, anonKey } : null;
}

export function accountsEnabled(): boolean {
  return supabaseConfig() !== null;
}

/** Where the sign-in flows land, and the page that follows a sign-in. */
export const AUTH_CALLBACK = "/auth/callback";
export const AUTH_CONFIRM = "/auth/confirm";
export const AGE_PAGE = "/account/age";
