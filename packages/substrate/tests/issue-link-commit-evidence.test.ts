// CORE-2787: T2 evidence for a PR link may arrive as data.
//
// The defect this covers is a repository boundary, not a formatting one: in
// remote mode `issue link pr --commits-range` reads git in the SERVER's checkout,
// where a PR pushed from the caller a moment earlier does not exist, so the link
// keeps the mention and loses the evidence. The property under test is therefore
// "a commit this repository does not contain still records its evidence", and
// the control is the same sha failing the old path.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { contract, setup, tempDir } from "./helpers.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { readCommitEvidenceDocument, readLocalCommitEvidence } from "../src/remote/commit-evidence.ts";
import { runCli } from "../cli/sb.ts";

// A sha this repository cannot resolve: the whole point is that the far side
// must not need it in its object store.
const REMOTE_SHA = "9f2c1ab3d4e5f60a7b8c9d0e1f2a3b4c5d6e7f80";

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
  const claim = ctx.svc.claimIssue(issue.id, "w", { ttlMs: 60_000 });
  const binding = prov.dispatch(issue.id, { workspace: "/tmp/ws", participantId: "w", claimId: claim.id });
  const receipt = prov.allocateReceipt(binding.id);
  return { ...ctx, issue, receipt };
}

function evidenceBody(issueRef: string, receiptId: string): Array<{ sha: string; message: string }> {
  return [
    {
      sha: REMOTE_SHA,
      message: `feat: work from the caller\n\nXTRM-Issue: ${issueRef}\nXTRM-Issue-Revision: 1\nXTRM-Receipt: ${receiptId}`,
    },
  ];
}

function writeEvidence(dir: string, body: unknown): string {
  const path = join(dir, "evidence.json");
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body));
  return path;
}

function gitIn(repo: string, args: string[]): string {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
}

describe("commit evidence document", () => {
  it("reads a file and inline JSON through the same branch", () => {
    const dir = tempDir("sb-evidence-");
    const body = [{ sha: REMOTE_SHA, message: "feat: x\n\nXTRM-Issue: XTRM-1" }];
    assert.deepEqual(readCommitEvidenceDocument(writeEvidence(dir, body)), body);
    assert.deepEqual(readCommitEvidenceDocument(JSON.stringify(body)), body);
    assert.throws(() => readCommitEvidenceDocument("[]"), /carried no commits: omit the flag to record a mention instead/);
  });

  it("refuses a document that is not an array, an entry without a sha, and an empty message", () => {
    assert.throws(() => readCommitEvidenceDocument('{"sha":"x"}'), /must be a JSON array/);
    assert.throws(() => readCommitEvidenceDocument('[["sha"]]'), /\[0\] must be an object/);
    assert.throws(() => readCommitEvidenceDocument('[{"sha":"zzz","message":"m"}]'), /is not a commit SHA/);
    assert.throws(() => readCommitEvidenceDocument(`[{"sha":"${REMOTE_SHA}","message":"  "}]`), /message is empty/);
    assert.throws(() => readCommitEvidenceDocument("not json at all"), /not a readable file and not valid inline JSON/);
  });

  it("reads the caller's own git for a range and for single commits", () => {
    const repo = tempDir("sb-evidence-git-");
    gitIn(repo, ["init", "-q"]);
    gitIn(repo, ["config", "user.email", "t@example.com"]);
    gitIn(repo, ["config", "user.name", "t"]);
    writeFileSync(join(repo, "a.txt"), "a");
    gitIn(repo, ["add", "a.txt"]);
    gitIn(repo, ["commit", "-q", "-m", "init"]);
    writeFileSync(join(repo, "b.txt"), "b");
    gitIn(repo, ["add", "b.txt"]);
    gitIn(repo, ["commit", "-q", "-m", "feat: b\n\nXTRM-Issue: XTRM-1\nXTRM-Receipt: r1"]);
    const head = gitIn(repo, ["rev-parse", "HEAD"]).trim();

    const range = readLocalCommitEvidence({ range: "HEAD~1..HEAD", commits: [] }, repo);
    assert.equal(range.length, 1);
    assert.equal(range[0]!.sha, head);
    assert.match(range[0]!.message, /XTRM-Receipt: r1/);

    const single = readLocalCommitEvidence({ commits: [head] }, repo);
    assert.equal(single.length, 1);
    assert.equal(single[0]!.sha, head);

    const both = readLocalCommitEvidence({ range: "HEAD~1..HEAD", commits: [head] }, repo);
    assert.equal(both.length, 2, "a range and an explicit commit both contribute evidence");
  });

  it("names the calling repository when git cannot answer, and offers the mention", () => {
    const repo = tempDir("sb-evidence-git-");
    gitIn(repo, ["init", "-q"]);
    assert.throws(
      () => readLocalCommitEvidence({ commits: [REMOTE_SHA] }, repo),
      (error: unknown) => error instanceof Error && error.message.includes(repo) && /mention/.test(error.message),
    );
    assert.throws(() => readLocalCommitEvidence({ range: "HEAD", commits: [] }, repo), /must be <base>\.\.<head>/);
  });
});

