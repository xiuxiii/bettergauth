"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import MindGapMark from "@/components/MindGapMark";
import { Spinner } from "@/components/States";
import { apiFetch, NetworkError, readApiError } from "@/lib/apiClient";
import { refreshAccount, useAccount } from "@/lib/account/useAccount";
import { safeBackPath } from "@/lib/safePath";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The one question after a first sign-in: birth month and year. The server
 * decides (lib/account/age.ts) and keeps only "13 or older", never the date.
 * Under 13, the account is deleted there and then, and MindGap carries on
 * working on this device without one.
 */
export default function AgeView() {
  const router = useRouter();
  const account = useAccount();
  const [next, setNext] = useState("/");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tooYoung, setTooYoung] = useState(false);

  useEffect(() => {
    setNext(safeBackPath(new URLSearchParams(window.location.search).get("next")));
  }, []);

  useEffect(() => {
    if (tooYoung) return;
    if (account.status === "signedOut") router.replace("/signin");
    if (account.status === "signedIn" && account.ageOk) router.replace(next);
  }, [account, next, router, tooYoung]);

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_, i) => thisYear - i);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!month || !year || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/account/age", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month: Number(month), year: Number(year) }),
      });
      if (res.status === 403) {
        setTooYoung(true);
        await refreshAccount();
        return;
      }
      if (!res.ok) {
        setError(await readApiError(res, "Couldn't save that. Please try again."));
        setBusy(false);
        return;
      }
      await refreshAccount();
      router.replace(next);
    } catch (err) {
      setError(err instanceof NetworkError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 pb-10 pt-[max(2.5rem,calc(env(safe-area-inset-top,0px)+2rem))] md:max-w-lg md:px-0">
      <div className="w-full animate-rise md:rounded-lg md:border md:border-hairline md:bg-surface md:p-10 md:shadow-card">
        <MindGapMark className="mb-4 h-8 w-8" />
        {tooYoung ? (
          <>
            <h1 className="font-serif text-2xl font-normal leading-[1.15] tracking-tight text-ink">
              Accounts are for 13 and up
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
              We didn&apos;t keep anything: the account was removed straight away. You can
              still use MindGap without one. Your problems stay saved on this device.
            </p>
            <Link
              href="/"
              className="mt-6 flex h-12 w-full items-center justify-center rounded-md bg-brand-600 px-5 text-base font-semibold text-white shadow-raised transition hover:bg-accent-deep active:bg-accent-deep"
            >
              Back to MindGap
            </Link>
          </>
        ) : (
          <>
            <h1 className="font-serif text-2xl font-normal leading-[1.15] tracking-tight text-ink">
              When were you born?
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Accounts are for ages 13 and up. We only keep whether you are, not your birthday.
            </p>
            <form onSubmit={submit} className="mt-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <select
                  aria-label="Birth month"
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  className="h-12 w-full rounded-md border border-slate-300 bg-surface px-3 text-base text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
                >
                  <option value="">Month</option>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Birth year"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  className="h-12 w-full rounded-md border border-slate-300 bg-surface px-3 text-base text-ink outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
                >
                  <option value="">Year</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
              <p role="alert" className={error ? "animate-rise text-sm text-danger-600" : "sr-only"}>
                {error ?? ""}
              </p>
              <button
                type="submit"
                disabled={busy || !month || !year}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-5 text-base font-semibold text-white shadow-raised transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep disabled:bg-brand-300 disabled:text-white/90 disabled:shadow-none"
              >
                {busy ? <Spinner className="h-5 w-5" /> : null}
                Continue
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
