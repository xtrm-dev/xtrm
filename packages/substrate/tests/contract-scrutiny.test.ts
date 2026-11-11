import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";
import { runUxCli } from "../cli/sb-ux.ts";
import { feedbackForCommand, feedbackForError, renderFeedback } from "../src/presentation/terminal.ts";
import { contract, tempDir } from "./helpers.ts";

const plain = { color: false, width: 88 };

function setupDb(): { dir: string; dbPath: string } {
  const dir = tempDir("sb-contract-scrutiny-");
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  new IssueService(db).createProject({ id: "prj_demo", prefix: "DEMO", name: "scrutiny" });
  db.close();
  return { dir, dbPath };
}

function contractFile(dir: string, name: string, extra: Record<string, unknown> = {}): string {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify({ ...contract(), ...extra }));
  return p;
}

function jsonCall(dbPath: string, argv: string[]): { code: number; ok: boolean; data: unknown; error?: string } {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  const env = JSON.parse(res.stdout) as { schema: string; command: string; ok: boolean; data: unknown; error?: string };
  assert.equal(env.schema, SCHEMA_VERSION);
  return { code: res.code, ok: env.ok, data: env.data, error: env.error };
}

function issueCount(dbPath: string): number {
  const db = openSubstrate(dbPath);
  try {
    return new IssueService(db).listIssues("prj_demo").length;
  } finally {
    db.close();
  }
}

function columnScrutiny(dbPath: string, id: string): string {
  const db = openSubstrate(dbPath);
  try {
    return new IssueService(db).getIssue(id).scrutiny;
  } finally {
    db.close();
  }
}

