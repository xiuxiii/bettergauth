/**
 * The MindGap wordmark: "Mind" in ink, "Gap" in indigo — a bold geometric sans
 * matching the logo. `className` sets the size (font-size + weight come from the
 * caller's text classes).
 */
export default function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-sans font-bold tracking-tight ${className}`}>
      <span className="text-ink">Mind</span>
      <span className="text-brand-600">Gap</span>
    </span>
  );
}
