import Link from "next/link";
import { Settings } from "lucide-react";
import HomeDashboard from "@/components/HomeDashboard";
import HomeUploader from "@/components/HomeUploader";
import MindGapMark from "@/components/MindGapMark";
import Wordmark from "@/components/Wordmark";

export default function HomePage() {
  return (
    <main className="relative mx-auto flex min-h-dvh w-full max-w-md animate-rise flex-col px-5 pb-10 pt-[max(3.5rem,calc(env(safe-area-inset-top,0px)+2rem))] md:max-w-3xl md:px-8 md:pt-20">
      {/* Settings, top-right at every size. Positioned out of the flow so the
          centred header below keeps its place on phones. */}
      <Link
        href="/settings"
        aria-label="Settings"
        className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top,0px))] flex h-11 w-11 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-ink md:right-5 md:top-6"
      >
        <Settings size={20} strokeWidth={1.75} aria-hidden="true" />
      </Link>

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

        {/* Where they left off and what keeps going wrong, from on-device
            history. Renders nothing for a brand-new student. */}
        <div className="mt-8 md:mt-0">
          <HomeDashboard />
        </div>
      </div>

      <footer className="mt-10 text-center text-xs text-slate-500">
        <p>Physics · Chemistry · Math</p>
        <Link
          href="/privacy"
          className="mt-1 inline-flex min-h-11 items-center px-2 underline-offset-4 transition hover:text-ink hover:underline"
        >
          Privacy
        </Link>
      </footer>
    </main>
  );
}