describe("sb issue create applies the contract SCRUTINY section (XTRM-391)", () => {
  it("derives issues.scrutiny from the contract file when --scrutiny is absent", () => {
    const { dir, dbPath } = setupDb();
    const c = contractFile(dir, "c.json", { scrutiny: "MEDIUM" });
    const created = jsonCall(dbPath, ["issue", "create", "--project", "prj_demo", "--title", "T", "--kind", "task", "--contract", c]);
    assert.equal(created.code, 0, created.error);
    assert.equal(created.ok, true);
    const summary = created.data as { id: string; humanRef: string };
    assert.ok(!("scrutiny" in summary), "no field is added to issue summaries");
    assert.equal(columnScrutiny(dbPath, summary.id), "MEDIUM");

    // No attestation yet: still a draft, but with no scrutiny complaint.
    const shown = jsonCall(dbPath, ["issue", "show", summary.humanRef]).data as { readinessState: string; reasons: string[] };
    assert.equal(shown.readinessState, "draft");
    assert.ok(shown.reasons.every((r) => !/scrutiny/i.test(r)), `unexpected scrutiny reason: ${JSON.stringify(shown.reasons)}`);

    // Attest without --scrutiny, then claim: the dispatch path is unblocked.
    const attested = jsonCall(dbPath, ["issue", "attest", summary.humanRef, "--outcome", "ready", "--policy", "default", "--attested-by", "x", "--project", "prj_demo"]);
    assert.equal(attested.code, 0, attested.error);
    const ready = jsonCall(dbPath, ["issue", "show", summary.humanRef]).data as { readinessState: string; dispatchable: boolean };
    assert.equal(ready.readinessState, "ready");
    assert.equal(ready.dispatchable, true);
    const claimed = jsonCall(dbPath, ["issue", "claim", summary.humanRef, "--holder", "x-holder", "--project", "prj_demo"]);
    assert.equal(claimed.code, 0, claimed.error);
  });

  it("an explicit --scrutiny overrides the contract value", () => {
    const { dir, dbPath } = setupDb();
    const c = contractFile(dir, "c.json", { scrutiny: "MEDIUM" });
    const created = jsonCall(dbPath, ["issue", "create", "--project", "prj_demo", "--title", "T", "--kind", "task", "--contract", c, "--scrutiny", "HIGH"]);
    assert.equal(created.code, 0, created.error);
    assert.equal(columnScrutiny(dbPath, (created.data as { id: string }).id), "HIGH");
  });

  it("an explicit --scrutiny wins even when the contract value is invalid", () => {
    const { dir, dbPath } = setupDb();
    const c = contractFile(dir, "c.json", { scrutiny: "BOGUS" });
    const created = jsonCall(dbPath, ["issue", "create", "--project", "prj_demo", "--title", "T", "--kind", "task", "--contract", c, "--scrutiny", "HIGH"]);
    assert.equal(created.code, 0, created.error);
    assert.equal(columnScrutiny(dbPath, (created.data as { id: string }).id), "HIGH");
  });

  it("a --scrutiny flag alone satisfies the requirement on a seven-field contract", () => {
    const { dir, dbPath } = setupDb();
    const c = contractFile(dir, "c.json");
    const created = jsonCall(dbPath, ["issue", "create", "--project", "prj_demo", "--title", "T", "--kind", "task", "--contract", c, "--scrutiny", "LOW"]);
    assert.equal(created.code, 0, created.error);
    assert.equal(columnScrutiny(dbPath, (created.data as { id: string }).id), "LOW");
  });

  it("a contract scrutiny of BOGUS fails closed and stores nothing", () => {
    const { dir, dbPath } = setupDb();
    const before = issueCount(dbPath);
    const c = contractFile(dir, "c.json", { scrutiny: "BOGUS" });
    const res = jsonCall(dbPath, ["issue", "create", "--project", "prj_demo", "--title", "T", "--kind", "task", "--contract", c]);
    assert.equal(res.code, 1);
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /BOGUS/);
    assert.match(res.error ?? "", /LOW, MEDIUM, HIGH, CRITICAL/);
    assert.equal(issueCount(dbPath), before, "refused create must not store an issue");
  });

  it("a missing scrutiny fails closed and stores nothing", () => {
    const { dir, dbPath } = setupDb();
    const before = issueCount(dbPath);
    const c = contractFile(dir, "c.json");
    const res = jsonCall(dbPath, ["issue", "create", "--project", "prj_demo", "--title", "T", "--kind", "task", "--contract", c]);
    assert.equal(res.code, 1);
    assert.equal(res.ok, false);
    assert.match(res.error ?? "", /LOW, MEDIUM, HIGH, CRITICAL/);
    assert.equal(issueCount(dbPath), before, "refused create must not store an issue");
  });
});

describe("sb issue attest confirmation names the ref and the outcome (XTRM-391)", () => {
  it("feedback names the ref and the outcome", () => {
    const fb = feedbackForCommand(
      "issue.attest",
      ["issue", "attest", "DEMO-1", "--outcome", "ready", "--policy", "default", "--attested-by", "x"],
      { outcome: "ready", policy: "default" },
    );
    assert.equal(fb.level, "success");
    assert.match(renderFeedback(fb, plain), /^✓ Attested DEMO-1 as ready/);
  });

  it("human attest output names the ref and the outcome end to end", async () => {
    const { dir, dbPath } = setupDb();
    const c = contractFile(dir, "c.json", { scrutiny: "MEDIUM" });
    const created = jsonCall(dbPath, ["issue", "create", "--project", "prj_demo", "--title", "T", "--kind", "task", "--contract", c]);
    assert.equal(created.code, 0, created.error);
    const ref = (created.data as { humanRef: string }).humanRef;
    const res = await runUxCli(["--db", dbPath, "--plain", "issue", "attest", ref, "--outcome", "ready", "--policy", "default", "--attested-by", "x", "--project", "prj_demo"]);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, new RegExp(`Attested ${ref} as ready`));
  });

  it("attest errors still carry a next-action hint", () => {
    const text = renderFeedback(feedbackForError("issue.attest", "--outcome <ready|reject> is required"), plain);
    assert.match(text, /next: sb help issue attest/);
  });
});
