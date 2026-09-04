"use client";

/** Reusable loading / error / empty presentational states. */

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
      />
    </svg>
  );
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-slate-600 shadow-sm">
      <Spinner className="h-5 w-5 text-brand-600" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-800">
      <p className="text-sm font-medium">Something went wrong</p>
      <p className="mt-0.5 text-sm text-rose-700">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-700"
        >
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
    </div>
  );
}
