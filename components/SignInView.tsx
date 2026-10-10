"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Mail } from "lucide-react";
import MindGapMark from "@/components/MindGapMark";
import GoogleMark from "@/components/GoogleMark";
import { Spinner } from "@/components/States";
import { browserSupabase } from "@/lib/supabase/client";
import { AUTH_CALLBACK } from "@/lib/supabase/config";
import { useAccount } from "@/lib/account/useAccount";
import { safeBackPath } from "@/lib/safePath";

/**
 * Sign in or create an account (the same step): Continue with Google, or an
 * emailed link. No passwords. Accounts are optional: everything works without
 * one, signing in is what keeps history across devices.
 */
export default function SignInView() {
  const router = useRouter();
  const account = useAccount();
  const [next, setNext] = useState("/");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read after mount (not useSearchParams) so the page needs no Suspense.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(safeBackPath(params.get("next")));
    if (params.get("error") === "link") {
      setError("That sign-in link didn't work or has expired. Try again.");
    }
  }, []);

  useEffect(() => {
    if (account.status === "signedIn") router.replace(account.ageOk ? next : `/account/age?next=${encodeURIComponent(next)}`);
  }, [account, next, router]);

  const returnTo = () => `${window.location.origin}${AUTH_CALLBACK}?next=${encodeURIComponent(next)}`;

  async function google() {
    const supabase = await browserSupabase();
    if (!supabase || busy) return;
    setBusy("google");
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: returnTo() },
    });
    // On success the browser is already leaving for Google.
    if (error) {
      setError("Couldn't reach Google. Check your connection and try again.");
      setBusy(null);
    }
  }

  async function emailLink(e: React.FormEvent) {
    e.preventDefault();
    const supabase = await browserSupabase();
    const address = email.trim();
    if (!supabase || !address || busy) return;
    setBusy("email");
    setError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: returnTo(), shouldCreateUser: true },
    });
    setBusy(null);
    if (error) {
      setError(
        error.status === 429
          ? "Too many emails just now. Wait a minute and try again."
          : "Couldn't send the link. Check the address and try again.",
      );
      return;
    }
    setSent(true);
  }

  if (account.status === "disabled") {
    return (
      <Shell back={next}>
        <h1 className="font-serif text-2xl font-normal leading-[1.15] tracking-tight text-ink">
          Accounts are coming soon
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          For now, your problems and history are saved on this device.
        </p>
      </Shell>
    );
  }

  return (
    <Shell back={next}>
      <h1 className="font-serif text-2xl font-normal leading-[1.15] tracking-tight text-ink">
        {sent ? "Check your email" : "Sign in to MindGap"}
      </h1>
      {sent ? (
        <>
          <p className="mt-2 text-[15px] leading-relaxed text-slate-600">
            We sent a sign-in link to <span className="font-medium text-ink">{email.trim()}</span>.
            Open it on this device to finish.
          </p>
          <button
            type="button"
            onClick={() => setSent(false)}
            className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
          >
            Use a different email
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-slate-600">
            Keep your problems and progress on every device. New here? This makes your account.
          </p>

          <button
            type="button"
            onClick={google}
            disabled={!!busy}
            className="mt-6 flex h-12 w-full items-center justify-center gap-3 rounded-md border border-slate-300 bg-surface px-5 text-[15px] font-semibold text-ink transition hover:bg-slate-100 active:scale-[0.98] disabled:opacity-60"
          >
            {busy === "google" ? <Spinner className="h-5 w-5" /> : <GoogleMark />}
            Continue with Google
          </button>

          <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
            <span className="h-px flex-1 bg-hairline" />
            or
            <span className="h-px flex-1 bg-hairline" />
          </div>

          <form onSubmit={emailLink} className="space-y-3">
            <label htmlFor="signin-email" className="sr-only">
              Email
            </label>
            <input
              id="signin-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              className="h-12 w-full rounded-md border border-slate-300 bg-surface px-4 text-base text-ink outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
            />
            <button
              type="submit"
              disabled={!!busy || !email.trim()}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-brand-600 px-5 text-base font-semibold text-white shadow-raised transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep disabled:bg-brand-300 disabled:text-white/90 disabled:shadow-none"
            >
              {busy === "email" ? <Spinner className="h-5 w-5" /> : <Mail size={18} strokeWidth={1.75} aria-hidden="true" />}
              Email me a sign-in link
            </button>
          </form>
        </>
      )}

      <p role="alert" className={error ? "mt-3 animate-rise text-sm text-danger-600" : "sr-only"}>
        {error ?? ""}
      </p>

      <p className="mt-6 text-xs leading-relaxed text-slate-500">
        Accounts are for ages 13 and up.{" "}
        <Link href="/privacy?back=/signin" className="underline underline-offset-4 hover:text-ink">
          How MindGap handles your data
        </Link>
      </p>
    </Shell>
  );
}

function Shell({ back, children }: { back: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pb-10 pt-[max(1rem,calc(env(safe-area-inset-top,0px)+0.5rem))] md:max-w-lg md:justify-center md:px-0 md:py-10">
      <Link
        href={back}
        aria-label="Back"
        className="-ml-3 mb-4 flex h-11 w-11 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100 md:hidden"
      >
        <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
      </Link>
      <div className="w-full animate-rise md:rounded-lg md:border md:border-hairline md:bg-surface md:p-10 md:shadow-card">
        <MindGapMark className="mb-4 h-8 w-8" />
        {children}
        <Link
          href={back}
          className="mt-2 inline-flex min-h-11 items-center text-sm text-slate-500 underline-offset-4 transition hover:text-ink hover:underline"
        >
          Not now — keep using MindGap without an account
        </Link>
      </div>
    </main>
  );
}
