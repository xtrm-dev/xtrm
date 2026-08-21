import assert from "node:assert/strict";
import test from "node:test";

import { ConversationView, MD_THEME, buildHeader, collapseCommand, formatToolRow } from "../src/ui/app.mjs";
import { Markdown, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

const strip = stripTerminalSequences;

test("Markdown codeBlock theme returns styled text, not a renderer function", () => {
  assert.equal(typeof MD_THEME.codeBlock("const answer = 1;"), "string");
});

test("Markdown quoteBorder styles the supplied border text", () => {
  assert.match(MD_THEME.quoteBorder("quoted border"), /quoted border/);
});

test("real Markdown rendering applies ANSI theme styling to markdown blocks", () => {
  const markdown = new Markdown(
    "# Heading\n\n**bold** and `inline` and [link](https://example.test)\n\n> quoted\n\n```js\nconst answer = 42;\n```",
    0,
    0,
    MD_THEME,
  );
  const output = markdown.render(120).join("\n");

  assert.match(output, /\x1b\[1m/, "heading/bold styling must be emitted");
  assert.match(output, /\x1b\[2m/, "dim styling must be emitted");
  assert.match(output, /\x1b\[36m/, "cyan styling must be emitted");
  assert.match(output, /\x1b\[2m│ \x1b\[0mquoted/, "quote border and text must render correctly");
  assert.match(output, /\x1b\[2m```js\x1b\[0m/, "code-block fence must render as markdown output");
  assert.match(output, /  \x1b\[2mconst answer = 42;\x1b\[0m/, "code-block content must render as a line");
});

test("conversation transcript is append-only across pre-tool and final answers", () => {
  const view = new ConversationView({});
  try {
    view.appendUserMessage("first question");
    view.appendAssistantDelta("pre-tool answer");
    view.appendAssistantComplete();
    view.appendToolRow("echo done", "done");
    view.appendAssistantDelta("final answer");
    view.appendAssistantComplete();
    const output = strip(view.body.render(120).join("\n"));
    assert.ok(output.indexOf("first question") < output.indexOf("pre-tool answer"));
    assert.ok(output.indexOf("pre-tool answer") < output.indexOf("$ echo done"));
    assert.ok(output.indexOf("$ echo done") < output.indexOf("final answer"));
  } finally {
    view.close();
  }
});

test("successful tool results update the retained command preview", () => {
  const view = new ConversationView({});
  try {
    view.appendToolRow("echo answer");
    view.appendToolResult("answer");
    const output = strip(view.body.render(120).join("\n"));
    assert.match(output, /\$ echo answer/);
    assert.match(output, /answer/);
  } finally {
    view.close();
  }
});

test("persistent session messages render in chronological order", () => {
  const view = new ConversationView({});
  try {
    view.appendSessionMessages([
      { role: "user", content: "restored question" },
      { role: "assistant", content: [{ type: "text", text: "restored answer" }] },
      { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "restored output" }] },
    ]);
    const output = strip(view.body.render(120).join("\n"));
    assert.ok(output.indexOf("restored question") < output.indexOf("restored answer"));
    assert.ok(output.indexOf("restored answer") < output.indexOf("restored output"));
  } finally {
    view.close();
  }
});

test("hydrated bashExecution keeps one command/output row", () => {
  const view = new ConversationView({});
  try {
    view.appendSessionMessages([
      { role: "bashExecution", command: "echo restored", output: "restored output", exitCode: 0 },
      { role: "toolResult", toolName: "bash", content: [{ type: "text", text: "restored output" }] },
    ]);
    const output = strip(view.body.render(120).join("\n"));
    assert.equal((output.match(/\$ echo restored/g) ?? []).length, 1);
    assert.equal((output.match(/restored output/g) ?? []).length, 1);
  } finally {
    view.close();
  }
});

test("busy state blocks submission and Ctrl+C aborts tool-only work", () => {
  let prompted = 0;
  let aborted = 0;
  const view = new ConversationView({ onPrompt: () => prompted++, onAbort: () => aborted++ });
  try {
    view.setReady(true);
    view.setBusy(true);
    view.submit("blocked");
    assert.equal(prompted, 0);
    view.handleCtrlC();
    assert.equal(aborted, 1);
  } finally {
    view.close();
  }
});

test("submission is ignored until the session is ready", () => {
  let prompted = 0;
  const view = new ConversationView({ onPrompt: () => prompted++ });
  try {
    view.submit("too early");
    assert.equal(prompted, 0);
    assert.equal(view.busy, false);
    view.setReady(true);
    view.submit("ready now");
    assert.equal(prompted, 1);
  } finally {
    view.close();
  }
});

test("buildHeader contains cwd and model", () => {
  const line = buildHeader({ cwd: "/home/dev/xtrm", model: "anthropic/claude-sonnet" });
  assert.match(line, /xts/);
  assert.match(line, /\/home\/dev\/xtrm/);
  assert.match(line, /anthropic\/claude-sonnet/);
});

test("buildHeader renders a full-width top border", () => {
  const line = buildHeader({ cwd: "/tmp", model: "openai/gpt-5.6" });
  assert.match(line, /^╭─/);
  assert.match(line, /╮$/);
  // Both endpoints are box-drawing characters; the line is one piece.
  assert.ok(visibleWidth(line) > 10);
});

test("buildHeader truncates a very long model label", () => {
  const line = buildHeader({ cwd: "/tmp", model: "commandcode/deepseek/deepseek-v4-flash" });
  // Must not exceed a sane header width even with a long model.
  assert.ok(visibleWidth(line) <= 120);
  assert.match(strip(line), /commandcode/);
});

test("formatToolRow shows $ command and a one-line preview", () => {
  const lines = formatToolRow("git status --short", "M src/runtime.ts\n", 3);
  assert.equal(lines[0], "\x1b[32m$\x1b[0m git status --short");
  assert.equal(lines.length, 2);
  assert.match(strip(lines[1]), /M src\/runtime\.ts/);
});

test("formatToolRow bounds output to 3 lines with an ellipsis", () => {
  const output = ["a", "b", "c", "d", "e"].join("\n");
  const lines = formatToolRow("ls -la", output, 3);
  assert.equal(lines.length, 5); // 1 command + 3 preview + 1 ellipsis
  assert.match(strip(lines[1]), /a/);
  assert.match(strip(lines[4]), /2 more line/);
});

test("formatToolRow with empty output renders only the command", () => {
  const lines = formatToolRow("echo hi", "", 3);
  assert.equal(lines.length, 1);
});

test("collapseCommand collapses whitespace", () => {
  assert.equal(collapseCommand("git   status\n --short"), "git status --short");
  assert.equal(collapseCommand("  "), "");
});

test("completed transcript retains final component state", () => {
  const view = new ConversationView({});
  try {
    view.appendUserMessage("question");
    view.appendAssistantDelta("answer");
    view.appendAssistantComplete();
    assert.equal(view.state.kind, "idle");
    assert.equal(view.assistant, null);
    assert.match(strip(view.body.render(120).join("\n")), /question[\s\S]*answer/);
  } finally {
    view.close();
  }
});

test("formatToolRow collapses a multi-line command to one line", () => {
  const [first] = formatToolRow("git\nstatus", "", 3);
  assert.match(strip(first), /git status/);
});
