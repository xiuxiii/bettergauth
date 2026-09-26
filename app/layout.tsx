import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Newsreader } from "next/font/google";
import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import ThemeWatcher from "@/components/ThemeWatcher";

// MindGap's type system: Hanken Grotesk for UI, Newsreader for display/serif.
const sans = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const serif = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});

const DESCRIPTION =
  "Snap a high-school STEM problem and find the gap in your understanding — not just the answer.";

export const metadata: Metadata = {
  // Just the name. The title is what an installed PWA is labelled with on the
  // home screen and in app search, and no app ships with its slogan in its name.
  title: "MindGap",
  description: DESCRIPTION,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "MindGap" },
  openGraph: {
    title: "MindGap",
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Intentionally do NOT cap maximumScale: students must be able to pinch-zoom
  // into equations and the problem photo (accessibility — WCAG 1.4.4).
  themeColor: "#4E54DD",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the inline script below sets data-theme and
    // color-scheme on <html> before React hydrates, so the server markup and
    // the live DOM legitimately differ on this element.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${serif.variable}`}
    >
      <head>
        {/* Must be inline, in <head>, and before any content: a deferred or
            bundled script runs after the first paint, which is exactly the
            dark-flash-on-a-light-theme this prevents. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans">
        <ThemeWatcher />
        {children}
      </body>
    </html>
  );
}
