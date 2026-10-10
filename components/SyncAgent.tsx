"use client";

import { useEffect } from "react";
import { accountsEnabled } from "@/lib/supabase/config";

/**
 * Starts account sync (lib/sync/engine.ts) on whatever page the student opens.
 * Renders nothing; loads the engine only when accounts are set up.
 */
export default function SyncAgent() {
  useEffect(() => {
    if (accountsEnabled()) void import("@/lib/sync/engine").then((m) => m.startSync());
  }, []);
  return null;
}
