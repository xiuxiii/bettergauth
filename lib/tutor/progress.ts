/**
 * Cross-session concept progress.
 *
 * The signal this reads already exists: the model maintains a SessionMemory per
 * problem — classified errors, named misconceptions, and the concepts the
 * student has demonstrated — and `detectRecurring` (lib/tutor/types.ts) already
 * ranks it within one session. All that was missing was durability. This folds
 * many stored sessions into one ranking.
 *
 * It deliberately applies the SAME rule as `detectRecurring`: a concept the
 * student has since demonstrated is resolved and never nagged about. The one
 * difference is scope — demonstrations from ANY session clear a concept
 * everywhere, so proving it later cleans up earlier failures rather than
 * leaving a permanent black mark.
 *
 * Deterministic and free. The AI write-up is a separate, opt-in call.
 */

import type {
  RememberedError,
  RememberedMisconception,
  SessionMemory,
} from "@/lib/tutor/types";

export interface ConceptProgress {
  concept: string;
  /** How many classified errors touched this concept, across all sessions. */
  errors: number;
  /** How many distinct problems it went wrong in. */
  problems: number;
  /** Error types seen, most frequent first — "conceptual" reads differently
   *  from "arithmetic" and the student should be able to tell them apart. */
  types: RememberedError["type"][];
  /** The unresolved wrong model, when one was named. */
  studentBelief?: string;
  /** The one-line correction. */
  correctModel?: string;
  /** When this concept last went wrong. */
  lastSeen: number;
}

export interface ProgressInput {
  memory: SessionMemory;
  /** Used only for `lastSeen`. */
  at: number;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Rank the concepts worth working on, worst first.
 *
 * Ordering: most errors, then most recent. Recency breaks ties because two
 * concepts with equal error counts are not equally urgent — the one that went
 * wrong yesterday is.
 */
export function rankConcepts(sessions: ProgressInput[]): ConceptProgress[] {
  // Demonstrated anywhere clears it everywhere.
  const demonstrated = new Set<string>();
  for (const s of sessions) {
    for (const d of s.memory.demonstrated ?? []) {
      if (d.trim()) demonstrated.add(norm(d));
    }
  }

  const byConcept = new Map<
    string,
    {
      display: string;
      errors: number;
      problems: Set<number>;
      types: Map<RememberedError["type"], number>;
      lastSeen: number;
    }
  >();

  sessions.forEach((s, i) => {
    for (const e of s.memory.errors ?? []) {
      const display = e.concept?.trim();
      if (!display) continue;
      const key = norm(display);
      if (demonstrated.has(key)) continue;

      const entry = byConcept.get(key) ?? {
        display,
        errors: 0,
        problems: new Set<number>(),
        types: new Map(),
        lastSeen: 0,
      };
      entry.errors += 1;
      entry.problems.add(i);
      entry.types.set(e.type, (entry.types.get(e.type) ?? 0) + 1);
      entry.lastSeen = Math.max(entry.lastSeen, s.at);
      byConcept.set(key, entry);
    }
  });

  // Attach the unresolved misconception for each concept, if one was named.
  const unresolved = new Map<string, RememberedMisconception>();
  for (const s of sessions) {
    for (const m of s.memory.misconceptions ?? []) {
      const key = norm(m.concept ?? "");
      if (!key) continue;
      if (m.status === "resolved") {
        unresolved.delete(key);
      } else if (!unresolved.has(key)) {
        unresolved.set(key, m);
      }
    }
  }

  const out: ConceptProgress[] = [];
  for (const [key, v] of byConcept) {
    const m = unresolved.get(key);
    out.push({
      concept: v.display,
      errors: v.errors,
      problems: v.problems.size,
      types: [...v.types.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([t]) => t),
      studentBelief: m?.studentBelief,
      correctModel: m?.correctModel,
      lastSeen: v.lastSeen,
    });
  }

  out.sort((a, b) => b.errors - a.errors || b.lastSeen - a.lastSeen);
  return out;
}

/** Concepts the student has proven, across every session. */
export function masteredConcepts(sessions: ProgressInput[]): string[] {
  const seen = new Map<string, string>();
  for (const s of sessions) {
    for (const d of s.memory.demonstrated ?? []) {
      const display = d.trim();
      if (display && !seen.has(norm(display))) seen.set(norm(display), display);
    }
  }
  return [...seen.values()];
}
