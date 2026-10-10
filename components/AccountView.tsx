"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, LogOut, Trash2 } from "lucide-react";
import AccountAvatar from "@/components/AccountAvatar";
import { Spinner } from "@/components/States";
import { browserSupabase } from "@/lib/supabase/client";
import { apiFetch, NetworkError, readApiError } from "@/lib/apiClient";
import { refreshAccount, useAccount } from "@/lib/account/useAccount";

/**
 * The signed-in student's account: who they are signed in as, sign out, and
 * delete the account with everything saved to it. Signing out or deleting
 * leaves this device's own history alone.
 */
export default function AccountView() {
  const router = useRouter();
  const account = useAccount();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState<"signout" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (account.status === "signedOut" || account.status === "disabled") router.replace("/signin?next=/account");
    if (account.status === "signedIn" && !account.ageOk) router.replace("/account/age?next=/account");
  }, [account, router]);

  async function signOut() {
    const supabase = await browserSupabase();
    if (!supabase || busy) return;
    setBusy("signout");
    await supabase.auth.signOut();
    router.replace("/");
  }

  async function deleteAccount() {
    if (busy) return;
    setBusy("delete");
    setError(null);
    try {
      const res = await apiFetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        setError(await readApiError(res, "Couldn't delete your account. Please try again."));
        setBusy(null);
        return;
      }
      // The server cleared the cookies; drop the browser's copy too.
      await (await browserSupabase())?.auth.signOut({ scope: "local" });
      await refreshAccount();
      router.replace("/?accountDeleted=1");
    } catch (err) {
      setError(err instanceof NetworkError ? err.message : "Something went wrong. Try again.");
      setBusy(null);
    }
  }

  if (account.status !== "signedIn" || !account.ageOk) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <Spinner className="h-6 w-6 text-slate-400" />
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md animate-rise px-4 pb-24 pt-[max(1rem,calc(env(safe-area-inset-top,0px)+0.5rem))] md:max-w-lg md:pt-10">
      <header className="mb-5 flex items-center gap-1">
        <Link
          href="/"
          aria-label="Back"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
        >
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <h1 className="font-serif text-2xl font-normal leading-[1.15] tracking-tight text-ink">Account</h1>
      </header>

      <section className="flex items-center gap-4 rounded-lg border border-hairline bg-surface p-4">
        <AccountAvatar name={account.name} email={account.email} url={account.avatarUrl} size={52} />
        <div className="min-w-0">
          {account.name && <p className="truncate text-base font-medium text-ink">{account.name}</p>}
          <p className="truncate text-sm text-slate-600">{account.email}</p>
        </div>
      </section>

      <div className="mt-6 space-y-2">
        <button
          type="button"
          onClick={signOut}
          disabled={!!busy}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-slate-300 bg-surface px-5 text-[15px] font-semibold text-slate-800 transition hover:bg-slate-100 active:scale-[0.98] disabled:opacity-60"
        >
          {busy === "signout" ? <Spinner className="h-5 w-5" /> : <LogOut size={18} strokeWidth={1.75} aria-hidden="true" />}
          Sign out
        </button>
        <p className="px-1 text-xs text-slate-500">Problems already on this device stay here after you sign out.</p>
      </div>

      <div className="mt-10">
        {confirming ? (
          <div role="alertdialog" aria-labelledby="delete-title" className="rounded-lg border border-danger-200 bg-danger-50 p-4">
            <h2 id="delete-title" className="text-[15px] font-semibold text-danger-800">
              Delete your account?
            </h2>
            <p className="mt-1 text-sm text-danger-700">
              This removes your account and every problem, conversation and photo saved to it,
              for good. This device&apos;s own history stays.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={deleteAccount}
                disabled={!!busy}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-danger-solid px-4 text-sm font-semibold text-white transition hover:bg-danger-deep active:bg-danger-deep disabled:opacity-60"
              >
                {busy === "delete" ? <Spinner className="h-4 w-4" /> : null}
                Delete account
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => setConfirming(false)}
                disabled={!!busy}
                className="h-11 flex-1 rounded-md border border-slate-300 bg-surface px-4 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="mx-auto flex h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-danger-700"
          >
            <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
            Delete account
          </button>
        )}
        <p role="alert" className={error ? "mt-3 animate-rise text-sm text-danger-600" : "sr-only"}>
          {error ?? ""}
        </p>
      </div>
    </main>
  );
}
