"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/supabase/config";

let client: Promise<SupabaseClient | null> | undefined;

/**
 * The browser's Supabase client, or null when accounts aren't set up. Loaded
 * on first use, not with the page: the library is ~70 KB, and home and
 * Settings only need it after they've painted.
 */
export function browserSupabase(): Promise<SupabaseClient | null> {
  if (client) return client;
  const cfg = supabaseConfig();
  client = cfg
    ? import("@supabase/ssr").then(({ createBrowserClient }) => createBrowserClient(cfg.url, cfg.anonKey))
    : Promise.resolve(null);
  return client;
}
