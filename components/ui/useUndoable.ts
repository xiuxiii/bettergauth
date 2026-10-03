"use client";

import { useEffect, useState } from "react";
import { createUndoHolder, type Pending } from "@/lib/undoHolder";

/** How long a destructive action waits, with an Undo, before it happens. */
export const UNDO_MS = 5000;

/**
 * Hold a destructive action for UNDO_MS with an Undo before running it. One
 * stray tap on a bin used to erase a problem and its photos for good.
 *
 * Only one action is held at a time: scheduling another commits the first
 * straight away, and so does leaving the page (pagehide, or unmount on a
 * client-side navigation). The ordering lives in lib/undoHolder.ts.
 */
export function useUndoable() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [holder] = useState(() => createUndoHolder(UNDO_MS, setPending));

  useEffect(() => {
    const flush = () => void holder.commit();
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [holder]);

  return { pending, schedule: holder.schedule, undo: holder.undo };
}
