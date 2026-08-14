import assert from "node:assert/strict";
import test from "node:test";

import { writeClipboard } from "../src/clipboard.mjs";

const text = "Zażółć 🐎";
const encoded = "WmHFvMOzxYLEhyDwn5CO";

function ttyStream(writes) {
  return {
    isTTY: true,
    write: (value) => writes.push(String(value)),
  };
}

test("writeClipboard emits the exact plain OSC 52 sequence for Unicode", () => {
  const writes = [];
  assert.equal(writeClipboard(text, { stream: ttyStream(writes), isTmux: false }), "OSC 52");
  assert.deepEqual(writes, [`\u001b]52;c;${encoded}\u0007`]);
});

test("writeClipboard emits the exact tmux passthrough sequence for Unicode", () => {
  const writes = [];
  assert.equal(writeClipboard(text, { stream: ttyStream(writes), isTmux: true }), "tmux OSC 52");
  assert.deepEqual(writes, [`\u001bPtmux;\u001b\u001b]52;c;${encoded}\u0007\u001b\\`]);
});

test("writeClipboard rejects absent and non-TTY control streams", () => {
  assert.throws(() => writeClipboard(text), /TTY control stream/);
  assert.throws(() => writeClipboard(text, { stream: { isTTY: false, write() {} } }), /TTY control stream/);
});
