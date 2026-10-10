import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/supabase/config";

/**
 * Supabase with the service-role key: bypasses row-level security, so it is
 * used only for what a student must not be able to do to themselves through
 * the public key (record that they are 13 or older) and for deleting an
 * account outright. Never imported by client code ("server-only").
 */
export function adminSupabase(): SupabaseClient | null {
  const cfg = supabaseConfig();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim();
  if (!cfg || !key) return null;
  return createClient(cfg.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
