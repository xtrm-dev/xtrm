import assert from "node:assert/strict";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";

import {
  MAX_STDIN_BYTES,
  MAX_STDIN_LINES,
  readStdin,
} from "../src/stdin.mjs";

function fromChunks(chunks) {
  return Readable.from(chunks);
}

test("small stdin passes through whole", async () => {
  const result = await readStdin({ stream: fromChunks(["hello world\n"]) });
  assert.equal(result.content, "hello world\n");
  assert.equal(result.truncated, false);
  assert.equal(result.notice, null);
  assert.equal(result.originalBytes, 12);
  assert.equal(result.keptBytes, 12);
  assert.equal(result.originalLines, 1);
  assert.equal(result.keptLines, 1);
});

test("empty stdin -> empty content, no truncation", async () => {
  const result = await readStdin({ stream: fromChunks([]) });
  assert.deepEqual(result, {
    content: "",
    truncated: false,
    originalBytes: 0,
    keptBytes: 0,
    originalLines: 0,
    keptLines: 0,
    notice: null,
  });
});

test("huge stdin is truncated with exact metadata and notice", async () => {
  const big = "x".repeat(200 * 1024); // 200 KiB, no newlines
  const result = await readStdin({ stream: fromChunks([big]) });
  assert.equal(result.truncated, true);
  assert.equal(result.originalBytes, 200 * 1024);
  assert.ok(result.keptBytes <= MAX_STDIN_BYTES, `kept ${result.keptBytes} > ${MAX_STDIN_BYTES}`);
  assert.equal(result.content.length, result.keptBytes);
  assert.equal(result.originalLines, 1);
  assert.equal(result.keptLines, 1);
  assert.match(result.notice, /^\[stdin truncated: showing \d+ of \d+ bytes \(\d+ of \d+ lines\)\]$/);
});

test("many-lines stdin is truncated by line count with notice", async () => {
  const line = "y".repeat(10);
  const text = Array.from({ length: 5000 }, () => line).join("\n") + "\n";
  const result = await readStdin({ stream: fromChunks([text]) });
  assert.equal(result.truncated, true);
  assert.equal(result.originalLines, 5000);
  assert.ok(result.keptLines <= MAX_STDIN_LINES, `kept ${result.keptLines} > ${MAX_STDIN_LINES}`);
  assert.ok(result.keptLines > 0);
  assert.equal(result.content.split("\n").length - 1, result.keptLines);
  assert.match(result.notice, /^\[stdin truncated: showing \d+ of \d+ bytes \(\d+ of 5000 lines\)\]$/);
});

test("a line spanning chunk boundaries counts once", async () => {
  // The line break lands exactly on a 3-char chunk boundary, so naive
  // per-chunk newline counting would over-count if content were truncated.
  const result = await readStdin({
    stream: fromChunks(["abc\n", "def\n", "ghi\n"]),
    maxBytes: 6,
    maxLines: 10,
  });
  assert.equal(result.content, "abc\ndef");
  assert.equal(result.truncated, true);
  assert.equal(result.originalLines, 3);
  assert.equal(result.keptLines, 2);
});

test("byte and line limits both apply, smaller wins", async () => {
  const result = await readStdin({
    stream: fromChunks(["a\nb\nc\nd\n"]),
    maxBytes: 5,
    maxLines: 2,
  });
  assert.equal(result.content, "a\nb\nc");
  assert.equal(result.truncated, true);
  assert.equal(result.originalLines, 4);
  assert.equal(result.keptLines, 3);
});

test("works with a PassThrough stream", async () => {
  const stream = new PassThrough();
  const promise = readStdin({ stream });
  stream.end("some piped text\n");
  const result = await promise;
  assert.equal(result.content, "some piped text\n");
  assert.equal(result.truncated, false);
  assert.equal(result.originalLines, 1);
});

test("exports documented constants", () => {
  assert.equal(MAX_STDIN_BYTES, 65536);
  assert.equal(MAX_STDIN_LINES, 2000);
});
