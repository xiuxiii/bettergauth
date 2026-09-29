"use client";

/**
 * The pill snackbar at the bottom of the screen ("Saved", "Problem deleted ·
 * Undo"). The live region is always mounted and only its content changes:
 * a region inserted together with its text often isn't announced.
 */
export default function Toast({
  message,
  action,
}: {
  message: string | null;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-[max(1rem,env(safe-area-inset-bottom,0px))] z-50 flex justify-center px-4"
    >
      {message && (
        <div className="pointer-events-auto flex min-h-10 animate-pop-in items-center gap-3 rounded-full bg-ink px-4 py-1 text-sm text-paper shadow-raised">
          <span>{message}</span>
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="h-9 rounded-full px-3 font-semibold text-paper underline underline-offset-4 transition hover:opacity-80"
            >
              {action.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
