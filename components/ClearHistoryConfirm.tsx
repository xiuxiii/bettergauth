"use client";

/**
 * The "delete everything?" panel, shared by the History page and Settings.
 * These are photos of someone's homework, often on a shared family device,
 * so clearing everything is one obvious action, confirmed once, and then held
 * for a few seconds with an Undo (useUndoable) before it really happens.
 */
export default function ClearHistoryConfirm({
  count,
  account = false,
  onConfirm,
  onCancel,
}: {
  count: number;
  /** Signed in: the delete reaches the account (every device) too. */
  account?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-md border border-danger-200 bg-danger-50 p-3 text-center">
      <p className="text-sm text-danger-800">
        Delete all {count} saved {count === 1 ? "problem" : "problems"}, including the photos
        {account ? ", from this device and your account" : ""}?
      </p>
      <div className="mt-3 flex justify-center gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className="h-11 rounded-md bg-danger-solid px-4 text-sm font-semibold text-white transition hover:bg-danger-deep"
        >
          Delete everything
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-md px-4 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
        >
          Keep them
        </button>
      </div>
    </div>
  );
}
