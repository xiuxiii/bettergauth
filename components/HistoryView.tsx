"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Trash2 } from "lucide-react";
import {
  clearAll,
  deleteSession,
  listSessions,
  type SessionRecord,
} from "@/lib/history/db";
import { rankConcepts, type ConceptProgress } from "@/lib/tutor/progress";
import { readApiError } from "@/lib/apiClient";
import { Spinner } from "@/components/States";
import RichText from "@/components/RichText";

/**
 * Everything the student has scanned, and what it says about them.
 *
 * The concept ranking is computed on-device from the SessionMemory the tutor
 * already maintains, so it is free, instant and available offline. The prose
 * write-up costs a model call and is therefore opt-in, not something that fires
 * on every visit.
 */
export default function HistoryView() {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [concepts, setConcepts] = useState<ConceptProgress[]>([]);
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    const rows = await listSessions();
    setSessions(rows);
    setConcepts(
      rankConcepts(rows.map((r) => ({ memory: r.memory, at: r.createdAt }))),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function explain() {
    setSummaryBusy(true);
    setSummaryError(null);
    try {
      const res = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ concepts: concepts.slice(0, 8) }),
      });
      if (!res.ok) {
        throw new Error(await readApiError(res, "Could not build a summary."));
      }
      const data = (await res.json()) as { summary?: string };
      setSummary(data.summary?.trim() || "No clear pattern yet.");
    } catch (err) {
      setSummaryError(
        err instanceof Error ? err.message : "Could not build a summary.",
      );
    } finally {
      setSummaryBusy(false);
    }
  }

  async function remove(id: string) {
    await deleteSession(id);
    await load();
  }

  async function removeEverything() {
    await clearAll();
    setSummary(null);
    setConfirmClear(false);
    await load();
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-16 pt-[max(1rem,calc(env(safe-area-inset-top,0px)+0.5rem))]">
      <header className="mb-5 flex items-center gap-1">
        <Link
          href="/"
          aria-label="Back"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
        >
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <h1 className="font-serif text-2xl font-normal leading-[1.15] tracking-tight text-ink">
          History
        </h1>
      </header>

      {sessions === null ? (
        <div className="flex justify-center py-16">
          <Spinner className="h-6 w-6 text-slate-400" />
        </div>
      ) : sessions.length === 0 ? (
        <div className="rounded-lg border border-hairline bg-surface p-6 text-center">
          <p className="text-base font-medium text-ink">Nothing saved yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Problems you scan are kept on this device so you can come back to
            them.
          </p>
          <Link
            href="/"
            className="mt-4 inline-flex h-11 items-center rounded-md bg-brand-600 px-5 text-sm font-semibold text-white transition hover:bg-accent-deep"
          >
            Scan a problem
          </Link>
        </div>
      ) : (
        <>
          {concepts.length > 0 && (
            <section className="mb-6 rounded-lg border border-hairline bg-surface p-4">
              <h2 className="text-sm font-semibold text-slate-800">
                Concepts to work on
              </h2>
              <ul className="mt-3 space-y-2.5">
                {concepts.slice(0, 5).map((c) => (
                  <li key={c.concept}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-ink">
                        {c.concept}
                      </span>
                      <span className="flex-shrink-0 text-xs tnum text-slate-500">
                        {c.problems} {c.problems === 1 ? "problem" : "problems"}
                      </span>
                    </div>
                    {c.correctModel && (
                      <p className="mt-0.5 text-xs text-slate-500">
                        {c.correctModel}
                      </p>
                    )}
                  </li>
                ))}
              </ul>

              {summary ? (
                <div className="mt-4 rounded-md bg-brand-50 p-3 text-brand-900">
                  <RichText text={summary} />
                </div>
              ) : (
                <button
                  onClick={explain}
                  disabled={summaryBusy}
                  className="mt-4 flex h-10 items-center gap-2 rounded-md px-3 text-sm font-medium text-brand-700 transition hover:bg-brand-50 disabled:opacity-50"
                >
                  {summaryBusy ? <Spinner className="h-4 w-4" /> : null}
                  Explain my pattern
                </button>
              )}
              {summaryError && (
                <p className="mt-2 text-sm text-danger-600">{summaryError}</p>
              )}
            </section>
          )}

          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <div className="flex items-center gap-3 rounded-lg border border-hairline bg-surface p-2.5">
                  <Link
                    href={`/workspace?session=${s.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    {s.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.thumb}
                        alt=""
                        className="h-14 w-14 flex-shrink-0 rounded-sm bg-slate-100 object-cover"
                      />
                    ) : (
                      <div className="h-14 w-14 flex-shrink-0 rounded-sm bg-slate-100" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm text-ink">
                        {s.analysis.problemText || "Untitled problem"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">
                        {[s.analysis.subject, s.analysis.topic]
                          .filter(Boolean)
                          .join(" · ")}
                        {" · "}
                        {formatDate(s.createdAt)}
                      </p>
                    </div>
                  </Link>
                  <button
                    onClick={() => void remove(s.id)}
                    aria-label="Delete this problem"
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-danger-50 hover:text-danger-600"
                  >
                    <Trash2 size={17} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {/* These are photos of someone's homework, often on a shared family
              device. Clearing everything has to be one obvious action. */}
          <div className="mt-6 text-center">
            {confirmClear ? (
              <div className="rounded-md border border-danger-200 bg-danger-50 p-3">
                <p className="text-sm text-danger-800">
                  Delete all {sessions.length} saved{" "}
                  {sessions.length === 1 ? "problem" : "problems"}, including
                  the photos? This can&apos;t be undone.
                </p>
                <div className="mt-3 flex justify-center gap-2">
                  <button
                    onClick={() => void removeEverything()}
                    className="h-10 rounded-md bg-danger-solid px-4 text-sm font-semibold text-white transition hover:bg-danger-deep"
                  >
                    Delete everything
                  </button>
                  <button
                    onClick={() => setConfirmClear(false)}
                    className="h-10 rounded-md px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
                  >
                    Keep them
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClear(true)}
                className="h-10 rounded-md px-3 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-ink"
              >
                Clear all history
              </button>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
