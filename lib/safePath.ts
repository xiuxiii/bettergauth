/**
 * A `?back=` value made safe to navigate to: a path on THIS site, or "/".
 *
 * `startsWith("/") && !startsWith("//")` was not enough: browsers read
 * "/\evil.example" and "/<TAB>/evil.example" as "//evil.example", a link to
 * another site. /privacy is open before the access gate, so a crafted
 * `/privacy?back=/%5Cevil.example` link could send a student from a real
 * MindGap page to a look-alike "enter your access code" page.
 *
 * Pure, so `npm test` checks it.
 */
export function safeBackPath(back: string | null | undefined): string {
  if (!back || !back.startsWith("/") || back.startsWith("//")) return "/";
  // Backslashes, whitespace and control characters have no business in one of
  // our paths, and each has a browser quirk that turns it into a host.
  if (/[\\\s\u0000-\u001f\u007f]/.test(back)) return "/";
  const base = "https://same-origin.invalid";
  let url: URL;
  try {
    url = new URL(back, base);
  } catch {
    return "/";
  }
  if (url.origin !== base) return "/";
  return url.pathname + url.search + url.hash;
}
