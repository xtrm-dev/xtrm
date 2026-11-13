// XTRM-764: `sb journal feed --project` — one page of every journal entry of a
// project, newest first, with an opaque cursor that never skips or repeats an
// entry when rows are appended between pages.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { setup, contract } from "./helpers.ts";
import { JournalService, decodeFeedCursor } from "../src/service/journal-service.ts";
import { runCli } from "../cli/sb.ts";

// created_at is Date.now() inside the service; a controlled clock makes the
// ordering assertions exact instead of raced.
let clock = 1_700_000_000_000;
const realNow = Date.now;
function freezeClock(start = clock): void {
  clock = start;
  Date.now = () => clock++;
}

function issue(ctx: ReturnType<typeof setup>, title: string): string {
  return ctx.svc.createIssue({ projectId: "prj_xtrm", title, kind: "task", contract: contract(), scrutiny: "LOW" }).id;
}

describe("journal feed (XTRM-764)", () => {
  let ctx: ReturnType<typeof setup>;
  let journal: JournalService;

  beforeEach(() => {
    ctx = setup();
    journal = new JournalService(ctx.db, ctx.svc);
    freezeClock();
  });

  afterEach(() => {
    Date.now = realNow;
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("returns entries of several issues newest first, each with its issue ref", () => {
    const a = issue(ctx, "a");
    const b = issue(ctx, "b");
    journal.appendEntry(a, { kind: "note", semantic: { summary: "first" } });
    journal.appendEntry(b, { kind: "finding", semantic: { summary: "second" } });
    journal.appendEntry(a, { kind: "note", semantic: { summary: "third" } });
    const page = journal.feed({ projectId: "prj_xtrm", limit: 10 });
    assert.deepEqual(page.entries.map((e) => e.entry.semantic?.summary), ["third", "second", "first"]);
    assert.deepEqual(new Set(page.entries.map((e) => e.issueRef)), new Set(["XTRM-1", "XTRM-2"]));
    assert.equal(page.nextCursor, null, "a short page has no continuation");
  });

  it("pages downwards without a gap or a repeat, and terminates", () => {
    const a = issue(ctx, "a");
    for (let i = 0; i < 5; i++) journal.appendEntry(a, { kind: "note", semantic: { summary: `e${i}` } });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = journal.feed({ projectId: "prj_xtrm", limit: 2, ...(cursor === null ? {} : { cursor: decodeFeedCursor(cursor), direction: "before" as const }) });
      seen.push(...page.entries.map((e) => e.entry.semantic!.summary!));
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== null && pages < 10);
    assert.deepEqual(seen, ["e4", "e3", "e2", "e1", "e0"], "every entry exactly once, newest first");
    assert.equal(pages, 3);
  });

  it("keeps the cursor stable when entries are appended between pages", () => {
    const a = issue(ctx, "a");
    for (let i = 0; i < 4; i++) journal.appendEntry(a, { kind: "note", semantic: { summary: `old${i}` } });
    const first = journal.feed({ projectId: "prj_xtrm", limit: 2 });
    assert.deepEqual(first.entries.map((e) => e.entry.semantic!.summary), ["old3", "old2"]);
    // An append after the first page is newer than the cursor: it cannot push a
    // row across the page boundary, so the next page is exactly the older pair.
    journal.appendEntry(a, { kind: "note", semantic: { summary: "new" } });
    const second = journal.feed({ projectId: "prj_xtrm", limit: 2, cursor: decodeFeedCursor(first.nextCursor!), direction: "before" });
    assert.deepEqual(second.entries.map((e) => e.entry.semantic!.summary), ["old1", "old0"]);
    // A full page still hands back a cursor; the next page is the proof of the end.
    const third = journal.feed({ projectId: "prj_xtrm", limit: 2, cursor: decodeFeedCursor(second.nextCursor!), direction: "before" });
    assert.deepEqual(third.entries, [], "no entry is repeated or skipped across the boundary");
    assert.equal(third.nextCursor, null);
    const refreshed = journal.feed({ projectId: "prj_xtrm", limit: 1 });
    assert.deepEqual(refreshed.entries.map((e) => e.entry.semantic!.summary), ["new"], "the new entry is on top");
  });

  it("filters by kind and refuses an unknown kind", () => {
    const a = issue(ctx, "a");
    journal.appendEntry(a, { kind: "note", semantic: { summary: "n" } });
    journal.appendEntry(a, { kind: "finding", semantic: { summary: "f" } });
    journal.appendEntry(a, { kind: "decision", semantic: { summary: "d" } });
    const page = journal.feed({ projectId: "prj_xtrm", limit: 10, kinds: ["finding", "decision"] });
    assert.deepEqual(page.entries.map((e) => e.entry.kind), ["decision", "finding"]);
    assert.throws(() => journal.feed({ projectId: "prj_xtrm", limit: 5, kinds: ["nope" as never] }), /unknown journal kind/);
  });

  it("returns an empty page for a project with no entries", () => {
    ctx.svc.createProject({ id: "prj_empty", prefix: "EMPTY", name: "e" });
    const page = journal.feed({ projectId: "prj_empty", limit: 10 });
    assert.deepEqual(page.entries, []);
    assert.equal(page.nextCursor, null);
  });

  it("polls newer entries with a cursor without skipping a burst larger than one page", () => {
    const a = issue(ctx, "a");
    journal.appendEntry(a, { kind: "note", semantic: { summary: "base" } });
    const base = journal.feed({ projectId: "prj_xtrm", limit: 1 });
    for (let i = 0; i < 3; i++) journal.appendEntry(a, { kind: "note", semantic: { summary: `n${i}` } });
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = journal.feed({ projectId: "prj_xtrm", limit: 1, cursor: decodeFeedCursor(cursor ?? base.nextCursor ?? encodeOf(base)), direction: "newer" });
      seen.push(...page.entries.map((e) => e.entry.semantic!.summary!));
      cursor = page.nextCursor;
      pages++;
    } while (cursor !== null && pages < 10);
    assert.deepEqual(seen, ["n0", "n1", "n2"], "every new entry once, walking forward from the cursor");
  });

  it("accepts a time bound and refuses a malformed cursor", () => {
    const a = issue(ctx, "a");
    journal.appendEntry(a, { kind: "note", semantic: { summary: "early" } });
    const boundary = clock;
    journal.appendEntry(a, { kind: "note", semantic: { summary: "late" } });
    assert.deepEqual(journal.feed({ projectId: "prj_xtrm", limit: 10, sinceTime: boundary }).entries.map((e) => e.entry.semantic!.summary), ["late"]);
    assert.throws(() => journal.feed({ projectId: "prj_xtrm", limit: 5, cursor: decodeFeedCursor("not-a-cursor"), direction: "before" }), /invalid cursor/);
  });

  it("answers through the CLI in JSON and in the human view", () => {
    const a = issue(ctx, "a");
    journal.appendEntry(a, { kind: "note", semantic: { summary: "hello feed" } });
    const dbPath = join(ctx.dir, "state.db");
    const json = runCli(["--db", dbPath, "--json", "journal", "feed", "--project", "prj_xtrm", "--limit", "5"]);
    assert.equal(json.code, 0, json.stderr);
    const payload = (JSON.parse(json.stdout) as { data: { entries: Array<{ issueRef: string; semantic: { summary: string } }>; nextCursor: string | null } }).data;
    assert.equal(payload.entries[0]!.issueRef, "XTRM-1");
    assert.equal(payload.entries[0]!.semantic.summary, "hello feed");
    assert.equal(payload.nextCursor, null);
    const human = runCli(["--db", dbPath, "journal", "feed", "--project", "prj_xtrm"]);
    assert.equal(human.code, 0, human.stderr);
    assert.match(human.stdout, /XTRM-1/);
    assert.match(human.stdout, /hello feed/);
    const bad = runCli(["--db", dbPath, "journal", "feed", "--project", "prj_xtrm", "--since", "2026-01-01T00:00:00Z", "--before", "abc"]);
    assert.notEqual(bad.code, 0);
    assert.match(bad.stderr, /cannot be combined/);
  });

  // XTRM-764 review: the perf assertion passes without the index, so it proves
  // the query is fast, not that migration 017 exists. Assert the index and the
  // plan that uses it separately, or a lost migration would go unnoticed.
  // XTRM-764 review: the timing assertion alone proves the query is fast, not
  // that it is project-scoped. Pin the access path: the join must probe
  // ix_journal_issue_seq per issue, never scan the whole journal table.
  // (A dedicated (created_at, id) index was measured and dropped: the planner
  // drives from issues(project_id) and never chose it.)
  it("serves the page by probing the issue index, not by scanning the journal", () => {
    const plan = ctx.db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT j.id FROM issue_journal j JOIN issues i ON i.id = j.issue_id WHERE i.project_id = ? ORDER BY j.created_at DESC, j.id DESC LIMIT 50",
      )
      .all("prj_xtrm")
      .map((r) => String((r as { detail?: unknown }).detail ?? ""));
    assert.ok(
      plan.some((d) => d.includes("ix_journal_issue_seq")),
      `the join must probe the per-issue index, plan was:\n${plan.join("\n")}`,
    );
    assert.ok(
      !plan.some((d) => /^SCAN (j|issue_journal)\b/.test(d)),
      `no full journal scan is allowed, plan was:\n${plan.join("\n")}`,
    );
  });

  it("refuses a time bound on a cursor poll instead of silently ignoring it", () => {
    assert.throws(
      () => journal.feed({ projectId: "prj_xtrm", limit: 5, cursor: { time: 1, id: "x" }, direction: "newer", sinceTime: 1_700_000_000_000 }),
      /cannot also carry a time bound/,
    );
  });

  it("returns a 50-entry page from a 10k-entry board well under a second", () => {
    const ids = [issue(ctx, "a"), issue(ctx, "b"), issue(ctx, "c")];
    const insert = ctx.db.prepare(
      `INSERT INTO issue_journal (id, issue_id, issue_revision, sequence, kind, semantic_json, refs_json, created_at)
       VALUES (?, ?, 1, ?, 'note', ?, '[]', ?)`,
    );
    ctx.db.exec("BEGIN");
    for (let i = 0; i < 10_000; i++) {
      const id = ids[i % ids.length]!;
      const seq = Math.floor(i / ids.length) + 1;
      insert.run(`jrn_seed_${String(i).padStart(5, "0")}`, id, seq, JSON.stringify({ summary: `seed ${i}` }), 1_700_000_000_000 + i);
    }
    ctx.db.exec("COMMIT");
    const started = process.hrtime.bigint();
    const page = journal.feed({ projectId: "prj_xtrm", limit: 50 });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    assert.equal(page.entries.length, 50);
    assert.ok(page.nextCursor !== null);
    assert.ok(elapsedMs < 1000, `a 50-entry page took ${elapsedMs.toFixed(0)}ms on a 10k board`);
  });
});

// The base page's cursor is the newest entry it returned; a poll starts there.
function encodeOf(page: { entries: Array<{ entry: { createdAt: number; id: string } }> }): string {
  const top = page.entries[0]!;
  return Buffer.from(JSON.stringify({ t: top.entry.createdAt, id: top.entry.id }), "utf8").toString("base64url");
}
