// Bounded stdin reader for pipe mode (PRD §7.3, §11.1). Reads the stream to
// completion so truncation metadata is exact, keeps the head up to the byte
// and line limits, and always reports truncation explicitly — silent
// truncation never happens.
import { Buffer } from "node:buffer";

export const MAX_STDIN_BYTES = 65536;
export const MAX_STDIN_LINES = 2000;

// Pipe-mode detection: false when stdin is an interactive terminal.
export function isPiped() {
  return !process.stdin.isTTY;
}

function countNewlines(text) {
  let n = 0;
  for (const ch of text) if (ch === "\n") n++;
  return n;
}

// Lines a reader sees in text: newline count plus one for a final
// unterminated line. "" is 0 lines; "a\nb" is 2; "a\nb\n" is 2.
function countLines(text) {
  if (text.length === 0) return 0;
  return countNewlines(text) + (text.endsWith("\n") ? 0 : 1);
}

// Longest prefix of text within a hard byte budget and a newline budget.
// Byte budget is strict: a single over-long line is cut at the byte limit
// (the mid-line finish rule in readStdin re-attaches short lines). The
// newline budget is a hard stop at the first character of the next line
// (an unterminated trailing line is allowed by the caller's line accounting).
function keepPrefix(text, maxBytes, maxNewlines) {
  if (maxBytes <= 0 || maxNewlines <= 0) return "";
  let out = "";
  let bytes = 0;
  let newlines = 0;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > maxBytes) return out; // strict byte cap
    if (newlines >= maxNewlines) return out; // hard stop at next line
    out += ch;
    bytes += size;
    if (ch === "\n") newlines += 1;
  }
  return out;
}

export async function readStdin({
  stream = process.stdin,
  maxBytes = MAX_STDIN_BYTES,
  maxLines = MAX_STDIN_LINES,
} = {}) {
  let content = "";
  let contentBytes = 0;
  let contentNewlines = 0;
  let truncated = false;

  let originalBytes = 0;
  let originalNewlines = 0;
  let originalHadContent = false;
  let originalEndsWithNewline = false;

  for await (const chunk of stream) {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    const bytes = Buffer.byteLength(text, "utf8");
    const textNewlines = countNewlines(text);

    originalBytes += bytes;
    originalNewlines += textNewlines;
    if (text.length > 0) {
      originalHadContent = true;
      originalEndsWithNewline = text.endsWith("\n");
    }

    if (truncated) continue;

    // Exact line count of content + text: newlines plus one if the combined
    // string ends mid-line. Only exact combined-line arithmetic keeps the
    // budget correct when a line spans chunk boundaries.
    const combinedEndsWithNewline =
      text.length > 0 ? text.endsWith("\n") : content.endsWith("\n");
    const combinedLines =
      contentNewlines +
      textNewlines +
      (content.length + text.length > 0 && !combinedEndsWithNewline ? 1 : 0);

    if (bytes <= maxBytes - contentBytes && combinedLines <= maxLines) {
      content += text;
      contentBytes += bytes;
      contentNewlines += textNewlines;
    } else {
      const kept = keepPrefix(text, maxBytes - contentBytes, maxLines - contentNewlines);
      content += kept;
      contentBytes += Buffer.byteLength(kept, "utf8");
      contentNewlines += countNewlines(kept);
      if (kept.length < text.length) {
        const rest = text.slice(kept.length);
        const end = rest.indexOf("\n");
        const nextLine = end === -1 ? rest : rest.slice(0, end);
        const nextLineBytes = Buffer.byteLength(nextLine, "utf8");
        const nextLineFull = end === -1 ? nextLineBytes : nextLineBytes + 1;
        if (contentNewlines < maxLines) {
          // Byte cap was binding (line budget has room): finish a short line
          // that the byte cap cut in half, unless it exceeds the full budget.
          if (rest[0] !== "\n" && nextLineBytes <= maxBytes) {
            content += nextLine;
            contentBytes += nextLineBytes;
          }
        } else if (rest[0] !== "\n" && nextLineFull > maxBytes - contentBytes) {
          // Line budget exhausted but byte cap also binds: keep the trailing
          // line's characters (unterminated) so the last line is never a stub.
          content += nextLine;
          contentBytes += nextLineBytes;
        }
      }
      truncated = true;
    }
  }

  const keptBytes = Buffer.byteLength(content, "utf8");
  const keptLines = countLines(content);
  const originalLines =
    originalNewlines + (originalHadContent && !originalEndsWithNewline ? 1 : 0);
  const notice = truncated
    ? `[stdin truncated: showing ${keptBytes} of ${originalBytes} bytes (${keptLines} of ${originalLines} lines)]`
    : null;

  return {
    content,
    truncated,
    originalBytes,
    keptBytes,
    originalLines,
    keptLines,
    notice,
  };
}
