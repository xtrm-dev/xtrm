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

// Longest char-prefix of text within a byte budget and a newline budget.
// Code-point safe (iterates characters, never splits UTF-8 sequences). The
// newline budget is exact for the string being built: it allows up to
// maxNewlines newline-terminated lines, or maxNewlines - 1 newlines plus one
// unterminated trailing line.
function keepPrefix(text, maxBytes, maxNewlines) {
  if (maxBytes <= 0 || maxNewlines <= 0) return "";
  let out = "";
  let bytes = 0;
  let newlines = 0;
  for (const ch of text) {
    const size = Buffer.byteLength(ch, "utf8");
    if (bytes + size > maxBytes) break;
    if (newlines >= maxNewlines) break;
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
      content += keepPrefix(text, maxBytes - contentBytes, maxLines - contentNewlines);
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
