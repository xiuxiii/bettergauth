import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aria — STEM Tutor",
  description:
    "Snap a high-school STEM problem and learn the concept behind it, not just the answer.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Intentionally do NOT cap maximumScale: students must be able to pinch-zoom
  // into equations and the problem photo (accessibility — WCAG 1.4.4).
  themeColor: "#3563ff",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
