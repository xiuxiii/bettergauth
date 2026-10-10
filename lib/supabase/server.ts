import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/supabase/config";

/**
 * Supabase as the signed-in student, for route handlers and server components:
 * reads and refreshes the session cookies, and the database's row-level
 * security limits it to that student's rows. Null when accounts are off.
 */
export async function serverSupabase(): Promise<SupabaseClient | null> {
  const cfg = supabaseConfig();
  if (!cfg) return null;
  const store = await cookies();
  return createServerClient(cfg.url, cfg.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // A server component can't set cookies; middleware refreshes them.
        }
      },
    },
  });
}
