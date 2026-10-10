"use client";

import { useSyncExternalStore } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { browserSupabase } from "@/lib/supabase/client";

/**
 * Who is signed in, for every account surface on the page (the home button,
 * Settings, /account, sync), as one `useSyncExternalStore` store fed by
 * Supabase's auth events, so they always agree. "disabled" when Supabase isn't
 * configured: every account surface then renders nothing.
 */
export type Account =
  | { status: "disabled" }
  | { status: "loading" }
  | { status: "signedOut" }
  | {
      status: "signedIn";
      id: string;
      email: string | null;
      name: string | null;
      avatarUrl: string | null;
      /** The server has recorded that they are 13+ (profiles.age_ok_at). */
      ageOk: boolean;
    };

const DISABLED: Account = { status: "disabled" };
const LOADING: Account = { status: "loading" };
const SIGNED_OUT: Account = { status: "signedOut" };

let state: Account = LOADING;
let started = false;
const listeners = new Set<() => void>();

function set(next: Account) {
  state = next;
  for (const l of listeners) l();
}

async function signedIn(supabase: SupabaseClient, user: User): Promise<Account> {
  const { data } = await supabase.from("profiles").select("age_ok_at").maybeSingle();
  const meta = user.user_metadata ?? {};
  return {
    status: "signedIn",
    id: user.id,
    email: user.email ?? null,
    name: typeof meta.full_name === "string" ? meta.full_name : typeof meta.name === "string" ? meta.name : null,
    avatarUrl: typeof meta.avatar_url === "string" ? meta.avatar_url : null,
    ageOk: !!data?.age_ok_at,
  };
}

function start() {
  if (started) return;
  started = true;
  void browserSupabase().then((supabase) => {
    if (!supabase) return set(DISABLED);
    listen(supabase);
  });
}

function listen(supabase: SupabaseClient) {
  // Fires once at once with the stored session, then on every change.
  supabase.auth.onAuthStateChange((_event, session) => {
    const user = session?.user;
    if (!user) return set(SIGNED_OUT);
    // Outside the callback: Supabase warns against awaiting its own calls
    // inside onAuthStateChange (it can deadlock the auth lock).
    setTimeout(() => {
      signedIn(supabase, user)
        .then(set)
        .catch(() => set(SIGNED_OUT));
    }, 0);
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  start();
  return () => listeners.delete(listener);
}

/** Re-read the profile, e.g. after the age step recorded age_ok_at. */
export async function refreshAccount(): Promise<void> {
  const supabase = await browserSupabase();
  if (!supabase) return;
  const { data } = await supabase.auth.getUser();
  set(data.user ? await signedIn(supabase, data.user) : SIGNED_OUT);
}

export function useAccount(): Account {
  return useSyncExternalStore(
    subscribe,
    () => state,
    // The server never knows: account UI renders after hydration.
    () => LOADING,
  );
}

/** The current account outside React (the sync engine). */
export function currentAccount(): Account {
  return state;
}

export function onAccountChange(listener: () => void): () => void {
  return subscribe(listener);
}
