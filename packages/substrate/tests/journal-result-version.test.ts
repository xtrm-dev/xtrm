// XTRM-339: version envelope for the journal result payload.
// `resultVersion: 1` lives inside the existing JSON payload (no migration).
// Missing version defaults to 1 on read; unknown versions fail closed naming
// the version; the write path stays append-only (no UPDATE of result_json).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KNOWN_RESULT_VERSIONS,
  RESULT_ARRAY_FIELDS,
  RESULT_STRING_FIELDS,
  RESULT_VERSION,
  validateResultPayload,
} from "../src/domain/journal.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { contract, setup } from "./helpers.ts";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..", "..", "..");

function services(ctx: ReturnType<typeof setup>) {
  return { journal: new JournalService(ctx.db, ctx.svc) };
}

function workIssue(ctx: ReturnType<typeof setup>) {
  return ctx.svc.createIssue({
    projectId: "prj_xtrm",
    title: "versioned result",
    kind: "task",
    contract: contract(),
    scrutiny: "LOW",
    authoredBy: "tester",
  });
}

describe("result payload version envelope (XTRM-339)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("a known version round-trips through append and read", () => {
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    // Envelope omitted at the call site: the write path stamps version 1.
    const entry = journal.appendEntry(issue.id, {
      kind: "result",
      result: { summary: "load test green", outcome: "pass" },
    });
    assert.equal(entry.result?.resultVersion, 1);
    assert.equal(entry.result?.summary, "load test green");
    assert.equal(entry.result?.outcome, "pass");
    const stored = ctx.db
      .prepare("SELECT result_json AS resultJson FROM issue_journal WHERE id = ?")
      .get(entry.id) as { resultJson: string };
    assert.equal(JSON.parse(stored.resultJson).resultVersion, 1, "the writer must persist the version envelope");
    const reread = journal.getEntry(entry.id);
    assert.equal(reread.result?.resultVersion, 1);
    assert.equal(reread.result?.summary, "load test green");
    // An explicit version 1 is accepted as well.
    const explicit = journal.appendEntry(issue.id, {
      kind: "result",
      result: { summary: "explicit", resultVersion: 1 },
    });
    assert.equal(explicit.result?.resultVersion, 1);
  });

  it("a pre-change row without a version reads back defaulted to 1, payload intact", () => {
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    // Simulate a row written before XTRM-339: raw INSERT, no envelope.
    const id = "jrn_legacy_no_version";
    ctx.db
      .prepare(
        "INSERT INTO issue_journal (id, issue_id, issue_revision, sequence, kind, result_json, refs_json, created_at) VALUES (?, ?, 1, 1, 'result', ?, '[]', ?)",
      )
      .run(id, issue.id, JSON.stringify({ summary: "legacy outcome", outcome: "PASS" }), Date.now());
    const entry = journal.getEntry(id);
    assert.equal(entry.result?.resultVersion, 1);
    assert.equal(entry.result?.summary, "legacy outcome");
    assert.equal(entry.result?.outcome, "PASS");
    assert.equal(journal.listEntries(issue.id).length, 1);
    assert.equal(journal.since(issue.id, 0).entries[0]?.result?.resultVersion, 1);
  });

  it("an unknown version fails closed with a message naming the version", () => {
    // Validator names the version.
    assert.match(validateResultPayload({ summary: "ok", resultVersion: 2 })[0] ?? "", /resultVersion 2/);
    assert.match(validateResultPayload({ summary: "ok", resultVersion: "x" })[0] ?? "", /resultVersion/);
    // Missing version is legacy, not unknown: still valid.
    assert.deepEqual(validateResultPayload({ summary: "ok" }), []);
    assert.deepEqual(validateResultPayload({ summary: "ok", resultVersion: 1 }), []);
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    // Write path refuses the unknown version.
    assert.throws(
      () => journal.appendEntry(issue.id, { kind: "result", result: { summary: "ok", resultVersion: 2 } }),
      /resultVersion 2/,
    );
    // Read path refuses a stored unknown-version row.
    ctx.db
      .prepare(
        "INSERT INTO issue_journal (id, issue_id, issue_revision, sequence, kind, result_json, refs_json, created_at) VALUES (?, ?, 1, 1, 'result', ?, '[]', ?)",
      )
      .run("jrn_future_version", issue.id, JSON.stringify({ summary: "future", resultVersion: 2 }), Date.now());
    assert.throws(() => journal.getEntry("jrn_future_version"), /resultVersion 2/);
  });

  it("pre-change readers reject every versioned row, including v1 (rollout order)", () => {
    // The pre-XTRM-339 validator: closed RESULT_FIELDS loop with no
    // `resultVersion` exception. Executed here (not quoted) against a v1
    // payload to pin the compatibility truth: an old binary cannot
    // distinguish known from unknown versions — it rejects both.
    const oldValidate = (value: unknown): string[] => {
      const r = value as Record<string, unknown>;
      const problems: string[] = [];
      const fields = [...RESULT_STRING_FIELDS, ...RESULT_ARRAY_FIELDS];
      for (const key of Object.keys(r)) {
        if (!(fields as readonly string[]).includes(key)) {
          problems.push(`result.${key} is not a bounded result field (want ${fields.join("|")})`);
        }
      }
      return problems;
    };
    const v1 = { summary: "versioned", resultVersion: 1 };
    const v2 = { summary: "future", resultVersion: 2 };
    assert.match(oldValidate(v1)[0] ?? "", /result\.resultVersion is not a bounded result field/);
    assert.match(oldValidate(v2)[0] ?? "", /result\.resultVersion is not a bounded result field/);
    // Discrimination: the new validator accepts v1 and legacy, rejects v2.
    assert.deepEqual(validateResultPayload(v1), []);
    assert.deepEqual(validateResultPayload({ summary: "legacy" }), []);
    assert.match(validateResultPayload(v2)[0] ?? "", /resultVersion 2/);
  });

  it("the write path stays append-only: no UPDATE touches a stored result", () => {
    const src = readFileSync(join(here, "..", "src", "service", "journal-service.ts"), "utf8");
    const updates = [...src.matchAll(/UPDATE\s+issue_journal\s+SET\s+(\w+)/gi)].map((m) => m[1]);
    assert.ok(updates.length > 0, "the UPDATE scan must not be vacuous");
    assert.ok(!updates.includes("result_json"), `no UPDATE may touch result_json (found: ${updates.join(",")})`);
    // Functional half: reads never rewrite the stored bytes.
    const { journal } = services(ctx);
    const issue = workIssue(ctx);
    const entry = journal.appendEntry(issue.id, { kind: "result", result: { summary: "stable" } });
    const before = (ctx.db.prepare("SELECT result_json AS j FROM issue_journal WHERE id = ?").get(entry.id) as { j: string }).j;
    journal.getEntry(entry.id);
    journal.listEntries(issue.id);
    const after = (ctx.db.prepare("SELECT result_json AS j FROM issue_journal WHERE id = ?").get(entry.id) as { j: string }).j;
    assert.equal(after, before);
  });

  it("docs and the drift gate agree with the implemented shape", () => {
    assert.equal(RESULT_VERSION, 1);
    assert.ok((KNOWN_RESULT_VERSIONS as readonly number[]).includes(1));
    const doc = readFileSync(join(ROOT, "docs", "substrate", "journal.md"), "utf8");
    assert.match(doc, /resultVersion: 1/, "journal.md records the version envelope");
    assert.match(doc, /result\.outcome[\s\S]*free\s+string/, "journal.md states outcome stays free");
  });
});
