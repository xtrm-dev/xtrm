import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  decideApproval,
  runGate,
  __resetIsTtyForTests,
  __setIsTtyForTests,
} from "../src/safety/approve.mjs";

test.afterEach(() => {
  __resetIsTtyForTests();
});

test("runGate: safe command -> status safe, no approval asked", async () => {
  let asked = 0;
  const result = await runGate({
    command: "ls",
    ctx: { askApprove: async () => { asked++; return true; } },
  });
  assert.equal(result.status, "safe");
  assert.equal(asked, 0);
});

test("runGate: dangerous command + approve -> approved", async () => {
  const result = await runGate({
    command: "rm -rf /tmp/x",
    ctx: { askApprove: async () => true },
  });
  assert.equal(result.status, "approved");
  assert.equal(result.reason, "recursive force delete");
});

test("runGate: dangerous command + deny -> denied", async () => {
  const result = await runGate({
    command: "rm -rf /tmp/x",
    ctx: { askApprove: async () => false },
  });
  assert.equal(result.status, "denied");
  assert.equal(result.reason, "recursive force delete");
});

test("decideApproval: ctx.askApprove decides", async () => {
  const approve = await decideApproval({ command: "rm -rf x", reason: "r", ctx: { askApprove: async () => true } });
  const deny = await decideApproval({ command: "rm -rf x", reason: "r", ctx: { askApprove: async () => false } });
  assert.equal(approve, "approve");
  assert.equal(deny, "deny");
});

test("decideApproval: no askApprove + non-TTY -> default deny (no hang)", async () => {
  const result = await decideApproval({ command: "rm -rf x", reason: "r", ctx: {} });
  assert.equal(result, "deny");
});

test("decideApproval: no askApprove + TTY + explicit yes -> approve", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  __setIsTtyForTests(true);
  const promise = decideApproval({ command: "rm -rf x", reason: "r", ctx: {}, input, output });
  input.write("yes\n");
  assert.equal(await promise, "approve");
});

test("decideApproval: TTY + anything-but-yes -> deny", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  __setIsTtyForTests(true);
  const promise = decideApproval({ command: "rm -rf x", reason: "r", ctx: {}, input, output });
  input.write("no thanks\n");
  assert.equal(await promise, "deny");
});

test("decideApproval: TTY + EOF -> deny", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  __setIsTtyForTests(true);
  const promise = decideApproval({ command: "rm -rf x", reason: "r", ctx: {}, input, output });
  input.end();
  assert.equal(await promise, "deny");
});

test("runGate: extraPatterns flow through to classification", async () => {
  const options = { extraPatterns: [{ pattern: "dangerzone", description: "custom" }] };
  const denied = await runGate({
    command: "run dangerzone",
    ctx: { askApprove: async () => false },
    options,
  });
  assert.equal(denied.status, "denied");
  assert.equal(denied.reason, "custom");

  const safe = await runGate({ command: "run dangerzone", ctx: {}, options: {} });
  assert.equal(safe.status, "safe");
});
