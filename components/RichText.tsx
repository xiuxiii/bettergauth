"use client";

import katex from "katex";
import { useMemo } from "react";

/**
 * Renders tutor/student text with:
 *   - $inline$ and $$block$$ LaTeX via KaTeX
 *   - **bold** and *italic*
 *   - blank-line paragraph breaks
 *
 * Deliberately small: enough Markdown-lite for tutoring content without
 * pulling in a full Markdown engine.
 */
export default function RichText({ text }: { text: string }) {
  const paragraphs = useMemo(() => text.split(/\n{2,}/), [text]);

  return (
    <div className="space-y-3 leading-relaxed">
      {paragraphs.map((para, i) => (
        <p key={i} className="whitespace-pre-wrap break-words">
          {renderSegments(para)}
        </p>
      ))}
    </div>
  );
}

function renderMath(expr: string, display: boolean, key: number) {
  let html: string;
  try {
    html = katex.renderToString(expr, {
      displayMode: display,
      throwOnError: false,
    });
  } catch {
    return (
      <code key={key} className="text-rose-600">
        {expr}
      </code>
    );
  }
  return (
    <span
      key={key}
      // KaTeX output is generated from our own strings, not user HTML.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Split a paragraph into math and non-math parts, rendering each. */
function renderSegments(para: string) {
  // Match $$...$$ (block) or $...$ (inline).
  const regex = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;

  while ((m = regex.exec(para)) !== null) {
    if (m.index > last) {
      out.push(...renderInlineText(para.slice(last, m.index), key));
      key += 1000;
    }
    const block = m[1] !== undefined;
    out.push(renderMath((block ? m[1] : m[2]).trim(), block, key++));
    last = regex.lastIndex;
  }
  if (last < para.length) {
    out.push(...renderInlineText(para.slice(last), key));
  }
  return out;
}

/** Handle **bold** and *italic* in a plain-text run. */
function renderInlineText(text: string, baseKey: number): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    const key = baseKey + i + 1;
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return <span key={key}>{part}</span>;
  });
}
