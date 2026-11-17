// XTRM-420: the render must not assert a payload the row does not hold.
// An entry with neither mechanical state nor a summary rendered as
// "(mechanical-only; summarizer pending or degraded)", which claims evidence
// the stored row lacks and hides an evidence-less record from an operator.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { JournalService } from "../src/service/journal-service.ts";
import { runCli } from "../cli/sb.ts";
import { contract, setup } from "./helpers.ts";

describe("journal render labels (XTRM-420)", () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    ctx = setup();
  });

  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  const issue = () =>
    ctx.svc.createIssue({
      projectId: "prj_xtrm",
      title: "render labels",
      kind: "task",
      contract: contract(),
      scrutiny: "LOW",
      authoredBy: "tester",
    });

  /**
   * A row with no payloads cannot be produced by the current service (it fails
   * closed), but historical builds stored exactly this. The render must describe
   * such a legacy row truthfully, so the fixture is a valid row whose payload
   * columns are cleared the way the older writer left them.
   */
  function legacyEmptyResult(journal: JournalService) {
    const created = journal.appendEntry(issue().id, {
      kind: "result",
      sessionId: "01a0ac95-8370-74c5-9081-4490653e7109",
      result: { summary: "will be cleared to model a legacy row" },
    });
    ctx.db.exec(
      `UPDATE issue_journal SET mechanical_json = NULL, semantic_json = NULL, result_json = NULL WHERE id = '${created.id}'`,
    );
    const entry = journal.getEntry(created.id);
    assert.equal(entry.mechanical ?? null, null, "no mechanical payload on this row");
    assert.equal(entry.semantic ?? null, null, "no semantic payload on this row");
    assert.equal(entry.result ?? null, null, "no result payload on this row");
    return entry;
  }

  it("does not claim a mechanical payload when the entry has none", () => {
    const journal = new JournalService(ctx.db, ctx.svc);
    const rendered = journal.renderCheckpoint(legacyEmptyResult(journal));
    assert.doesNotMatch(rendered, /mechanical-only/, "a mechanical-only label would be a false claim");
    assert.match(rendered, /no summary and no mechanical state/);
  });

  it("keeps the mechanical-only label when a mechanical payload exists", async () => {
    const journal = new JournalService(ctx.db, ctx.svc);
    const result = await journal.checkpoint(issue().id, {
      participantId: "pi-session-1",
      summarizer: () => {
        throw new Error("summarizer unavailable");
      },
    });
    assert.equal(result.degraded, true);
    assert.ok(result.entry.mechanical, "mechanical payload present");
    assert.equal(result.entry.semantic ?? null, null);

    const rendered = journal.renderCheckpoint(result.entry);
    assert.match(rendered, /mechanical-only/, "the label is true when the mechanical payload exists");
  });

  it("renders the bounded result payload instead of denying it", () => {
    const journal = new JournalService(ctx.db, ctx.svc);
    const entry = journal.appendEntry(issue().id, {
      kind: "result",
      sessionId: "01a0ac95-8370-74c5-9081-4490653e7109",
      result: { summary: "bridge verified", outcome: "completed" },
    });
    assert.equal(entry.semantic ?? null, null, "result appends carry no semantic summary");
    const rendered = journal.renderCheckpoint(entry);
    assert.match(rendered, /RESULT: bridge verified \(completed\)/);
    assert.doesNotMatch(rendered, /mechanical-only/);
  });

  it("labels the `journal show` line from stored evidence, not from a missing summary", () => {
    const journal = new JournalService(ctx.db, ctx.svc);
    const target = issue();
    const dbPath = join(ctx.dir, "state.db");
    const show = () => {
      const res = runCli(["--db", dbPath, "journal", "show", target.humanRef]);
      assert.equal(res.code, 0, res.stderr);
      return res.stdout;
    };

    journal.appendEntry(target.id, {
      kind: "result",
      sessionId: "01a0ac95-8370-74c5-9081-4490653e7109",
      result: { summary: "line demo", outcome: "completed" },
    });
    assert.match(show(), /\(result completed\)/, "a result row names its outcome");

    ctx.db.exec(`UPDATE issue_journal SET result_json = NULL, semantic_json = NULL, mechanical_json = NULL WHERE issue_id = '${target.id}'`);
    const legacy = show();
    assert.match(legacy, /\(no payload\)/, "an evidence-less row says so");
    assert.doesNotMatch(legacy, /mechanical-only/, "and never claims a mechanical payload it lacks");
    assert.doesNotMatch(legacy, /result:/, "and never renders a result body it does not hold");
  });

  it("renders a result entry's summary and outcome in human show (XTRM-832)", () => {
    // The header line only says "(result completed)"; the summary and its lists
    // are the evidence, and `--json` was the only surface that showed them.
    const journal = new JournalService(ctx.db, ctx.svc);
    const target = issue();
    journal.appendEntry(target.id, {
      kind: "result",
      sessionId: "01a0ac95-8370-74c5-9081-4490653e7109",
      result: {
        summary: "bridge verified",
        outcome: "completed",
        completed: ["merged PR #414"],
        findings: ["cache never evicts"],
      },
    });
    // A result that carries neither list must not print an empty label.
    journal.appendEntry(target.id, {
      kind: "result",
      sessionId: "01a0ac95-8370-74c5-9081-4490653e7109",
      result: { summary: "no lists here" },
    });
    const show = runCli(["--db", join(ctx.dir, "state.db"), "journal", "show", target.humanRef]);
    assert.equal(show.code, 0, show.stderr);
    assert.match(show.stdout, /result: bridge verified \(completed\)/);
    assert.match(show.stdout, /completed: merged PR #414/);
    assert.match(show.stdout, /findings: cache never evicts/);
    assert.match(show.stdout, /result: no lists here/);
    assert.equal((show.stdout.match(/completed: /g) ?? []).length, 1, "only the entry that holds the list renders it");
    assert.equal((show.stdout.match(/findings: /g) ?? []).length, 1, "only the entry that holds the list renders it");
  });

  it("rejects the wrong flag for a result, naming the right one", () => {
    const target = issue();
    const res = runCli([
      "--db", join(ctx.dir, "state.db"), "journal", "append", target.humanRef,
      "--kind", "result", "--semantic", '{"summary":"not a result payload"}', "--project", "prj_xtrm",
    ]);
    assert.notEqual(res.code, 0, "a result append without --result must fail closed");
    const text = `${res.stdout}${res.stderr}`;
    assert.match(text, /requires a bounded result payload/);
    assert.match(text, /--result/, "the error names the correct flag");
  });

  it("cannot be handed an empty result summary: the read path refuses first", () => {
    const journal = new JournalService(ctx.db, ctx.svc);
    const created = journal.appendEntry(issue().id, {
      kind: "result",
      sessionId: "01a0ac95-8370-74c5-9081-4490653e7109",
      result: { summary: "placeholder", outcome: "completed" },
    });
    ctx.db.exec(`UPDATE issue_journal SET result_json = '{"summary":"","outcome":"completed"}' WHERE id = '${created.id}'`);
    // Fail-closed on read: a stored result with no summary never reaches a renderer.
    assert.throws(() => journal.getEntry(created.id), /result\.summary must be a non-empty string/);
  });

  it("still renders a missing summary as missing if a renderer is handed one directly", () => {
    const journal = new JournalService(ctx.db, ctx.svc);
    const entry = journal.appendEntry(issue().id, {
      kind: "result",
      sessionId: "01a0ac95-8370-74c5-9081-4490653e7109",
      result: { summary: "placeholder", outcome: "completed" },
    });
    const legacy = { ...entry, result: { ...entry.result!, summary: "   " } };
    const rendered = journal.renderCheckpoint(legacy);
    assert.match(rendered, /RESULT: \(no summary recorded\) \(completed\)/);
    assert.doesNotMatch(rendered, /RESULT:\s*$/m, "never a bare RESULT: that looks like failed rendering");
  });
});
