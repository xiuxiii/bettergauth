"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import MindGapMark from "@/components/MindGapMark";

/** One-field unlock: submit the shared access code to get in. */
export default function UnlockForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      if (res.ok) {
        router.replace("/");
        router.refresh();
      } else {
        setError("Incorrect code.");
        setBusy(false);
      }
    } catch {
      setError("Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 py-10 md:max-w-lg md:px-0">
      <div className="w-full animate-rise md:rounded-lg md:border md:border-hairline md:bg-surface md:p-10 md:shadow-card">
        <MindGapMark className="mb-4 h-8 w-8" />
        <h1 className="font-serif text-2xl font-normal leading-[1.15] tracking-tight text-ink">
          Enter access code
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          This tutor is private. Enter the code you were given.
        </p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            autoComplete="one-time-code"
            inputMode="text"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "unlock-error" : undefined}
            placeholder="Access code"
            className="h-11 w-full rounded-md border border-slate-300 bg-surface px-4 text-base text-ink outline-none transition placeholder:text-slate-400 focus:border-slate-300"
          />
          <p
            id="unlock-error"
            aria-live="polite"
            className={error ? "animate-rise text-sm text-danger-600" : "sr-only"}
          >
            {error ?? ""}
          </p>
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="h-12 w-full rounded-md bg-brand-600 px-5 text-base font-semibold text-white shadow-raised transition hover:bg-brand-700 active:scale-[0.98] active:bg-brand-700 disabled:bg-brand-300 disabled:text-white/90 disabled:shadow-none"
          >
            {busy ? "Checking…" : "Unlock"}
          </button>
        </form>
      </div>
    </main>
  );
}
