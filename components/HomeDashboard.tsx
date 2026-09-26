"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { listSessions, type SessionRecord } from "@/lib/history/db";
import { rankConcepts, type ConceptProgress } from "@/lib/tutor/progress";
import { formatRelativeDate } from "@/lib/utils";
import { InlineRichText } from "@/components/RichText";

const norm = (s: string) => s.trim().toLowerCase();

/**
 * The home screen's second half: where the student left off, and what keeps
 * going wrong. The concept tracking is the thing no photo-solver has, and it
 * used to sit two taps deep in History while marketing cards held this spot.
 *
 * Everything is read from on-device history, so it costs nothing and shows
 * nothing at all for a new student (no empty-state lecture on first open).
 */
export default function HomeDashboard() {
  const [sessions, setSessions] = useState<SessionRecord[] | null>(null);
  const [concepts, setConcepts] = useState<ConceptProgress[]>([]);

  useEffect(() => {
    void listSessions().then((rows) => {
      setSessions(rows);
      setConcepts(
        rankConcepts(rows.map((r) => ({ memory: r.memory, at: r.createdAt }))),
      );
    });
  }, []);

  if (!sessions || sessions.length === 0) return null;

  /**
   * The most recent session where this concept went wrong: "Practice this"
   * reopens it, so the targeted practice sits under the problem it came from.
   */
  function sourceFor(concept: string): SessionRecord | undefined {
    const key = norm(concept);
    return sessions!.find((s) =>
      (s.memory.errors ?? []).some((e) => norm(e.concept ?? "") === key),
    );
  }

  const recent = sessions.slice(0, 3);
  const weak = concepts
    .slice(0, 3)
    .map((c) => ({ c, source: sourceFor(c.concept) }))
    .filter((x): x is { c: ConceptProgress; source: SessionRecord } => !!x.source);

  return (
    <div className="space-y-6">
      {weak.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-slate-800">
            Concepts to work on
          </h2>
          <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-surface">
            {weak.map(({ c, source }) => (
              <li key={c.concept} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    <InlineRichText text={c.concept} />
                  </p>
                  {/* The mistake itself, when the check named one: the label
                      says where the gap is, this says what it was. */}
                  {c.studentBelief && (
                    <p className="line-clamp-2 text-xs text-slate-600">
                      <InlineRichText text={c.studentBelief} />
                    </p>
                  )}
                  <p className="text-xs tnum text-slate-500">
                    Went wrong in {c.problems}{" "}
                    {c.problems === 1 ? "problem" : "problems"}
                  </p>
                </div>
                <Link
                  href={`/workspace?session=${encodeURIComponent(source.id)}&practice=${encodeURIComponent(c.concept)}`}
                  className="inline-flex h-10 flex-shrink-0 items-center rounded-full border border-brand-300 px-3.5 text-sm font-semibold text-brand-700 transition hover:border-brand-500 hover:bg-brand-50"
                >
                  Practice this
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-800">
            Recent sessions
          </h2>
          <Link
            href="/history"
            className="text-sm text-slate-500 underline-offset-4 transition hover:text-ink hover:underline"
          >
            See all
          </Link>
        </div>
        <ul className="space-y-2">
          {recent.map((s) => (
            <li key={s.id}>
              <Link
                href={`/workspace?session=${encodeURIComponent(s.id)}`}
                className="flex items-center gap-3 rounded-lg border border-hairline bg-surface p-2.5 transition hover:border-brand-300"
              >
                {s.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={s.thumb}
                    alt=""
                    className="h-12 w-12 flex-shrink-0 rounded-sm bg-slate-100 object-cover"
                  />
                ) : (
                  <div className="h-12 w-12 flex-shrink-0 rounded-sm bg-slate-100" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm text-ink">
                    <InlineRichText
                      text={s.analysis.problemText || "Untitled problem"}
                    />
                  </p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {[s.analysis.subject, formatRelativeDate(s.createdAt)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <ChevronRight
                  size={16}
                  strokeWidth={1.75}
                  className="flex-shrink-0 text-slate-400"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
