// ADR-009 (XTRM-827): a journal read degrades per row instead of failing the
// whole Issue. One unreadable row renders as an explicit marker naming the
// entry and quoting the validator verbatim; every other row still renders.
// Single-entry reads stay fail-closed; writes, schema and rows are untouched.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { JournalService } from "../src/service/journal-service.ts";
import { ResumeService } from "../src/service/resume-service.ts";
import { runCli } from "../cli/sb.ts";
import { contract, setup } from "./helpers.ts";

const BAD_ID = "jrn_read_degradation_bad";
const BAD_REASON = "result.summary must be a non-empty string";
const MARKER = `unreadable: ${BAD_ID}: ${BAD_REASON}`;

function services(ctx: ReturnType<typeof setup>) {
  const journal = new JournalService(ctx.db, ctx.svc);
  const resume = new ResumeService(ctx.db, ctx.svc, journal);
  return { journal, resume };
}

function workIssue(ctx: ReturnType<typeof setup>, title = "work") {
  return ctx.svc.createIssue({
    projectId: "prj_xtrm",
    title,
    kind: "task",
    contract: contract(),
    scrutiny: "LOW",
    authoredBy: "tester",
  });
}

/** Raw SQL is the measurable trigger (manual edit / interrupted write): the write seam never stores this. */
function insertInvalidResult(ctx: ReturnType<typeof setup>, issueId: string, sequence: number, createdAt: number, id = BAD_ID): string {
  ctx.db
    .prepare(
      `INSERT INTO issue_journal (id, issue_id, issue_revision, sequence, kind, result_json, refs_json, created_at)
       VALUES (?, ?, 1, ?, 'result', ?, '[]', ?)`,
    )
    .run(id, issueId, sequence, JSON.stringify({ summary: "" }), createdAt);
  return id;
}

/** 4 rows for one Issue: 3 valid in sequence order, then 1 invalid result row. */
function fixture(ctx: ReturnType<typeof setup>) {
  const { journal } = services(ctx);
  const issue = workIssue(ctx);
  journal.appendEntry(issue.id, { kind: "note", semantic: { summary: "first" } });
  journal.appendEntry(issue.id, { kind: "note", semantic: { summary: "second" } });
  journal.appendEntry(issue.id, { kind: "note", semantic: { summary: "third" } });
  insertInvalidResult(ctx, issue.id, 4, Date.now() + 4);
  return { journal, issue };
}

const cli = (ctx: ReturnType<typeof setup>, args: string[]) =>
  runCli(["--db", join(ctx.dir, "state.db"), ...args]);

describe("journal read degradation (ADR-009)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("listEntries degrades one bad row and keeps the other rows in sequence order", () => {
    const { journal, issue } = fixture(ctx);
    const entries = journal.listEntries(issue.id);
    assert.equal(entries.length, 4);
    assert.deepEqual(entries.map((e) => e.sequence), [1, 2, 3, 4]);
    assert.deepEqual(entries.slice(0, 3).map((e) => e.semantic?.summary), ["first", "second", "third"]);
    assert.equal(entries[3]?.unreadable, MARKER, "entry id + first validator problem, verbatim");
    assert.equal(entries.degraded, 1);
    // The marker is not summary-shaped: the payloads stay empty.
    assert.equal(entries[3]?.result, null);
    assert.equal(entries[3]?.semantic, null);
    // A clean read reports zero; the count is not part of the array's contents.
    assert.equal(journal.listEntries(issue.id, { kind: "note" }).degraded, 0);
    assert.deepEqual(journal.listEntries(issue.id, { kind: "note" }).map((e) => e.sequence), [1, 2, 3]);
  });

  it("listEntries degrades on the backwards cursor branch too", () => {
    const { journal, issue } = fixture(ctx);
    const entries = journal.listEntries(issue.id, { before: 5, limit: 2 });
    assert.deepEqual(entries.map((e) => e.sequence), [3, 4]);
    assert.equal(entries[1]?.unreadable, MARKER);
    assert.equal(entries.degraded, 1);
  });

  it("timeline (`journal show --tail`) degrades the bad row in its window", () => {
    const { journal, issue } = fixture(ctx);
    const entries = journal.timeline(issue.id, { limit: 2 });
    assert.deepEqual(entries.map((e) => e.sequence), [3, 4]);
    assert.equal(entries[1]?.unreadable, MARKER);
    assert.equal(entries.degraded, 1);
  });

  it("since and latest degrade instead of throwing", () => {
    const { journal, issue } = fixture(ctx);
    const delta = journal.since(issue.id, 0);
    assert.equal(delta.entries.length, 4);
    assert.equal(delta.entries[3]?.unreadable, MARKER);
    assert.equal(delta.degraded, 1);
    assert.equal(journal.latest(issue.id)?.unreadable, MARKER);
  });

  it("latestCheckpoint degrades a corrupt checkpoint row", () => {
    const { journal, issue } = fixture(ctx);
    ctx.db
      .prepare(
        `INSERT INTO issue_journal (id, issue_id, issue_revision, sequence, kind, semantic_json, refs_json, created_at)
         VALUES (?, ?, 1, 5, 'checkpoint', ?, '[]', ?)`,
      )
      .run("jrn_read_degradation_cp", issue.id, JSON.stringify({ summary: "" }), Date.now() + 5);
    assert.equal(
      journal.latestCheckpoint(issue.id)?.unreadable,
      "unreadable: jrn_read_degradation_cp: semantic.summary must be a non-empty string",
    );
  });

  it("getEntry keeps failing closed on the same row", () => {
    const { journal } = fixture(ctx);
    assert.throws(() => journal.getEntry(BAD_ID), /fail-closed: invalid result payload/);
  });

  it("feed: one bad row in Issue A does not remove Issue B's rows from the same page", () => {
    const { journal, issue: a } = fixture(ctx);
    const b = workIssue(ctx, "other");
    journal.appendEntry(b.id, { kind: "note", semantic: { summary: "b-one" } });
    journal.appendEntry(b.id, { kind: "note", semantic: { summary: "b-two" } });

    const page = journal.feed({ projectId: "prj_xtrm", limit: 50 });
    assert.equal(page.degraded, 1);
    const aEntries = page.entries.filter((e) => e.issueId === a.id);
    const bEntries = page.entries.filter((e) => e.issueId === b.id);
    assert.equal(aEntries.length, 4);
    assert.equal(bEntries.length, 2);
    // Feed pages are newest-first; both Issue B rows survive the bad row in A.
    assert.deepEqual(bEntries.map((e) => e.entry.semantic?.summary).sort(), ["b-one", "b-two"]);
    assert.equal(aEntries.find((e) => e.entry.id === BAD_ID)?.entry.unreadable, MARKER);
  });

  it("resume capsule renders the marker and the degraded count in its journal delta", () => {
    const { journal, issue } = fixture(ctx);
    const resume = new ResumeService(ctx.db, ctx.svc, journal);
    const capsule = resume.buildCapsule(issue.id);
    assert.equal(capsule.delta.degraded, 1);
    assert.equal(capsule.delta.entries.find((e) => e.id === BAD_ID)?.unreadable, MARKER);
    const text = resume.renderCapsule(capsule);
    assert.ok(text.includes(MARKER), "the capsule names the unreadable entry and the validator reason");
    assert.ok(text.includes("degraded: 1 unreadable journal entry"), "the capsule reports the degraded count");
  });
});

