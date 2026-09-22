import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, Newsreader } from "next/font/google";
import "./globals.css";

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
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
