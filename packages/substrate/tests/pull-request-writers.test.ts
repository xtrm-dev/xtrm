// Issue-to-PR writers, slice 2 (XTRM-727): T1 attach, mention/unlink, T2 from
// trailers, findings. Every rule here is mutation-sensitive.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { contract, setup, tempDir } from "./helpers.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { PullRequestService } from "../src/service/pull-request-service.ts";
import { canonicalPullReference } from "../src/domain/pull-request.ts";
import { runCli } from "../cli/sb.ts";

function world() {
  const ctx = setup();
  const issue = ctx.svc.createIssue({
    projectId: "prj_xtrm",
    title: "work",
    kind: "task",
    contract: contract(),
    scrutiny: "MEDIUM",
  });
  ctx.svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  const journal = new JournalService(ctx.db, ctx.svc);
  const prov = new ProvenanceService(ctx.db, ctx.svc, journal);
  const links = new PullRequestService(ctx.db, ctx.svc, prov);
  return { ...ctx, issue, prov, links };
}

function dispatchWithClaim(w: ReturnType<typeof world>, holder = "w") {
  const claim = w.svc.claimIssue(w.issue.id, holder, { ttlMs: 60_000 });
  const binding = w.prov.dispatch(w.issue.id, { workspace: "/tmp/ws", participantId: holder, claimId: claim.id });
  const receipt = w.prov.allocateReceipt(binding.id);
  return { claim, binding, receipt };
}

const PR = { repository: "o/r", number: 7, canonical: "o/r#7", url: "https://github.com/o/r/pull/7" };

function throwsCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (error: unknown) => error instanceof Error && error.message.startsWith(`${code}:`));
}

