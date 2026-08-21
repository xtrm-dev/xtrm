// Bounded stdin reader for pipe mode (PRD §7.3, §11.1). Reads the stream to
// completion so truncation metadata is exact, keeps the head up to the byte
// and line limits, and always reports truncation explicitly — silent
// truncation never happens.
import { Buffer } from "node:buffer";
import { StringDecoder } from "node:string_decoder";

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

function limit(value, fallback) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}

export async function readStdin({
  stream = process.stdin,
  maxBytes = MAX_STDIN_BYTES,
  maxLines = MAX_STDIN_LINES,
} = {}) {
  const byteLimit = limit(maxBytes, MAX_STDIN_BYTES);
  const lineLimit = limit(maxLines, MAX_STDIN_LINES);
  const decoder = new StringDecoder("utf8");
  let content = "";
  let contentBytes = 0;
  let contentNewlines = 0;
  let truncated = false;

  let originalBytes = 0;
  let originalNewlines = 0;
  let originalHadContent = false;
  let originalEndsWithNewline = false;

  const consume = (text) => {
    if (text.length === 0) return;

    originalHadContent = true;
    originalEndsWithNewline = text.endsWith("\n");
    originalNewlines += countNewlines(text);

    if (truncated) return;

    for (const ch of text) {
      const size = Buffer.byteLength(ch, "utf8");
      const nextLines = contentNewlines + 1;
      if (contentBytes + size > byteLimit || nextLines > lineLimit) {
        truncated = true;
        return;
      }
      content += ch;
      contentBytes += size;
      if (ch === "\n") contentNewlines++;
    }
  };

  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    originalBytes += bytes.byteLength;
    consume(decoder.write(bytes));
  }
  consume(decoder.end());

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
