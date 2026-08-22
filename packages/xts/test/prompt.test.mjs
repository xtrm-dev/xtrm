import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INSTRUCTION,
  SYSTEM_PROMPT,
  buildSystemPrompt,
  buildUserMessage,
  estimateTokens,
} from "../src/prompt.mjs";

const stdinFixture = {
  content: "line1\nline2\n",
  truncated: false,
  originalBytes: 12,
  keptBytes: 12,
  originalLines: 2,
  keptLines: 2,
  notice: null,
};

const truncatedFixture = {
  content: "prefix",
  truncated: true,
  originalBytes: 1000,
  keptBytes: 6,
  originalLines: 50,
  keptLines: 1,
  notice: "[stdin truncated: showing 6 of 1000 bytes (1 of 50 lines)]",
};

const contextFixture = {
  cwd: "/home/user/proj",
  shell: "bash",
  lastExitCode: 1,
  recentCommands: ["git status", "git pull"],
  source: "hook",
};

test("SYSTEM_PROMPT stays within the ~200 token budget", () => {
  const tokens = estimateTokens(SYSTEM_PROMPT);
  assert.ok(tokens < 200, `SYSTEM_PROMPT estimated ${tokens} tokens, must be < 200`);
  assert.ok(SYSTEM_PROMPT.length < 800, `SYSTEM_PROMPT is ${SYSTEM_PROMPT.length} chars`);
});

test("buildSystemPrompt returns the fixed SYSTEM_PROMPT", () => {
  assert.equal(buildSystemPrompt(), SYSTEM_PROMPT);
});

test("envelope with instruction + stdin + context contains all parts", () => {
  const msg = buildUserMessage({
    instruction: "what is the time?",
    stdin: stdinFixture,
    shellContext: contextFixture,
  });
  assert.match(msg, /what is the time\?/);
  assert.match(msg, /\[stdin evidence — 12 bytes\]/);
  assert.match(msg, /line1\nline2/);
  assert.match(msg, /\[shell context\]/);
  assert.match(msg, /cwd: \/home\/user\/proj/);
  assert.match(msg, /shell: bash/);
  assert.match(msg, /last exit code: 1/);
  assert.match(msg, /recent commands \(last 2\):/);
  assert.match(msg, /  git status/);
});

test("truncation notice appears when stdin.truncated", () => {
  const msg = buildUserMessage({
    instruction: "summarize",
    stdin: truncatedFixture,
    shellContext: null,
  });
  assert.match(msg, /\[stdin truncated: showing 6 of 1000 bytes \(1 of 50 lines\)\]/);
});

test("no stdin -> no stdin block; no context -> no context block", () => {
  const msg = buildUserMessage({
    instruction: "hello",
    stdin: null,
    shellContext: null,
  });
  assert.doesNotMatch(msg, /stdin evidence/);
  assert.doesNotMatch(msg, /shell context/);
  assert.match(msg, /hello/);
});

test("empty instruction -> sensible default text", () => {
  const msg = buildUserMessage({
    instruction: "",
    stdin: null,
    shellContext: null,
  });
  assert.equal(msg, DEFAULT_INSTRUCTION);
});

test("whitespace-only instruction -> default text", () => {
  const msg = buildUserMessage({
    instruction: "   ",
    stdin: null,
    shellContext: null,
  });
  assert.equal(msg, DEFAULT_INSTRUCTION);
});

test("stdin alone (no instruction) renders stdin as primary evidence", () => {
  const msg = buildUserMessage({
    instruction: "",
    stdin: stdinFixture,
    shellContext: null,
  });
  assert.match(msg, /^Describe the current shell state and answer any implied question\.\n\n\[stdin evidence — 12 bytes\]/);
  assert.match(msg, /line1\nline2/);
});

test("estimateTokens is a ceil length/4 heuristic", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
});

test("SYSTEM_PROMPT includes the optional HINT teaching instruction", () => {
  assert.match(SYSTEM_PROMPT, /HINT:/);
  assert.match(SYSTEM_PROMPT, /skip it/i);
});
