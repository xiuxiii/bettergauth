/** Aria's mark: a ring holding a trajectory arc with an apex dot. */
export default function AriaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 72 72" fill="none" className={className} aria-hidden>
      <circle cx="36" cy="36" r="34.25" stroke="#6E2A39" strokeWidth={1.75} />
      <path
        d="M17 49 C 29 20, 43 20, 55 49"
        stroke="#6E2A39"
        strokeWidth={1.75}
        fill="none"
        strokeLinecap="round"
      />
      <circle cx="36" cy="25.5" r="2.6" fill="#6E2A39" />
    </svg>
  );
}