describe("sb journal reads render the marker (ADR-009)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("`journal show` prints one marker line plus the other rows", () => {
    const { issue } = fixture(ctx);
    const res = cli(ctx, ["journal", "show", issue.humanRef]);
    assert.equal(res.code, 0, res.stderr || res.stdout);
    assert.ok(res.stdout.includes(MARKER));
    assert.ok(res.stdout.includes("summary: first"));
    assert.ok(res.stdout.includes("summary: third"));
    assert.ok(res.stdout.includes("degraded: 1 unreadable journal entry"));
    assert.equal(res.stdout.split(MARKER).length - 1, 1, "the marker is printed once");
  });

  it("`journal show --tail` degrades via timeline instead of throwing", () => {
    const { issue } = fixture(ctx);
    const res = cli(ctx, ["journal", "show", issue.humanRef, "--tail", "2"]);
    assert.equal(res.code, 0, res.stderr || res.stdout);
    assert.ok(res.stdout.includes(MARKER));
    assert.ok(res.stdout.includes("summary: third"));
    assert.ok(!res.stdout.includes("summary: first"), "--tail is the newest window");
    assert.ok(res.stdout.includes("degraded: 1 unreadable journal entry"));
  });

  it("`journal show --json` carries unreadable on the marker entry", () => {
    const { issue } = fixture(ctx);
    const res = cli(ctx, ["--json", "journal", "show", issue.humanRef]);
    assert.equal(res.code, 0, res.stderr || res.stdout);
    const data = (JSON.parse(res.stdout) as { data: Array<{ id: string; unreadable: string | null }> }).data;
    assert.equal(data.length, 4);
    assert.equal(data.find((e) => e.id === BAD_ID)?.unreadable, MARKER);
    assert.equal(data.filter((e) => e.unreadable !== null).length, 1);
  });

  it("`journal feed` keeps the other Issue's rows and reports the degraded count", () => {
    const { journal } = fixture(ctx);
    const b = workIssue(ctx, "other");
    journal.appendEntry(b.id, { kind: "note", semantic: { summary: "b-one" } });
    const res = cli(ctx, ["journal", "feed", "--project", "prj_xtrm", "--limit", "50"]);
    assert.equal(res.code, 0, res.stderr || res.stdout);
    assert.ok(res.stdout.includes(MARKER));
    assert.ok(res.stdout.includes("b-one"), "the other Issue still renders");
    assert.ok(res.stdout.includes("degraded: 1 unreadable journal entry"));

    const json = cli(ctx, ["--json", "journal", "feed", "--project", "prj_xtrm", "--limit", "50"]);
    const data = JSON.parse(json.stdout) as { data: { degraded: number; entries: Array<{ issueId: string; unreadable: string | null }> } };
    assert.equal(data.data.degraded, 1);
    assert.ok(data.data.entries.some((e) => e.issueId === b.id));
    assert.equal(data.data.entries.find((e) => e.unreadable !== null)?.unreadable, MARKER);
  });

  it("`journal since` carries the marker and the count", () => {
    const { issue } = fixture(ctx);
    const res = cli(ctx, ["--json", "journal", "since", issue.humanRef, "0"]);
    assert.equal(res.code, 0, res.stderr || res.stdout);
    const data = JSON.parse(res.stdout) as { data: { degraded: number; entries: Array<{ id: string; unreadable: string | null }> } };
    assert.equal(data.data.degraded, 1);
    assert.equal(data.data.entries.find((e) => e.id === BAD_ID)?.unreadable, MARKER);
  });

  it("`issue resume` renders the marker and the degraded count", () => {
    const { issue } = fixture(ctx);
    const res = cli(ctx, ["issue", "resume", issue.humanRef]);
    assert.equal(res.code, 0, res.stderr || res.stdout);
    assert.ok(res.stdout.includes(MARKER));
    assert.ok(res.stdout.includes("degraded: 1 unreadable journal entry"));
  });
});
