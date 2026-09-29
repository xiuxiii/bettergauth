"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** How long a destructive action waits, with an Undo, before it happens. */
export const UNDO_MS = 5000;

type Pending = { key: string; message: string };

/**
 * Hold a destructive action for UNDO_MS with an Undo before running it. One
 * stray tap on a bin used to erase a problem and its photos for good.
 *
 * Only one action is held at a time: scheduling another commits the first
 * straight away, and so does leaving the page (pagehide, or unmount on a
 * client-side navigation).
 */
export function useUndoable() {
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<{ key: string; run: () => unknown; timer: number } | null>(null);

  const commit = useCallback(async () => {
    const held = ref.current;
    if (!held) return;
    ref.current = null;
    window.clearTimeout(held.timer);
    setPending(null);
    await held.run();
  }, []);

  useEffect(() => {
    const flush = () => void commit();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [commit]);

  const schedule = useCallback(
    async (key: string, message: string, run: () => unknown) => {
      await commit();
      const timer = window.setTimeout(() => void commit(), UNDO_MS);
      ref.current = { key, run, timer };
      setPending({ key, message });
    },
    [commit],
  );

  const undo = useCallback(() => {
    const held = ref.current;
    if (!held) return;
    window.clearTimeout(held.timer);
    ref.current = null;
    setPending(null);
  }, []);

  return { pending, schedule, undo };
}