describe("pull-request writers", () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });
  afterEach(() => {
    w.db.close();
    rmSync(w.dir, { recursive: true, force: true });
  });

  it("migration 014 adds superseded_at and the live index", () => {
    const cols = w.db.prepare("PRAGMA table_info(issue_pull_requests)").all() as Array<{ name: string }>;
    assert.ok(cols.some((c) => c.name === "superseded_at"));
    const idx = w.db.prepare("PRAGMA index_list(issue_pull_requests)").all() as Array<{ name: string }>;
    assert.ok(idx.some((i) => i.name === "ix_issue_prs_live"));
  });

  it("canonicalises all four spellings and rejects the rest", () => {
    assert.equal(canonicalPullReference("github:o/r#7", null)?.canonical, "o/r#7");
    assert.equal(canonicalPullReference("o/r#7", null)?.canonical, "o/r#7");
    assert.equal(canonicalPullReference("https://github.com/o/r/pull/7", null)?.canonical, "o/r#7");
    assert.equal(canonicalPullReference("#7", "o/r")?.canonical, "o/r#7");
    assert.equal(canonicalPullReference("#7", null), null);
    assert.equal(canonicalPullReference("o/r#0", null), null);
    assert.equal(canonicalPullReference("o/r", null), null);
  });

  it("T1 attaches the artifact and the created_from row in one transaction, idempotently", () => {
    const { receipt } = dispatchWithClaim(w);
    const view = w.links.attachCreatedFrom(
      { issueId: w.issue.id, ambientRepo: null, actor: "w", receiptId: receipt.id },
      PR,
    );
    assert.equal(view.relation, "created_from");
    assert.deepEqual(view.sources, ["provenance"]);
    const artifacts = w.prov.listArtifacts(receipt.id);
    assert.deepEqual(artifacts.map((a) => [a.kind, a.value]), [["pr", "o/r#7"]]);
    // Idempotent: the same receipt/value is a no-op.
    w.links.attachCreatedFrom({ issueId: w.issue.id, ambientRepo: null, actor: "w", receiptId: receipt.id }, PR);
    const n = w.db.prepare("SELECT COUNT(*) AS n FROM issue_pull_requests").get() as { n: number };
    assert.equal(n.n, 1);
    const events = w.svc.listEvents(w.issue.id).filter((e) => e.type === "provenance.link_created");
    assert.equal(events.length, 1);
  });

  it("b2 resolves the receipt from the holder's live claim binding, not b3's latest", () => {
    const { receipt } = dispatchWithClaim(w, "w");
    // A later binding carries a later receipt; b3 would pick it, b2 must not.
    w.db
      .prepare(
        `INSERT INTO execution_bindings
           (id, issue_id, issue_revision, contract_hash, resolved_context_hash, claim_id,
            participant_id, activation_id, attempt_id, session_id, workspace, base_commit, execution_context_json, created_at)
         VALUES (?,?,?,?,?,NULL,?,NULL,NULL,?,?,NULL,NULL,?)`,
      )
      .run("exb_later", w.issue.id, w.issue.currentRevision, w.issue.currentContractHash, "hash", "w", null, "/tmp/ws2", Date.now() + 1);
    const later = w.prov.allocateReceipt("exb_later");
    const view = w.links.attachCreatedFrom(
      { issueId: w.issue.id, ambientRepo: null, actor: "w", holder: "w" },
      PR,
    );
    assert.equal(view.relation, "created_from");
    assert.deepEqual(w.prov.listArtifacts(receipt.id).map((a) => a.value), ["o/r#7"]);
    assert.equal(w.prov.listArtifacts(later.id).length, 0);
  });

  it("b3 falls back to the latest receipt and refuses when there is none", () => {
    assert.throws(
      () => w.links.attachCreatedFrom({ issueId: w.issue.id, ambientRepo: null, actor: "w" }, PR),
      (err: Error) => /no_receipt/.test(err.message) && /dispatch/.test(err.message),
    );
    const { receipt } = dispatchWithClaim(w);
    const view = w.links.attachCreatedFrom({ issueId: w.issue.id, ambientRepo: null, actor: "w" }, PR);
    assert.equal(view.relation, "created_from");
    assert.equal(w.prov.listArtifacts(receipt.id).length, 1);
  });

  it("a foreign receipt is a hard refusal with nothing written", () => {
    const other = w.svc.createIssue({ projectId: "prj_xtrm", title: "other", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
    w.svc.attestReadiness(other.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
    const claim = w.svc.claimIssue(other.id, "w", { ttlMs: 60_000 });
    const binding = w.prov.dispatch(other.id, { workspace: "/tmp/ws", participantId: "w", claimId: claim.id });
    const foreign = w.prov.allocateReceipt(binding.id);
    throwsCode(() => w.links.attachCreatedFrom({ issueId: w.issue.id, ambientRepo: null, actor: "w", receiptId: foreign.id }, PR), "receipt_foreign_issue");
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM issue_pull_requests").get()!.n, 0);
    assert.equal(w.prov.listArtifacts(foreign.id).length, 0);
  });

  it("a superseded receipt (newer receipt on the binding) is refused", () => {
    const { binding, receipt } = dispatchWithClaim(w);
    w.prov.allocateReceipt(binding.id);
    throwsCode(() => w.links.attachCreatedFrom({ issueId: w.issue.id, ambientRepo: null, actor: "w", receiptId: receipt.id }, PR), "receipt_superseded");
  });

  it("a failing attach inside the transaction commits nothing", () => {
    const { receipt } = dispatchWithClaim(w);
    w.db.exec("CREATE TRIGGER fail_link BEFORE INSERT ON issue_pull_requests BEGIN SELECT RAISE(ABORT, 'forced link failure'); END");
    assert.throws(
      () => w.links.attachCreatedFrom({ issueId: w.issue.id, ambientRepo: null, actor: "w", receiptId: receipt.id }, PR),
      /forced link failure/,
    );
    assert.equal(w.prov.listArtifacts(receipt.id).length, 0);
    assert.equal(w.svc.listEvents(w.issue.id).filter((e) => e.type === "provenance.artifact_attached").length, 0);
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM issue_pull_requests").get()!.n, 0);
  });

  it("an unknown explicit receipt fails with receipt_unknown", () => {
    throwsCode(
      () => w.links.attachCreatedFrom({ issueId: w.issue.id, ambientRepo: null, actor: "w", receiptId: "rec_does_not_exist" }, PR),
      "receipt_unknown",
    );
  });

  it("re-attach restores a row after unlink, with one artifact event", () => {
    const { receipt } = dispatchWithClaim(w);
    w.links.attachCreatedFrom({ issueId: w.issue.id, ambientRepo: null, actor: "w", receiptId: receipt.id }, PR);
    const before = w.db.prepare("SELECT created_at, url, actor FROM issue_pull_requests").get() as { created_at: number; url: string; actor: string };
    w.links.unlink({ issueId: w.issue.id, repository: "o/r", number: 7 });
    const restored = w.links.attachCreatedFrom({ issueId: w.issue.id, ambientRepo: null, actor: "restorer", receiptId: receipt.id }, PR);
    assert.equal(restored.relation, "created_from");
    const after = w.db.prepare("SELECT created_at, url, actor FROM issue_pull_requests").get() as { created_at: number; url: string; actor: string };
    // Restore clears superseded_at only: identity and time are the original link's.
    assert.deepEqual(after, before);
    const artifactEvents = w.svc.listEvents(w.issue.id).filter((e) => e.type === "provenance.artifact_attached");
    assert.equal(artifactEvents.length, 1);
    const linkEvents = w.svc.listEvents(w.issue.id).filter((e) => e.type === "provenance.link_created");
    const last = linkEvents[linkEvents.length - 1]!.payload as { actor?: string };
    assert.equal(last.actor, "restorer");
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM issue_pull_requests").get()!.n, 1);
  });

  it("a receipt from an older revision is refused as stale", () => {
    const { receipt } = dispatchWithClaim(w);
    w.svc.updateContract(w.issue.id, contract({ problem: "P2" }), "t");
    throwsCode(() => w.links.attachCreatedFrom({ issueId: w.issue.id, ambientRepo: null, actor: "w", receiptId: receipt.id }, PR), "receipt_stale_revision");
  });

  it("b3 refuses a stale receipt too", () => {
    dispatchWithClaim(w);
    w.svc.updateContract(w.issue.id, contract({ problem: "P2" }), "t");
    throwsCode(() => w.links.attachCreatedFrom({ issueId: w.issue.id, ambientRepo: null, actor: "w" }, PR), "receipt_stale_revision");
  });

  it("T2 records a stale receipt as a mention plus receipt_stale_revision", () => {
    const { receipt } = dispatchWithClaim(w);
    w.svc.updateContract(w.issue.id, contract({ problem: "P2" }), "t");
    const message = `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}`;
    const result = w.links.linkCommits({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w", commits: [{ sha: "6".repeat(40), message }] });
    assert.equal(result.mentioned, 1);
    assert.deepEqual(w.links.listFindings("prj_xtrm").map((f) => f.code), ["receipt_stale_revision"]);
  });

  it("finding dedupe is scoped to the PR as well as the commit", () => {
    const message = `XTRM-Issue: ${w.issue.humanRef}`;
    w.links.linkCommits({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w", commits: [{ sha: "7".repeat(40), message }] });
    w.links.linkCommits({ issueId: w.issue.id, repository: "o/r", number: 8, actor: "w", commits: [{ sha: "7".repeat(40), message }] });
    const findings = w.links.listFindings("prj_xtrm");
    assert.deepEqual(findings.map((f) => [f.code, f.number]).sort(), [["trailer_receipt_missing", 7], ["trailer_receipt_missing", 8]]);
  });

  it("mention is persisted, idempotent, and unlink supersedes without deleting", () => {
    w.links.linkMention({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w" });
    w.links.linkMention({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w" });
    assert.equal(w.links.listForIssue(w.issue.id).length, 1);
    assert.equal(w.links.listForIssue(w.issue.id)[0]!.relation, "mentioned");
    assert.equal(w.links.listForIssue(w.issue.id)[0]!.sources[0], "explicit");
    assert.equal(w.links.unlink({ issueId: w.issue.id, repository: "o/r", number: 7 }), 1);
    assert.equal(w.links.unlink({ issueId: w.issue.id, repository: "o/r", number: 7 }), 0);
    assert.equal(w.links.listForIssue(w.issue.id).length, 0);
    const row = w.db.prepare("SELECT superseded_at FROM issue_pull_requests").get() as { superseded_at: number | null };
    assert.notEqual(row.superseded_at, null);
  });

  it("T2 writes created_from from a valid trailer and stores the commit", () => {
    const { receipt } = dispatchWithClaim(w);
    const message = [
      "feat: work",
      "",
      `XTRM-Issue: ${w.issue.humanRef}`,
      "XTRM-Issue-Revision: 2",
      `XTRM-Receipt: ${receipt.id}`,
    ].join("\n");
    const result = w.links.linkCommits({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w", commits: [{ sha: "a".repeat(40), message }] });
    assert.deepEqual(result, { created: 1, mentioned: 0, findings: 0 });
    const view = w.links.listForIssue(w.issue.id)[0]!;
    assert.equal(view.relation, "created_from");
    assert.deepEqual(view.sources, ["trailer"]);
    assert.deepEqual(view.commits.map((c) => [c.sha, c.trailerRevision]), [["a".repeat(40), 2]]);
  });

  it("T2 commits are evidence for created_from only, not for a leftover mention", () => {
    const { receipt } = dispatchWithClaim(w);
    const message = `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}`;
    w.links.linkCommits({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w", commits: [{ sha: "e".repeat(40), message }] });
    w.links.linkMention({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w" });
    w.links.unlink({ issueId: w.issue.id, repository: "o/r", number: 7, relation: "created_from" });
    const view = w.links.listForIssue(w.issue.id)[0]!;
    assert.equal(view.relation, "mentioned");
    assert.deepEqual(view.commits, []);
  });

  it("T2 with several issue trailers writes no row and records a finding", () => {
    const { receipt } = dispatchWithClaim(w);
    const message = `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Issue: XTRM-999\nXTRM-Receipt: ${receipt.id}`;
    const result = w.links.linkCommits({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w", commits: [{ sha: "b".repeat(40), message }] });
    assert.equal(result.created, 0);
    assert.equal(result.findings, 1);
    assert.equal(w.links.listForIssue(w.issue.id).length, 0);
    assert.deepEqual(w.links.listFindings("prj_xtrm").map((f) => f.code), ["commit_multi_issue"]);
  });

  it("T2 without a receipt becomes a mention plus a finding", () => {
    const message = `XTRM-Issue: ${w.issue.humanRef}`;
    const result = w.links.linkCommits({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w", commits: [{ sha: "c".repeat(40), message }] });
    assert.equal(result.created, 0);
    assert.equal(result.mentioned, 1);
    const view = w.links.listForIssue(w.issue.id)[0]!;
    assert.equal(view.relation, "mentioned");
    assert.deepEqual(view.sources, ["trailer"]);
    assert.deepEqual(w.links.listFindings("prj_xtrm").map((f) => f.code), ["trailer_receipt_missing"]);
  });

  it("b3 chooses the latest receipt", () => {
    const { receipt: first } = dispatchWithClaim(w);
    const second = (() => {
      const claim = w.svc.getActiveClaim(w.issue.id)!;
      const binding = w.prov.dispatch(w.issue.id, { workspace: "/tmp/ws2", participantId: "w", claimId: claim.id });
      return { binding, receipt: w.prov.allocateReceipt(binding.id) };
    })();
    w.links.attachCreatedFrom({ issueId: w.issue.id, ambientRepo: null, actor: "w" }, PR);
    assert.equal(w.prov.listArtifacts(first.id).length, 0);
    assert.equal(w.prov.listArtifacts(second.receipt.id).length, 1);
  });

  it("T2 records an ambiguous receipt, an unknown issue and a foreign trailer", () => {
    const { receipt } = dispatchWithClaim(w);
    const ambiguous = `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}\nXTRM-Receipt: rec_second`;
    const r1 = w.links.linkCommits({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w", commits: [{ sha: "f".repeat(40), message: ambiguous }] });
    assert.equal(r1.mentioned, 1);
    const unknown = `XTRM-Issue: XTRM-404\nXTRM-Receipt: ${receipt.id}`;
    const r2 = w.links.linkCommits({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w", commits: [{ sha: "1".repeat(40), message: unknown }] });
    assert.equal(r2.created, 0);
    const other = w.svc.createIssue({ projectId: "prj_xtrm", title: "other", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
    const foreignTrailer = `XTRM-Issue: ${other.humanRef}\nXTRM-Receipt: ${receipt.id}`;
    const before = w.links.listForIssue(w.issue.id).length;
    const r3 = w.links.linkCommits({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w", commits: [{ sha: "2".repeat(40), message: foreignTrailer }] });
    assert.deepEqual({ created: r3.created, mentioned: r3.mentioned, findings: r3.findings }, { created: 0, mentioned: 0, findings: 0 });
    // A foreign trailer is skipped entirely: no new row appears for the target.
    assert.equal(w.links.listForIssue(w.issue.id).length, before);
    assert.deepEqual(
      w.links.listFindings("prj_xtrm").map((f) => f.code).sort(),
      ["trailer_issue_unknown", "trailer_receipt_ambiguous"],
    );
  });

  it("T2 ignores a commit with no XTRM-Issue trailer", () => {
    const result = w.links.linkCommits({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w", commits: [{ sha: "5".repeat(40), message: "chore: no trailer" }] });
    assert.deepEqual(result, { created: 0, mentioned: 0, findings: 0 });
    assert.equal(w.links.listForIssue(w.issue.id).length, 0);
    assert.equal(w.links.listFindings("prj_xtrm").length, 0);
  });

  it("T2 a rerun does not duplicate findings", () => {
    const message = `XTRM-Issue: ${w.issue.humanRef}`;
    const run = () => w.links.linkCommits({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w", commits: [{ sha: "3".repeat(40), message }] });
    assert.equal(run().findings, 1);
    assert.equal(run().findings, 0);
    assert.equal(w.links.listFindings("prj_xtrm").length, 1);
  });

  it("T2 a foreign trailer receipt is a mention with the exact code", () => {
    const other = w.svc.createIssue({ projectId: "prj_xtrm", title: "other", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
    w.svc.attestReadiness(other.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
    const claim = w.svc.claimIssue(other.id, "w", { ttlMs: 60_000 });
    const binding = w.prov.dispatch(other.id, { workspace: "/tmp/ws", participantId: "w", claimId: claim.id });
    const foreign = w.prov.allocateReceipt(binding.id);
    const message = `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${foreign.id}`;
    const result = w.links.linkCommits({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w", commits: [{ sha: "4".repeat(40), message }] });
    assert.equal(result.mentioned, 1);
    assert.equal(w.links.listForIssue(w.issue.id)[0]!.relation, "mentioned");
    assert.deepEqual(w.links.listFindings("prj_xtrm").map((f) => f.code), ["trailer_receipt_foreign_issue"]);
  });

  it("T2 keeps the first claim and records a conflict, never throws", () => {
    const { receipt } = dispatchWithClaim(w);
    const other = w.svc.createIssue({ projectId: "prj_xtrm", title: "other", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
    w.db
      .prepare("INSERT INTO issue_pr_commits (issue_id, repository, number, sha, landed_sha, trailer_revision) VALUES (?,?,?,?,NULL,NULL)")
      .run(other.id, "o/r", 7, "d".repeat(40));
    const message = `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}`;
    const result = w.links.linkCommits({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w", commits: [{ sha: "d".repeat(40), message }] });
    assert.equal(result.findings, 1);
    assert.deepEqual(w.links.listFindings("prj_xtrm").map((f) => f.code), ["commit_claimed_twice"]);
    const rows = w.db.prepare("SELECT issue_id FROM issue_pr_commits WHERE sha = ?").all("d".repeat(40)) as Array<{ issue_id: string }>;
    assert.deepEqual(rows.map((r) => r.issue_id), [other.id]);
  });

  it("CLI: a bare #N scopes to the checkout origin and attaches T1", () => {
    const { receipt } = dispatchWithClaim(w);
    const repo = tempDir("sb-pr-cli-");
    const saved = process.cwd();
    try {
      const git = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
      git(["init", "-q"]);
      git(["config", "user.email", "t@example.com"]);
      git(["config", "user.name", "t"]);
      git(["remote", "add", "origin", "git@github.com:o/r.git"]);
      writeFileSync(join(repo, "a.txt"), "a");
      git(["add", "a.txt"]);
      git(["commit", "-q", "-m", "init"]);
      process.chdir(repo);
      const res = runCli([
        "--db", join(w.dir, "state.db"), "--json",
        "provenance", "attach", w.issue.humanRef, "pr", "#7", "--project", "prj_xtrm", "--receipt", receipt.id, "--holder", "w",
      ]);
      assert.equal(res.code, 0, `${res.stderr} | ${res.stdout}`);
      const view = (JSON.parse(res.stdout) as { data: { link: { repository: string; number: number; relation: string } } }).data.link;
      assert.equal(view.repository, "o/r");
      assert.equal(view.number, 7);
      assert.equal(view.relation, "created_from");
    } finally {
      process.chdir(saved);
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("CLI: an issue's repository binding wins over the checkout origin for a bare #N", () => {
    const { receipt } = dispatchWithClaim(w);
    w.db
      .prepare("INSERT INTO repository_bindings (repository_key, project_id, base_branch, canonical_remote, created_at, updated_at) VALUES (?,?,?,?,?,?)")
      .run("github.com/o/r-proj", "prj_xtrm", "main", "github.com/o/r-proj", 1, 1);
    const repo = tempDir("sb-pr-cli-");
    const saved = process.cwd();
    try {
      const git = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
      git(["init", "-q"]);
      git(["config", "user.email", "t@example.com"]);
      git(["config", "user.name", "t"]);
      git(["remote", "add", "origin", "git@github.com:o/r.git"]);
      writeFileSync(join(repo, "a.txt"), "a");
      git(["add", "a.txt"]);
      git(["commit", "-q", "-m", "init"]);
      process.chdir(repo);
      const res = runCli([
        "--db", join(w.dir, "state.db"), "--json",
        "provenance", "attach", w.issue.humanRef, "pr", "#7", "--project", "prj_xtrm", "--receipt", receipt.id, "--holder", "w",
      ]);
      assert.equal(res.code, 0, res.stderr);
      const view = (JSON.parse(res.stdout) as { data: { link: { repository: string; number: number } } }).data.link;
      assert.equal(view.repository, "o/r-proj");
      assert.equal(view.number, 7);
    } finally {
      process.chdir(saved);
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("CLI: --commits-range reads git and writes the T2 evidence", () => {
    const { receipt } = dispatchWithClaim(w);
    const repo = tempDir("sb-pr-cli-");
    const saved = process.cwd();
    try {
      const git = (args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
      git(["init", "-q"]);
      git(["config", "user.email", "t@example.com"]);
      git(["config", "user.name", "t"]);
      writeFileSync(join(repo, "a.txt"), "a");
      git(["add", "a.txt"]);
      git(["commit", "-q", "-m", "init"]);
      const message = `feat: work\n\nXTRM-Issue: ${w.issue.humanRef}\nXTRM-Issue-Revision: 1\nXTRM-Receipt: ${receipt.id}`;
      writeFileSync(join(repo, "b.txt"), "b");
      git(["add", "b.txt"]);
      git(["commit", "-q", "-m", message]);
      process.chdir(repo);
      const res = runCli([
        "--db", join(w.dir, "state.db"), "--json",
        "issue", "link", "pr", w.issue.humanRef, "--project", "prj_xtrm", "--repo", "o/r", "--number", "7",
        "--commits-range", "HEAD~1..HEAD",
      ]);
      assert.equal(res.code, 0, res.stderr);
      const data = (JSON.parse(res.stdout) as { data: { created: number } }).data;
      assert.equal(data.created, 1);
      const rows = w.db.prepare("SELECT sha, trailer_revision FROM issue_pr_commits").all() as Array<{ sha: string; trailer_revision: number }>;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.trailer_revision, 1);
    } finally {
      process.chdir(saved);
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("help answers for the new verbs", () => {
    for (const argv of [["issue", "link", "--help"], ["issue", "unlink", "--help"], ["provenance", "attach", "--help"]]) {
      const res = runCli(["--db", join(w.dir, "state.db"), ...argv]);
      assert.equal(res.code, 0, argv.join(" "));
      assert.match(res.stdout, /usage: sb /);
    }
  });
});
