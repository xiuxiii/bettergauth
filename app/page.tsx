import type { LucideIcon } from "lucide-react";
import { CircleCheck, Settings2, Sparkles } from "lucide-react";
import HomeUploader from "@/components/HomeUploader";
import MindGapMark from "@/components/MindGapMark";
import Wordmark from "@/components/Wordmark";

const prefsLinkCls =
  "text-sm text-slate-500 underline-offset-4 transition hover:text-ink hover:underline";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md animate-rise flex-col px-5 pb-10 pt-[max(3.5rem,calc(env(safe-area-inset-top,0px)+2rem))] md:max-w-3xl md:px-8 md:pt-10">
      {/* Header area (md+): preferences link top-right. */}
      <div className="mb-8 hidden md:flex md:justify-end">
        <a href="/setup" className={prefsLinkCls}>
          Edit preferences
        </a>
      </div>

      <div className="flex-1 md:grid md:grid-cols-2 md:items-start md:gap-12">
        <div>
          <header className="mb-8 text-center md:text-left">
            <MindGapMark className="mx-auto mb-4 h-12 w-12 md:mx-0" />
            <Wordmark className="text-4xl" />
            <p className="mx-auto mt-3 max-w-xs text-[15px] leading-relaxed text-slate-600 md:mx-0">
              Snap a problem. Find the gap in your understanding — not just the
              answer.
            </p>
          </header>

          <HomeUploader />
        </div>

        <ul className="mt-8 space-y-3 md:mt-0">
          <Feature
            icon={Sparkles}
            title="Concept-first"
            body="Focuses on the principle and the why, and skips trivial algebra."
          />
          <Feature
            icon={Settings2}
            title="Adapts to you"
            body="Goes deep where you're stuck, moves on where you're solid."
          />
          <Feature
            icon={CircleCheck}
            title="Answers on demand"
            body="Ask for a full worked solution whenever you want one."
          />
        </ul>
      </div>

      <footer className="mt-10 text-center text-xs text-slate-500">
        <p>Physics · Chemistry · Math</p>
        <a href="/setup" className={`mt-2 inline-block md:hidden ${prefsLinkCls}`}>
          Edit preferences
        </a>
      </footer>
    </main>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <li className="flex gap-3 rounded-lg bg-surface px-4 py-3 shadow-card">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-sm bg-brand-50 text-brand-700">
        <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <div>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-sm text-slate-600">{body}</p>
      </div>
    </li>
  );
}
