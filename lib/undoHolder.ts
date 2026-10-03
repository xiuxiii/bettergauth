/**
 * The ordering behind useUndoable (components/ui/useUndoable.ts), kept free of
 * React so `npm test` checks it.
 *
 * One action is held at a time. Scheduling another commits the held one, and
 * the swap happens synchronously, BEFORE that commit is awaited: when the new
 * action was only held after the old one's commit finished, a second delete
 * tapped during that await was overwritten by the first and never happened.
 */

export type Pending = { key: string; message: string };

type Held = {
  key: string;
  message: string;
  run: () => unknown;
  timer: ReturnType<typeof setTimeout>;
};

export function createUndoHolder(delayMs: number, onChange: (pending: Pending | null) => void) {
  let held: Held | null = null;

  /** Run the held action now. It is taken out first, so it runs only once. */
  async function commit() {
    const h = held;
    if (!h) return;
    held = null;
    clearTimeout(h.timer);
    onChange(null);
    await h.run();
  }

  async function schedule(key: string, message: string, run: () => unknown) {
    const prev = held;
    if (prev) clearTimeout(prev.timer);
    held = { key, message, run, timer: setTimeout(() => void commit(), delayMs) };
    onChange({ key, message });
    if (prev) await prev.run();
  }

  function undo() {
    const h = held;
    if (!h) return;
    held = null;
    clearTimeout(h.timer);
    onChange(null);
  }

  return { schedule, commit, undo };
}
