"use client";

import katex from "katex";
import { useMemo } from "react";

/**
 * Renders tutor/student text as real blocks so answers read like structured
 * steps instead of one crammed paragraph:
 *   - "## Label" or a bold-only line  -> a section heading
 *   - "- item" / "1. item"            -> proper bulleted / numbered lists
 *   - $inline$ and $$block$$ LaTeX via KaTeX
 *   - **bold** and *italic*
 *   - blank lines separate paragraphs
 *
 * Without this, markdown lists from the model rendered as literal dashes
 * inside a wall of text.
 */

type Block =
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "math"; expr: string };

const BULLET = /^[-*•]\s+/;
const NUMBER = /^\d+[.)]\s+/;
const HEADING = /^#{2,4}\s+(.*)$/;
const BOLD_LINE = /^\*\*(.+?)\*\*:?$/;

function parseBlocks(text: string): Block[] {
  const lines = text.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  const starts = (t: string) =>
    HEADING.test(t) || BULLET.test(t) || NUMBER.test(t) || t.startsWith("$$");

  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i += 1;
      continue;
    }

    // Block math, possibly spanning several lines.
    if (t.startsWith("$$")) {
      const parts: string[] = [];
      let body = t.slice(2);
      let closed = false;
      if (body.endsWith("$$") && body.length >= 2) {
        body = body.slice(0, -2);
        closed = true;
      }
      parts.push(body);
      i += 1;
      while (!closed && i < lines.length) {
        const line = lines[i];
        const end = line.indexOf("$$");
        if (end >= 0) {
          parts.push(line.slice(0, end));
          closed = true;
        } else {
          parts.push(line);
        }
        i += 1;
      }
      blocks.push({ kind: "math", expr: parts.join("\n").trim() });
      continue;
    }

    const h = t.match(HEADING) ?? t.match(BOLD_LINE);
    if (h) {
      blocks.push({ kind: "heading", text: h[1].trim() });
      i += 1;
      continue;
    }

    if (BULLET.test(t)) {
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(BULLET, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (NUMBER.test(t)) {
      const items: string[] = [];
      while (i < lines.length && NUMBER.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(NUMBER, ""));
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line || starts(line)) break;
      para.push(line);
      i += 1;
    }
    blocks.push({ kind: "para", text: para.join(" ") });
  }

  return blocks;
}

export default function RichText({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);

  return (
    <div className="space-y-3.5 leading-7">
      {blocks.map((b, i) => {
        if (b.kind === "heading") {
          return (
            <p
              key={i}
              className="pt-1 text-[0.95em] font-semibold text-ink first:pt-0"
            >
              {renderSegments(b.text)}
            </p>
          );
        }
        if (b.kind === "math") {
          return (
            <div key={i} className="overflow-x-auto py-1">
              {renderMath(b.expr, true, 0)}
            </div>
          );
        }
        if (b.kind === "ul") {
          return (
            <ul key={i} className="space-y-2">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2.5">
                  <span
                    className="mt-[0.7em] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand-400"
                    aria-hidden
                  />
                  <span className="min-w-0 break-words">
                    {renderSegments(item)}
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        if (b.kind === "ol") {
          return (
            <ol key={i} className="space-y-2.5">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2.5">
                  <span className="mt-[0.15em] flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-semibold text-brand-700">
                    {j + 1}
                  </span>
                  <span className="min-w-0 break-words">
                    {renderSegments(item)}
                  </span>
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i} className="break-words">
            {renderSegments(b.text)}
          </p>
        );
      })}
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

/** Split a run of text into math and non-math parts, rendering each. */
function renderSegments(para: string) {
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
