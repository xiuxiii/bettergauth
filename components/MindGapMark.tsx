/**
 * MindGap mark: a rounded tile with a puzzle socket on its edge and one piece
 * lifted away — the "gap". Original geometric glyph, indigo. Scales cleanly.
 */
export default function MindGapMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <defs>
        <linearGradient id="mg-mark" x1="3" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5C63E6" />
          <stop offset="1" stopColor="#4E54DD" />
        </linearGradient>
      </defs>
      {/* body with a concave socket on the right edge */}
      <path
        d="M6 3.5h7.5A2.5 2.5 0 0 1 16 6v3.4h-1.9a2.1 2.1 0 1 0 0 4.2H16V18a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 18V6A2.5 2.5 0 0 1 6 3.5Z"
        fill="url(#mg-mark)"
      />
      {/* the lifted-out piece */}
      <rect x="18.4" y="6.7" width="4.1" height="4.1" rx="1.3" fill="#A2ACF6" />
    </svg>
  );
}
