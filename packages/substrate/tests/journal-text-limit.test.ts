// XTRM-678: journal summary text is never cut silently. One write limit
// (JOURNAL_SUMMARY_MAX) applies to every append path; within it the text
// round-trips byte-for-byte, above it the write fails and nothing is stored.
// Long text can come from a file; display previews mark every cut.
//
// Scope: the domain helpers and the CLI path. The MCP and Pi halves of this
// gate belong to the shared tool surface and land with it (XTRM-724 part B).

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { runCli } from "../cli/sb.ts";
import { clipWithMarker, previewText, JOURNAL_SUMMARY_MAX } from "../src/domain/journal.ts";
import { contract } from "./helpers.ts";

const ENV_KEYS = ["SUBSTRATE_DB", "SUBSTRATE_PROJECT", "SUBSTRATE_ISSUE_REF", "SUBSTRATE_ISSUE", "SUBSTRATE_HOLDER", "SUBSTRATE_ACTIVATION_ID", "XTRM_SESSION_ID", "XTRM_SESSION_NAME"];

// Words plus a unique tail, so a cut anywhere loses "END".
const text = (n: number) => `${"handoff word ".repeat(Math.ceil(n / 13)).slice(0, n - 3)}END`;

describe("XTRM-678 journal text limit", () => {
  let dir = "";
  let dbPath = "";
  let ref = "";
  let issueId = "";
  let prior: Record<string, string | undefined> = {};

  beforeEach(() => {
    prior = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    dir = mkdtempSync(join(tmpdir(), "substrate-limit-"));
    dbPath = join(dir, "state.db");
    const db = openSubstrate(dbPath);
    try {
      const svc = new IssueService(db);
      svc.createProject({ id: "prj_lim", prefix: "LIM", name: "limit" });
      const issue = svc.createIssue({ projectId: "prj_lim", title: "limit work", kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "t" });
      ref = issue.humanRef;
      issueId = issue.id;
    } finally {
      db.close();
    }
    process.env["SUBSTRATE_DB"] = dbPath;
    process.env["SUBSTRATE_PROJECT"] = "prj_lim";
    process.env["SUBSTRATE_HOLDER"] = "limit-probe";
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (prior[k] === undefined) delete process.env[k];
      else process.env[k] = prior[k];
    }
    rmSync(dir, { recursive: true, force: true });
  });

  function stored(): string[] {
    const db = openSubstrate(dbPath);
    try {
      const svc = new IssueService(db);
      return new JournalService(db, svc).listEntries(issueId).map((e) => e.semantic?.summary ?? "");
    } finally {
      db.close();
    }
  }

  const cli = (argv: string[]) => runCli(["--db", dbPath, ...argv]);
  const cliAppend = (summary: string) => cli(["journal", "append", ref, "--kind", "handoff", "--semantic", JSON.stringify({ summary })]);

  it("domain helpers mark every cut", () => {
    assert.equal(previewText("short", 10), "short");
    assert.equal(previewText("x".repeat(15), 10), `${"x".repeat(10)}… (+5 chars, use --json)`);
    const clipped = clipWithMarker("y".repeat(200), 100, "compact_summary");
    assert.equal(clipped.length, 100);
    assert.match(clipped, /\[cut: \d+ more chars of compact_summary not stored\]$/);
    assert.equal(clipWithMarker("fits", 100), "fits");
  });

  it("CLI stores limit-1 and limit chars byte-for-byte and refuses limit+1", () => {
    for (const n of [JOURNAL_SUMMARY_MAX - 1, JOURNAL_SUMMARY_MAX]) {
      const r = cliAppend(text(n));
      assert.equal(r.code, 0, r.stderr);
    }
    assert.deepEqual(stored(), [text(JOURNAL_SUMMARY_MAX - 1), text(JOURNAL_SUMMARY_MAX)]);
    const over = cliAppend(text(JOURNAL_SUMMARY_MAX + 1));
    assert.notEqual(over.code, 0);
    assert.match(over.stderr, new RegExp(`${JOURNAL_SUMMARY_MAX + 1} characters .*the limit is ${JOURNAL_SUMMARY_MAX}`));
    assert.equal(stored().length, 2, "no row written");
  });

  it("CLI --summary-file stores the file text in full and keeps other --semantic fields", () => {
    const file = join(dir, "handoff.md");
    writeFileSync(file, text(9000));
    const r = cli(["journal", "append", ref, "--kind", "handoff", "--semantic", '{"summary":"x","next":["review"]}', "--summary-file", file]);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(stored(), [text(9000)]);
    const missing = cli(["journal", "append", ref, "--kind", "handoff", "--summary-file", join(dir, "nope.md")]);
    assert.match(missing.stderr, /--summary-file not found/);
  });

  it("text views mark a cut preview; --json keeps the full text", () => {
    assert.equal(cliAppend(text(3000)).code, 0);
    const show = cli(["issue", "show", ref]);
    assert.match(show.stdout, /\(\+\d+ chars, full text: sb journal show --json\)/);
    const json = JSON.parse(cli(["--json", "journal", "latest", ref]).stdout) as { data: { semantic: { summary: string } } };
    assert.equal(json.data.semantic.summary, text(3000));
    assert.equal(cliAppend("short handoff with enough words to pass the quality bar").code, 0);
    assert.match(cli(["issue", "show", ref]).stdout, /short handoff with enough words to pass the quality bar\n/);
  });
});
