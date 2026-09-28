import Link from "next/link";
import { EmptyState } from "@/components/States";

/**
 * Any unknown URL: a mistyped link, an old bookmark. Next's default 404 is an
 * unstyled "This page could not be found." with no way back; this matches the
 * app and offers one.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md animate-rise flex-col items-center justify-center px-6 text-center">
      <EmptyState
        title="Page not found"
        hint="That link doesn't lead anywhere in MindGap."
      />
      <Link
        href="/"
        className="mt-4 inline-flex h-11 items-center rounded-md bg-brand-600 px-4 text-sm font-semibold text-white shadow-raised transition hover:bg-accent-deep active:scale-[0.98] active:bg-accent-deep"
      >
        Go to home
      </Link>
    </main>
  );
}
