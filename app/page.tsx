import HomeUploader from "@/components/HomeUploader";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-10 pt-14">
      <header className="mb-10 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white shadow-md">
          {/* Logo placeholder */}
          Ai
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">
          Aria STEM Tutor
        </h1>
        <p className="mx-auto mt-2 max-w-xs text-sm text-slate-600">
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
    <li className="flex gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-brand-500" />
      <div>
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="text-sm text-slate-600">{body}</p>
      </div>
    </li>
  );
}
