/**
 * The text-splitting half of components/RichText.tsx, kept pure (no React) so
 * the rules can be unit-tested (`npm test`).
 *
 * The rules are the ones pandoc uses, because the obvious ones mangle ordinary
 * text: "costs $5 and batteries $3" became math-italic "5andbatteries3", and
 * "9.8*2*20" lost its asterisks to an italic "2".
 *
 * No lookbehind anywhere: it is a syntax error in Safari before 16.4, and one
 * bad regex literal would take down the whole bundle on those phones.
 */

export type MathSegment =
  | { kind: "text"; text: string }
  | { kind: "math"; text: string; block: boolean };

/**
 * `$$…$$` is display math. `$…$` is inline math only when the opening `$` is
 * followed by a non-space, the closing `$` is preceded by a non-space, and the
 * closing `$` is not followed by a digit. So "$5 and $3" (a space before the
 * would-be closing `$`) and "$5.00" stay text, while "$x$" and "$v = 19.8$"
 * are math.
 */
const MATH = /\$\$([\s\S]+?)\$\$|\$(?=\S)([^$\n]*?\S)\$(?!\d)/g;

export function splitMath(para: string): MathSegment[] {
  const out: MathSegment[] = [];
  const re = new RegExp(MATH.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(para)) !== null) {
    if (m.index > last) out.push({ kind: "text", text: para.slice(last, m.index) });
    const block = m[1] !== undefined;
    out.push({ kind: "math", text: (block ? m[1] : m[2]).trim(), block });
    last = re.lastIndex;
  }
  if (last < para.length) out.push({ kind: "text", text: para.slice(last) });
  return out;
}

export type EmphasisSegment = { kind: "text" | "strong" | "em"; text: string };

/**
 * `**bold**` and `*italic*`, only as emphasis: the opening marker must not
 * follow a letter, digit or another `*`, the text inside must start and end
 * with a non-space, and the closing marker must not be followed by a letter,
 * digit or `*`. So "9.8*2*20" and "x*y*z" stay literal. Group 1 captures the
 * character before the marker (instead of a lookbehind) and is kept as text.
 */
const EMPHASIS =
  /(^|[^\w*])(?:\*\*(?=\S)([^*]*?\S)\*\*|\*(?=\S)([^*\n]*?\S)\*)(?![\w*])/g;

export function splitEmphasis(text: string): EmphasisSegment[] {
  const out: EmphasisSegment[] = [];
  const re = new RegExp(EMPHASIS.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const start = m.index + m[1].length;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start) });
    out.push(
      m[2] !== undefined ? { kind: "strong", text: m[2] } : { kind: "em", text: m[3] },
    );
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
