import HomeUploader from "@/components/HomeUploader";
import AriaMark from "@/components/AriaMark";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-10 pt-14">
      <header className="mb-10 text-center">
        <AriaMark className="mx-auto mb-4 h-14 w-14" />
        <h1 className="font-serif text-4xl font-normal tracking-tight text-ink">
          Aria
        </h1>
        <p className="mx-auto mt-3 max-w-xs text-[15px] leading-relaxed text-slate-600">
          Snap a problem. Understand the concept behind it — not just the answer.
        </p>
      </header>

      <section className="flex-1">
        <HomeUploader />

        <ul className="mt-8 space-y-3">
          <Feature
            title="Concept-first"
            body="Focuses on the principle and the why, and skips trivial algebra."
          />
          <Feature
            title="Adapts to you"
            body="Goes deep where you're stuck, moves on where you're solid."
          />
          <Feature
            title="Answers on demand"
            body="Ask for a full worked solution whenever you want one."
          />
        </ul>
      </section>

      <footer className="mt-10 text-center text-xs text-slate-400">
        <p>Physics · Chemistry · Biology · Math — high-school level</p>
        <a href="/setup" className="mt-2 inline-block text-brand-600 hover:underline">
          Edit preferences
        </a>
      </footer>
    </main>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <li className="flex gap-3 rounded-xl border border-slate-200 bg-surface px-4 py-3 shadow-sm">
      <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-brand-500" />
      <div>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-sm text-slate-600">{body}</p>
      </div>
    </li>
  );
}
