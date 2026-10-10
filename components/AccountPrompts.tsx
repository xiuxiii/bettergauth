"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CloudUpload, X } from "lucide-react";
import { Spinner } from "@/components/States";
import { accountsEnabled } from "@/lib/supabase/config";
import { useAccount } from "@/lib/account/useAccount";
import { listSessions } from "@/lib/history/db";
import { declineImport, importGuestRecords, useSyncStatus } from "@/lib/sync/engine";

const NUDGE_DISMISSED = "mindgap:signin-nudge-dismissed";

/**
 * Home's account prompts, at most one at a time:
 * - signed in with problems made before signing in: bring them into the
 *   account, or keep them on this device only;
 * - signed out after a first problem: one dismissible line about signing in.
 * Nothing when accounts aren't set up.
 */
export default function AccountPrompts() {
  if (!accountsEnabled()) return null;
  return <Prompts />;
}

function Prompts() {
  const account = useAccount();
  const sync = useSyncStatus();
  const [hasHistory, setHasHistory] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(NUDGE_DISMISSED) === "1");
    } catch {
      setDismissed(false);
    }
    void listSessions(1).then((rows) => setHasHistory(rows.length > 0));
  }, []);

  if (account.status === "signedIn" && account.ageOk && sync.guestCount > 0) {
    const n = sync.guestCount;
    return (
      <section className="mb-4 animate-rise rounded-lg border border-brand-200 bg-brand-50 p-4">
        <p className="flex items-start gap-2 text-[15px] font-medium text-brand-900">
          <CloudUpload size={18} strokeWidth={1.75} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
          Save the {n} {n === 1 ? "problem" : "problems"} on this device to your account?
        </p>
        <p className="mt-1 pl-[26px] text-sm text-brand-800">
          Then they&apos;re on every device you sign in on.
        </p>
        <div className="mt-3 flex gap-2 pl-[26px]">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await importGuestRecords();
              setBusy(false);
            }}
            className="flex h-10 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-accent-deep active:bg-accent-deep disabled:opacity-60"
          >
            {busy ? <Spinner className="h-4 w-4" /> : null}
            Save to account
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={declineImport}
            className="h-10 rounded-md px-3 text-sm font-medium text-brand-800 transition hover:bg-brand-100"
          >
            Keep on this device
          </button>
        </div>
      </section>
    );
  }

  if (account.status === "signedOut" && hasHistory && !dismissed) {
    return (
      <section className="mb-4 flex animate-rise items-center gap-3 rounded-lg border border-hairline bg-surface p-3 pl-4">
        <p className="flex-1 text-sm text-slate-700">
          <Link href="/signin" className="font-medium text-brand-700 underline-offset-4 hover:underline">
            Sign in
          </Link>{" "}
          to keep your problems on every device.
        </p>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => {
            setDismissed(true);
            try {
              localStorage.setItem(NUDGE_DISMISSED, "1");
            } catch {
              /* it just comes back next visit */
            }
          }}
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-ink"
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </section>
    );
  }

  return null;
}