describe("issue link pr with supplied evidence", () => {
  let w: ReturnType<typeof world>;
  let repo: string;
  let saved: string;
  beforeEach(() => {
    w = world();
    // The caller's repository: one commit, a history the remote sha is absent from.
    repo = tempDir("sb-evidence-repo-");
    gitIn(repo, ["init", "-q"]);
    gitIn(repo, ["config", "user.email", "t@example.com"]);
    gitIn(repo, ["config", "user.name", "t"]);
    writeFileSync(join(repo, "a.txt"), "a");
    gitIn(repo, ["add", "a.txt"]);
    gitIn(repo, ["commit", "-q", "-m", "init"]);
    saved = process.cwd();
    process.chdir(repo);
  });
  afterEach(() => {
    process.chdir(saved);
    w.db.close();
  });

  const link = (extra: string[]) =>
    runCli([
      "--db", join(w.dir, "state.db"), "--json",
      "issue", "link", "pr", w.issue.humanRef, "--project", "prj_xtrm", "--repo", "o/r", "--number", "7",
      ...extra,
    ]);

  it("links a commit this repository does not contain (the CORE-2787 case)", () => {
    // Control: the old path cannot produce this evidence here.
    assert.throws(() => gitIn(repo, ["cat-file", "-e", REMOTE_SHA]), "the sha must be absent from the calling repository");

    const path = writeEvidence(w.dir, evidenceBody(w.issue.humanRef, w.receipt.id));
    const res = link(["--commit-evidence", path]);
    assert.equal(res.code, 0, res.stderr);

    const data = (JSON.parse(res.stdout) as { data: { created: number } }).data;
    assert.equal(data.created, 1);
    const rows = w.db.prepare("SELECT sha, trailer_revision FROM issue_pr_commits").all() as Array<{ sha: string; trailer_revision: number }>;
    assert.deepEqual(rows.map((row) => ({ ...row })), [{ sha: REMOTE_SHA, trailer_revision: 1 }]);
  });

  it("accepts inline evidence and does not consult git at all", () => {
    const inline = JSON.stringify(evidenceBody(w.issue.humanRef, w.receipt.id));
    // A range git cannot resolve stands in for "the old path would have failed":
    // with evidence supplied, the range is never read.
    const res = link(["--commits-range", "deadbee..feedfac", "--commit-evidence", inline]);
    assert.equal(res.code, 0, res.stderr);
    assert.equal((JSON.parse(res.stdout) as { data: { created: number } }).data.created, 1);
  });

  it("refuses an empty document instead of recording a bare mention", () => {
    const path = writeEvidence(w.dir, []);
    const res = link(["--commit-evidence", path]);
    assert.notEqual(res.code, 0);
    assert.match(res.stdout + res.stderr, /carried no commits: omit the flag to record a mention instead/);
    const rows = w.db.prepare("SELECT sha FROM issue_pr_commits").all();
    assert.deepEqual(rows.map((row) => ({ ...row })), [], "nothing is written when the caller asked for evidence and sent none");
  });

  it("refuses a document with a malformed sha", () => {
    const path = writeEvidence(w.dir, [{ sha: "not-a-sha", message: `XTRM-Issue: ${w.issue.humanRef}` }]);
    const res = link(["--commit-evidence", path]);
    assert.notEqual(res.code, 0);
    assert.match(res.stdout + res.stderr, /is not a commit SHA/);
    assert.deepEqual(w.db.prepare("SELECT sha FROM issue_pr_commits").all().map((row) => ({ ...row })), []);
  });
});
