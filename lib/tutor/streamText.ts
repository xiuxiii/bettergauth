/**
 * Helpers for rendering a tutor reply while it is still being generated.
 *
 * The tutor turn is a *structured output* — the model emits one JSON object
 * (`{ message, hasMore, memory }`) and the SDK streams it to us as raw JSON
 * text. `message` is declared first in the schema, so it arrives first, while
 * the model is still writing the memory blob that follows it. These two pure
 * functions turn that raw stream into something safe to show.
 *
 * Nothing here is authoritative. Display is best effort; the real values come
 * from the SDK's validated `parsed_output` when the stream finishes. If a
 * decoder ever desyncs, the final frame overwrites whatever it produced.
 */

/** Where the value of the `"message"` key starts, or -1 if not yet streamed. */
function findMessageValueStart(raw: string): number {
  const key = raw.indexOf('"message"');
  if (key === -1) return -1;
  let i = key + '"message"'.length;
  while (i < raw.length && /\s/.test(raw[i])) i += 1;
  if (raw[i] !== ":") return -1;
  i += 1;
  while (i < raw.length && /\s/.test(raw[i])) i += 1;
  if (raw[i] !== '"') return -1;
  return i + 1;
}

const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/**
 * Decode as much of the `message` string as is unambiguously complete.
 *
 * Always decodes from the start of the value rather than resuming mid-stream.
 * That costs a re-scan per chunk (the buffer is only a few KB) and in exchange
 * removes the whole class of split-escape bugs: a chunk ending on `\u00` simply
 * stops the walk, and the next chunk re-decodes the now-complete `é`.
 */
function decodeMessage(raw: string): { text: string; closed: boolean } {
  const start = findMessageValueStart(raw);
  if (start === -1) return { text: "", closed: false };

  let out = "";
  let i = start;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') return { text: out, closed: true };
    if (c !== "\\") {
      out += c;
      i += 1;
      continue;
    }
    // An escape needs its payload; without it, stop and wait for more.
    if (i + 1 >= raw.length) break;
    const e = raw[i + 1];
    if (e === "u") {
      if (i + 5 >= raw.length) break; // \uXXXX split across chunks
      const hex = raw.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
      out += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    const mapped = ESCAPES[e];
    if (mapped === undefined) break; // malformed; let the final parse decide
    out += mapped;
    i += 2;
  }
  return { text: out, closed: false };
}

/**
 * Feed raw JSON chunks in, get newly decoded message text out.
 * Returns "" whenever a chunk adds nothing displayable yet.
 */
export function createMessageFieldDecoder(): (chunk: string) => string {
  let raw = "";
  let emitted = 0;
  let closed = false;

  return (chunk: string) => {
    if (closed) return "";
    raw += chunk;
    const { text, closed: isClosed } = decodeMessage(raw);
    closed = isClosed;
    if (text.length <= emitted) return "";
    const delta = text.slice(emitted);
    emitted = text.length;
    return delta;
  };
}

/** Index of the earliest delimiter that was opened and never closed, or -1. */
function unclosedMathAt(text: string): number {
  let i = 0;
  let open = -1;
  let openLen = 0;

  while (i < text.length) {
    if (text[i] === "\\") {
      i += 2; // escaped char, e.g. a literal \$
      continue;
    }
    if (text.startsWith("$$", i)) {
      if (open === -1) {
        open = i;
        openLen = 2;
      } else if (openLen === 2) {
        open = -1;
        openLen = 0;
      }
      i += 2;
      continue;
    }
    if (text[i] === "$") {
      if (open === -1) {
        open = i;
        openLen = 1;
      } else if (openLen === 1) {
        open = -1;
        openLen = 0;
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  return open;
}

/**
 * Index of an unclosed `**` or `*` emphasis run, or -1.
 *
 * A `*` that opens a line and is followed by whitespace is a bullet marker, not
 * emphasis (RichText's BULLET is /^[-*•]\s+/), so it must not count.
 */
function unclosedEmphasisAt(text: string): number {
  let i = 0;
  let openDouble = -1;
  let openSingle = -1;
  let atLineStart = true;

  while (i < text.length) {
    const c = text[i];
    if (c === "\n") {
      atLineStart = true;
      i += 1;
      continue;
    }
    if (text.startsWith("**", i)) {
      openDouble = openDouble === -1 ? i : -1;
      atLineStart = false;
      i += 2;
      continue;
    }
    if (c === "*") {
      if (atLineStart && /\s/.test(text[i + 1] ?? " ")) {
        atLineStart = false; // bullet marker
        i += 1;
        continue;
      }
      openSingle = openSingle === -1 ? i : -1;
      atLineStart = false;
      i += 1;
      continue;
    }
    if (!/[ \t]/.test(c)) atLineStart = false;
    i += 1;
  }

  const open = [openDouble, openSingle].filter((n) => n >= 0);
  return open.length ? Math.min(...open) : -1;
}

/** A trailing line that is only a list/heading marker with no content yet. */
const BARE_MARKER = /(^|\n)[ \t]*(?:#{1,4}|[-*•]|\d+[.)])[ \t]*$/;

/**
 * The largest prefix of `text` that RichText can render without artifacts.
 *
 * Without this, mid-generation output is actively broken rather than merely
 * incomplete: an unclosed `$$` makes parseBlocks swallow every remaining line
 * into one block that KaTeX renders as red error text, `**bold*` briefly shows a
 * stray asterisk plus italics, and a bare `##` shows as literal hashes.
 *
 * Granularity is deliberately word level, not line level. A paragraph is a
 * single line in the model's output, so holding back incomplete lines would hold
 * back whole paragraphs and defeat the point.
 *
 * Pass `done` for the final render: the text is complete, so it is returned whole.
 */
export function safePrefix(text: string, done = false): string {
  if (done) return text;

  // Order matters. The half-word trim has to happen FIRST: run last, it can cut
  // inside an already-complete `$F = ma$` and re-break the very balance the
  // other rules just established.
  let out = text;

  const lastSpace = out.search(/\s\S*$/);
  out = lastSpace >= 0 ? out.slice(0, lastSpace + 1) : "";

  const math = unclosedMathAt(out);
  if (math >= 0) out = out.slice(0, math);

  const emphasis = unclosedEmphasisAt(out);
  if (emphasis >= 0) out = out.slice(0, emphasis);

  // Trimming a word can expose a marker that is now bare, so drop to a fixed
  // point rather than once.
  for (;;) {
    const marker = out.match(BARE_MARKER);
    if (!marker) break;
    out = out.slice(0, marker.index! + (marker[1] ? 1 : 0));
  }

  return out.replace(/\s+$/, "");
}
