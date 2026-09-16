import assert from "node:assert/strict";
import test from "node:test";

import {
  feedbackForCommand,
  feedbackForError,
  filterTreeWithAncestors,
  flattenIssueTree,
  renderFeedback,
  renderIssueList,
  renderIssueShow,
  renderMarkdown,
  statusMatches,
  stripAnsi,
} from "../src/presentation/terminal.ts";

const plain = { color: false, width: 88 };
const rich = { color: true, width: 88 };

const TREE = [
  {
    id: "iss_root",
    locator: "XTRM-10",
    humanRef: "XTRM-10",
    title: "CLI UX closeout",
    kind: "epic",
    lifecycleState: "open",
    revision: 2,
    children: [
      {
        id: "iss_child",
        locator: "XTRM-10.1",
        humanRef: "XTRM-11",
        title: "Render issue show",
        kind: "task",
        lifecycleState: "open",
        revision: 1,
        children: [],
      },
      {
        id: "iss_done",
        locator: "XTRM-10.2",
        humanRef: "XTRM-12",
        title: "Old completed child",
        kind: "task",
        lifecycleState: "done",
        revision: 1,
        children: [],
      },
    ],
  },
];

test("flattenIssueTree preserves Epic/child depth", () => {
  const rows = flattenIssueTree(TREE);
  assert.deepEqual(rows.map((r) => [r.humanRef, r.depth]), [
    ["XTRM-10", 0],
    ["XTRM-11", 1],
    ["XTRM-12", 1],
  ]);
});

test("default active filter excludes terminal rows and keeps ancestor context", () => {
  const rows = flattenIssueTree(TREE);
  const filtered = filterTreeWithAncestors(rows, [], false);
  assert.deepEqual(filtered.map((r) => r.humanRef), ["XTRM-10", "XTRM-11"]);
  assert.equal(filtered.some((r) => r.humanRef === "XTRM-12"), false);
});

test("closed alias matches terminal states", () => {
  const done = flattenIssueTree(TREE).find((r) => r.humanRef === "XTRM-12")!;
  assert.equal(statusMatches(done, ["closed"]), true);
  assert.equal(statusMatches(done, ["open"]), false);
});

test("derived status supports in_progress and blocked without changing lifecycle", () => {
  const base = flattenIssueTree(TREE)[1]!;
  assert.equal(statusMatches({ ...base, claimed: true }, ["in_progress"]), true);
  assert.equal(statusMatches({ ...base, readinessState: "blocked" }, ["blocked"]), true);
  assert.equal(base.lifecycleState, "open");
});

test("plain issue list uses curved child indentation and no ANSI", () => {
  const text = renderIssueList(filterTreeWithAncestors(flattenIssueTree(TREE), [], false), plain);
  assert.match(text, /XTRM-10/);
  assert.match(text, /↳ ○ XTRM-11/);
  assert.equal(text.includes("\u001b["), false);
});

test("selected rich row uses tmux-style black-on-yellow mode style", () => {
  const row = { ...flattenIssueTree(TREE)[0]!, selected: true };
  const text = renderIssueList([row], rich);
  assert.match(text, /\u001b\[30;43m/);
  assert.equal(stripAnsi(text).includes("XTRM-10"), true);
});

test("issue show exposes operational state and renders Markdown contract", () => {
  const text = renderIssueShow({
    humanRef: "XTRM-10",
    locator: "XTRM-10",
    title: "CLI UX closeout",
    kind: "epic",
    lifecycleState: "open",
    revision: 2,
    readinessState: "ready",
    claim: { holder: "coordinator" },
    contract: {
      problem: "Current output is **too flat** and hides `readiness`.",
      success: ["Readable headers", "Nested children"],
      validation: ["NO_COLOR has no ANSI"],
    },
    operationalContext: { total: 4, recent: [{ kind: "result", sequence: 4 }] },
    provenance: { eventCount: 8, lastEventType: "receipt.bound" },
  }, plain);
  assert.match(text, /XTRM-10  CLI UX closeout/);
  assert.match(text, /OPEN\s+EPIC\s+READY/);
  assert.match(text, /PROBLEM/);
  assert.match(text, /too flat/);
  assert.match(text, /• Readable headers/);
  assert.match(text, /Journal 4 entries/);
  assert.match(text, /Provenance 8 events/);
});

test("Markdown renderer keeps sparse terminal structure", () => {
  const lines = renderMarkdown("## Heading\n- one\n- `two`\n\nplain", plain);
  assert.deepEqual(lines, ["  Heading", "  • one", "  • two", "  ", "  plain"]);
});

test("mutation feedback is explicit and terse", () => {
  const created = feedbackForCommand("issue.create", ["issue", "create"], { humanRef: "XTRM-99", title: "New work" });
  assert.equal(created.level, "success");
  assert.match(renderFeedback(created, plain), /^✓ Created XTRM-99 · New work/);

  const noop = feedbackForCommand("issue.release", ["issue", "release", "XTRM-99"], { released: false });
  assert.equal(noop.level, "noop");
  assert.match(renderFeedback(noop, plain), /^○ No live claim was released/);
});

test("errors state what failed and suggest a next action", () => {
  const feedback = feedbackForError("issue.list", "this repository is not initialized; run 'sb init'");
  const text = renderFeedback(feedback, plain);
  assert.match(text, /^✗ issue\.list failed/);
  assert.match(text, /repository is not initialized/);
  assert.match(text, /next: sb init/);
});
