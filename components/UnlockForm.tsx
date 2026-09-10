"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6">
      <div className="w-full">
        <h1 className="text-xl font-bold text-slate-900">Enter access code</h1>
        <p className="mt-1 text-sm text-slate-600">
          This tutor is private. Enter the code you were given.
        </p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            placeholder="Access code"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none transition focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          />
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="w-full rounded-2xl bg-brand-600 px-5 py-3 text-base font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? "Checking…" : "Unlock"}
          </button>
        </form>
      </div>
    </main>
  );
}
