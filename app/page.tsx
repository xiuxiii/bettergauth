import HomeDashboard from "@/components/HomeDashboard";
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

        {/* Where they left off and what keeps going wrong, from on-device
            history. Renders nothing for a brand-new student. */}
        <div className="mt-8 md:mt-0">
          <HomeDashboard />
        </div>
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
