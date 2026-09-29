import { useId, type ReactNode } from "react";

/**
 * A settings section: a small-caps header above an inset card whose rows are
 * divided by hairlines, with an optional note under the card.
 *
 * The card doesn't clip its children (a desktop ChoiceSheet has to hang out of
 * it), so the first and last rows take the card's corner radius themselves and
 * a row's hover fill stays inside the curve.
 */
export default function SettingsGroup({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2
        id={id}
        className="mb-2 px-4 text-xs font-medium uppercase tracking-wider text-slate-500"
      >
        {title}
      </h2>
      <div className="divide-y divide-hairline rounded-lg border border-hairline bg-surface [&>*:first-child]:rounded-t-lg [&>*:last-child]:rounded-b-lg">
        {children}
      </div>
      {footer && <p className="mt-2 px-4 text-xs text-slate-500">{footer}</p>}
    </section>
  );
}
