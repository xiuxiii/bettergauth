import Link from "next/link";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { providerConfig } from "@/lib/ai/provider";
import { PROVIDER_INFO, tutorRouting } from "@/lib/privacyCopy";

// Read the provider setup on each request, so the page says what the app
// does now rather than what it did at build time.
export const dynamic = "force-dynamic";

const UPDATED = "1 October 2026";

/**
 * What MindGap does with a student's photos and words, in plain language.
 * Open without an access code (middleware), so a student or a parent can read
 * it before using the app. The "who receives it" part comes from the live
 * provider configuration via lib/privacyCopy.ts, which mirrors the routing in
 * lib/ai/provider.ts; change one and check the other.
 */
export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ back?: string }>;
}) {
  const { back } = await searchParams;
  // Same-origin paths only: "//evil.example" is a protocol-relative URL.
  const backHref = back && back.startsWith("/") && !back.startsWith("//") ? back : "/";

  const config = providerConfig();
  const routing = tutorRouting({
    anthropic: config.providers.anthropic.configured,
    deepseek: config.providers.deepseek.configured,
    defaultProvider: config.defaultProvider,
    deepseekVision: config.providers.deepseek.vision,
    studentSwitch: config.tutorSwitch,
    detectProvider: config.detectProvider,
  });

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md animate-rise px-4 pb-16 pt-[max(1rem,calc(env(safe-area-inset-top,0px)+0.5rem))] md:max-w-lg md:pt-10">
      <header className="mb-4 flex items-center gap-1">
        <Link
          href={backHref}
          aria-label="Back"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-slate-600 transition hover:bg-slate-100"
        >
          <ChevronLeft size={20} strokeWidth={1.75} aria-hidden="true" />
        </Link>
        <h1 className="font-serif text-2xl font-normal leading-[1.15] tracking-tight text-ink">
          Privacy
        </h1>
      </header>

      <p className="mb-6 px-1 text-[15px] leading-relaxed text-slate-700">
        The short version: what you photograph and type is sent to an AI tutor
        so it can answer you, and kept on this device as your history. MindGap
        has no accounts, no ads and no tracking, and it doesn&apos;t keep your
        problems.
      </p>

      <div className="space-y-6">
        <Section title="Kept on this device">
          <List
            items={[
              "Your history: problem photos, conversations and progress.",
              "Your settings: help style, focus, grade, curriculum, appearance and tutor.",
            ]}
          />
          <p>
            It stays in this browser. Clear your history any time in{" "}
            <Link href="/settings" className={linkCls}>
              Settings
            </Link>{" "}
            → Clear history, or remove everything by clearing this site&apos;s
            data in your browser. On a shared device, anyone using this browser
            can see your history.
          </p>
        </Section>

        <Section title="Sent to the AI tutor to answer you">
          <List
            items={[
              "Each photo you take or upload, once, so the tutor can find the questions on the page. Then the part you pick, to read the problem.",
              "Photos of your working, what you type, and the conversation so far on that problem.",
              "Your grade, curriculum, help style and focus, and the tutor's notes on which ideas you've found tricky, so it can pitch its help at the right level.",
            ]}
          />
          <p>
            Never your name, email or location: MindGap doesn&apos;t ask for
            them. The requests come from MindGap, not from your device, so the AI
            company doesn&apos;t see your internet address.
          </p>

          {routing.providers.length > 0 && (
            <>
              <p className="pt-1 font-medium text-ink">Who receives it</p>
              <ul className="space-y-2">
                {routing.providers.map((id) => {
                  const p = PROVIDER_INFO[id];
                  return (
                    <li
                      key={id}
                      className="rounded-md border border-hairline bg-paper px-3 py-2.5"
                    >
                      <p className="font-medium text-ink">
                        {p.product === p.company ? p.company : `${p.product}, made by ${p.company}`}{" "}
                        <span className="font-normal text-slate-500">· {p.where}</span>
                      </p>
                      <p className="mt-0.5">{p.note}</p>
                      <a
                        href={p.policy}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`mt-1 inline-flex min-h-11 items-center gap-1 ${linkCls}`}
                      >
                        {p.company}&apos;s privacy policy
                        <ExternalLink size={13} strokeWidth={1.75} aria-hidden="true" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    </li>
                  );
                })}
              </ul>
              <List items={routing.lines} />
              <p>
                Each company keeps what it receives under its own privacy
                policy, which MindGap can&apos;t change. Don&apos;t put anything
                in a photo you wouldn&apos;t want them to see.
              </p>
            </>
          )}
        </Section>

        <Section title="What MindGap itself keeps">
          <List
            items={[
              "Nothing about your problems: no photos, no text, no conversations.",
              "Daily totals, like how many problems were checked or how many hints were asked for, and roughly how many devices visited. They show whether MindGap is working and can't be traced back to you. Kept for 90 days.",
              "To stop overuse, requests are counted against a scrambled code made from your connection, never the address itself. Those counts clear within a day.",
              "If you entered an access code, a cookie remembers that it was accepted. It's the only cookie MindGap uses.",
              "The company that hosts MindGap keeps short technical logs, like any website.",
            ]}
          />
        </Section>

        <Section title="What MindGap never does">
          <List
            items={[
              "Ask for an account, your name or your email.",
              "Show ads, or sell anything about you.",
              "Use trackers or analytics from other companies.",
            ]}
          />
        </Section>

        <Section title="Good habits">
          <List
            items={[
              "Photograph just the problem. Keep names, faces and anything personal out of the frame.",
              "If you're under 13, check with a parent or guardian before using MindGap.",
            ]}
          />
        </Section>
      </div>

      <p className="mt-8 px-1 text-sm text-slate-500">
        Questions about this? Ask the person who shared MindGap with you.
      </p>
      <p className="mt-1 px-1 text-xs text-slate-500">Last updated {UPDATED}.</p>
    </main>
  );
}

const linkCls =
  "font-medium text-brand-700 underline underline-offset-4 decoration-brand-300 transition hover:decoration-brand-700";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-4 text-xs font-medium uppercase tracking-wider text-slate-500">
        {title}
      </h2>
      <div className="space-y-3 rounded-lg border border-hairline bg-surface p-4 text-sm leading-relaxed text-slate-700">
        {children}
      </div>
    </section>
  );
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2">
      {items.map((t) => (
        <li key={t} className="flex gap-2.5">
          <span aria-hidden="true" className="mt-[0.55em] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-500" />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  );
}
