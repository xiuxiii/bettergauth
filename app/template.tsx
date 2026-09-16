"use client";

/**
 * App Router re-mounts this on every navigation, so wrapping children here gives
 * a gentle cross-page fade (home → workspace → setup) for free. Suppressed under
 * prefers-reduced-motion via the .animate-fade-in rule in globals.css.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-in">{children}</div>;
}
