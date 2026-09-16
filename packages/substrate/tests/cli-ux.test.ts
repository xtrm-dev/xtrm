import assert from "node:assert/strict";
import test from "node:test";

import {
  feedbackForCommand,
  feedbackForError,
  filterTreeWithAncestors,
  flattenIssueTree,
  isKnownStatusFilter,
  renderFeedback,
  renderIssueList,
  renderIssueShow,
  renderMarkdown,
  statusMatches,
  stripAnsi,
  tokenizeBrowseKeys,
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

test("plain issue list shows the hierarchical locator, the kind, an epic marker and no ANSI", () => {
  const text = renderIssueList(filterTreeWithAncestors(flattenIssueTree(TREE), [], false), plain);
  assert.match(text, /◆ XTRM-10/);
  assert.match(text, /XTRM-10\.1/);
  assert.match(text, /EPIC/);
  assert.match(text, /TASK/);
  assert.equal(text.includes("XTRM-11"), false, "the flat humanRef must not replace the hierarchical locator");
  assert.equal(text.includes("\u001b["), false);
});

test("browse key tokenizer applies every key of one chunk", () => {
  assert.deepEqual(tokenizeBrowseKeys("jj"), ["j", "j"]);
  assert.deepEqual(tokenizeBrowseKeys("\u001b[B\u001b[B"), ["down", "down"]);
  assert.deepEqual(tokenizeBrowseKeys("\u001b[Bjq"), ["down", "j", "q"]);
  assert.deepEqual(tokenizeBrowseKeys("\u001b[A"), ["up"]);
  assert.deepEqual(tokenizeBrowseKeys("\u0003"), ["quit"]);
  assert.deepEqual(tokenizeBrowseKeys("\u0003j"), ["quit", "j"]);
  assert.deepEqual(tokenizeBrowseKeys("\r"), ["enter"]);
  assert.deepEqual(tokenizeBrowseKeys("\u007f"), ["backspace"]);
  assert.deepEqual(tokenizeBrowseKeys("\u001b"), ["escape"]);
});

test("status filters accept the documented set and reject a typo", () => {
  for (const ok of ["open", "in_progress", "READY", "blocked", "deferred", "done", "cancelled", "archived", "closed", "terminal", "all"]) {
    assert.equal(isKnownStatusFilter(ok), true, ok);
  }
  assert.equal(isKnownStatusFilter("nonsense"), false);
});

test("create confirmation names the ref, the kind and the title", () => {
  const created = feedbackForCommand("issue.create", ["issue", "create"], { humanRef: "XTRM-99", kind: "task", title: "New work" });
  assert.match(renderFeedback(created, plain), /^✓ Created XTRM-99 \[task\] · New work/);
});

test("unresolvable refs and unknown verbs carry a next action", () => {
  const ref = renderFeedback(feedbackForError("issue.show", "unresolvable ref: NOPE-999"), plain);
  assert.match(ref, /next: sb issue list --all/);
  const verb = renderFeedback(feedbackForError("issue.frobnicate", "unknown issue verb: frobnicate"), plain);
  assert.match(verb, /next: sb help/);
  const outcome = renderFeedback(feedbackForError("issue.close", "unknown closure outcome: bogus"), plain);
  assert.match(outcome, /next: sb help issue close/);
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
    operationalContext: {
      total: 4,
      countsByKind: { checkpoint: 1, finding: 3 },
      recent: [
        { kind: "checkpoint", sequence: 3, summary: "Confirmed the **bounded** read is intact." },
        { kind: "finding", sequence: 4, summary: '{"summary":"Second finding prose."}' },
      ],
      latestByKind: [
        { kind: "finding", sequence: 4, summary: "Second finding prose." },
        { kind: "checkpoint", sequence: 1, summary: "Early checkpoint prose." },
      ],
    },
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

// XTRM-409: the help text promises the bounded journal view (recent summaries,
// newest per kind, per-kind counts). It regressed to a bare count line.
test("issue show renders the bounded journal view, not only a count line", () => {
  const text = renderIssueShow({
    humanRef: "XTRM-256",
    locator: "XTRM-256",
    title: "Journal view",
    kind: "task",
    lifecycleState: "open",
    revision: 1,
    readinessState: "ready",
    operationalContext: {
      total: 7,
      countsByKind: { checkpoint: 1, finding: 6 },
      // `checkpoint seq1` is deliberately absent from `recent`, so the newest
      // entry per kind can only appear if `latestByKind` is rendered.
      latestByKind: [
        { kind: "finding", sequence: 7, summary: "Newest finding prose." },
        { kind: "checkpoint", sequence: 1, summary: "Newest checkpoint prose." },
      ],
      recent: [
        { kind: "finding", sequence: 6, summary: "Older finding prose." },
        { kind: "finding", sequence: 7, summary: "Newest finding prose." },
      ],
    },
  }, plain);
  // Per-kind counts are rendered.
  assert.match(text, /finding 6/);
  assert.match(text, /checkpoint 1/);
  // The newest entry per kind is rendered, including kinds outside `recent`.
  assert.match(text, /checkpoint seq1/);
  assert.match(text, /Newest checkpoint prose\./);
  // Recent entry summaries are rendered.
  assert.match(text, /Older finding prose\./);
  assert.match(text, /Newest finding prose\./);
});

// XTRM-409: the payload carries summaries double-encoded as `{"summary":"…"}`
// on legacy rows. The human view must unwrap the prose instead of printing JSON.
test("issue show unwraps double-encoded journal summaries into prose", () => {
  const text = renderIssueShow({
    humanRef: "XTRM-257",
    locator: "XTRM-257",
    title: "Journal encoding",
    kind: "task",
    lifecycleState: "open",
    revision: 1,
    readinessState: "ready",
    operationalContext: {
      total: 2,
      countsByKind: { finding: 2 },
      latestByKind: [{ kind: "finding", sequence: 2, summary: '{"summary":"Legacy finding prose."}' }],
      recent: [{ kind: "finding", sequence: 2, summary: '{\n "summary":"Legacy finding prose."\n}' }],
    },
  }, plain);
  assert.match(text, /Legacy finding prose\./);
  assert.equal(text.includes('{"summary"'), false, "double-encoded JSON leaked to the terminal");
});

// XTRM-409: the producer's bounded truncation cuts the envelope mid-string on
// long legacy rows (XTRM-256 seq1/seq2). The prose must still render.
test("issue show unwraps a summary envelope truncated mid-string", () => {
  const truncated = '{"summary":"R4 Core leg complete and independently accepted at core commit 420a032b';
  const text = renderIssueShow({
    humanRef: "XTRM-259",
    locator: "XTRM-259",
    title: "Truncated envelope",
    kind: "task",
    lifecycleState: "open",
    revision: 1,
    readinessState: "ready",
    operationalContext: {
      total: 1,
      countsByKind: { finding: 1 },
      latestByKind: [{ kind: "finding", sequence: 1, summary: truncated }],
      recent: [{ kind: "finding", sequence: 1, summary: truncated }],
    },
  }, plain);
  assert.match(text, /R4 Core leg complete and independently accepted at core commit 420a032b/);
  assert.equal(text.includes('{"summary"'), false, "truncated envelope leaked to the terminal");
});

// XTRM-409: a journal with no entries gets an explicit empty state.
test("issue show renders an explicit empty state for a journal with no entries", () => {
  const text = renderIssueShow({
    humanRef: "XTRM-258",
    locator: "XTRM-258",
    title: "Empty journal",
    kind: "task",
    lifecycleState: "open",
    revision: 1,
    readinessState: "ready",
    operationalContext: { total: 0, countsByKind: {}, latestByKind: [], recent: [] },
  }, plain);
  assert.match(text, /Journal 0 entries/);
  assert.match(text, /no journal entries/i);
});

// XTRM-409: the block must stay bounded by the producer's window. A large
// journal is reported by counts, not by dumping every entry.
test("issue show journal block stays bounded by the recent window", () => {
  const recent = Array.from({ length: 10 }, (_, i) => ({
    kind: "finding",
    sequence: i + 23,
    summary: `Finding ${i + 23} prose.`,
  }));
  const text = renderIssueShow({
    humanRef: "SPECIALISTS-94",
    locator: "SPECIALISTS-94",
    title: "Large journal",
    kind: "task",
    lifecycleState: "open",
    revision: 1,
    readinessState: "ready",
    operationalContext: {
      total: 32,
      countsByKind: { checkpoint: 8, finding: 24 },
      latestByKind: [{ kind: "finding", sequence: 32, summary: "Finding 32 prose." }],
      recent,
    },
  }, plain);
  assert.match(text, /Journal 32 entries/);
  const rendered = text.split("\n").filter((line) => /seq\d+ finding · Finding \d+ prose\./.test(line));
  assert.equal(rendered.length, recent.length, `rendered ${rendered.length} journal lines for a 32-entry journal`);
  assert.ok(rendered.length < 32, "the journal block must not scale with the full journal");
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

test("--json refuses human-only list filters instead of returning unfiltered data", async () => {
  const { runUxCli } = await import("../cli/sb-ux.ts");
  const res = await runUxCli(["--json", "issue", "list", "--status", "ready"]);
  assert.equal(res.code, 1);
  assert.match(res.stderr, /--json cannot apply --status/);
});
