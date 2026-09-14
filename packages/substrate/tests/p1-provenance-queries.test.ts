// P1 acceptance (XTRM-252.9): ADR §80 query matrix, §81 session/activation
// surfaces, §95 zero-commit completeness, §60 selective projection, and
// §61 inbound comment trust boundary — each against seeded data.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { ClosureService } from "../src/service/closure-service.ts";
import { IntegrationService } from "../src/service/integration-service.ts";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";
import { contract } from "./helpers.ts";

const SHA_A = "a".repeat(40);

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "substrate-p1-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  return { dir, dbPath, db, svc };
}

function readyIssue(svc: IssueService, title = "work", opts?: { activationId?: string }) {
  const issue = svc.createIssue({
    projectId: "prj_xtrm", title, kind: "task",
    contract: contract({ problem: `${title} problem`, success: `${title} success` }),
    scrutiny: "LOW", authoredBy: "tester",
  });
  svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  const claim = svc.claimIssue(issue.id, "holder-1", opts?.activationId ? { activationId: opts.activationId } : undefined);
  return { issue, claim };
}

function cli(dbPath: string, argv: string[]): unknown {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
  const env = JSON.parse(res.stdout) as { schema: string; ok: boolean; data: unknown };
  assert.equal(env.schema, SCHEMA_VERSION);
  assert.equal(env.ok, true);
  return env.data;
}

// Full §80 seed: bindings/sessions/activations, journal kinds, receipt +
// commit + PR, and a closure citing the result and receipt.
function seedMatrix(s: ReturnType<typeof scratch>) {
  const { issue } = readyIssue(s.svc, "matrix", { activationId: "act-1" });
  const journal = new JournalService(s.db, s.svc);
  const prov = new ProvenanceService(s.db, s.svc, journal);
  const closures = new ClosureService(s.db, s.svc);
  const b1 = prov.dispatch(issue.id, {
    workspace: s.dir, participantId: "holder-1",
    activationId: "act-1", sessionId: "sess-1",
  });
  journal.appendEntry(issue.id, {
    kind: "finding", sessionId: "sess-1", activationId: "act-1",
    semantic: { summary: "material fact" },
  });
  journal.appendEntry(issue.id, {
    kind: "decision", sessionId: "sess-1",
    semantic: { summary: "chose X because Y" },
  });
  const blockerEntry = journal.appendEntry(issue.id, {
    kind: "blocker", sessionId: "sess-1",
    semantic: { summary: "waiting on review" },
  });
  void blockerEntry;
  const result = journal.appendEntry(issue.id, {
    kind: "result", sessionId: "sess-1", activationId: "act-1",
    result: { summary: "bounded outcome", outcome: "completed" },
    refs: [{ kind: "evidence", key: "log", value: "tests green" }],
  });
  const receipt = prov.allocateReceipt(b1.id);
  prov.bindCommit(receipt.id, SHA_A);
  prov.attachArtifact(receipt.id, "pr", "github:xtrm/xtrm#121", { provider: "github" });
  // Second session touches the same issue through a new binding (same
  // live claim, so the activation pin is carried too).
  prov.dispatch(issue.id, {
    workspace: s.dir, participantId: "holder-1", activationId: "act-1", sessionId: "sess-2",
  });
  const closure = closures.closeIssue(issue.id, {
    outcome: "completed", reason: "matrix done", actor: "holder-1",
    journalResultRefs: [result.id], receiptRefs: [receipt.id],
  });
  return { issue, journal, prov, closures, b1, result, receipt, closure };
}

describe("P1 §80 query matrix against seeded data", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("answers results, latest result, decisions, blockers, sessions, issues-for-session, activations, closures", () => {
    const { issue, prov } = seedMatrix(s);

    const results = prov.resultsForIssue(issue.id);
    assert.equal(results.length, 1);
    assert.equal(results[0]!.result?.summary, "bounded outcome");

    const latest = prov.latestResult(issue.id);
    assert.ok(latest);
    assert.equal(latest.id, results[0]!.id);

    const decisions = prov.decisionsForIssue(issue.id);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0]!.semantic?.summary, "chose X because Y");

    const blockers = prov.currentBlockers(issue.id);
    assert.deepEqual(blockers.blockers, [], "no unsatisfied edges seeded");
    assert.equal(blockers.entries.length, 1, "journal blocker entry is visible");

    assert.deepEqual(prov.sessionsForIssue(issue.id), ["sess-1", "sess-2"]);
    assert.deepEqual(prov.issuesForSession("sess-1"), [issue.id]);
    assert.deepEqual(prov.issuesForSession("sess-2"), [issue.id]);
    assert.deepEqual(prov.issuesForSession("no-such-session"), []);
    assert.deepEqual(prov.activationsForIssue(issue.id), ["act-1"]);

    const outcomes = prov.closureOutcomes(issue.id);
    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0]!.outcome, "completed");
    assert.deepEqual(outcomes[0]!.journalResultRefs, [prov.resultsForIssue(issue.id)[0]!.id]);
  });

  it("unsatisfied blocks edges surface as current blockers", () => {
    const { issue, prov } = seedMatrix(s);
    const blocker = s.svc.createIssue({ projectId: "prj_xtrm", title: "B", kind: "task", contract: contract() });
    s.svc.addEdge(blocker.id, issue.id, "blocks");
    // Reopen so the edge is current on a non-terminal issue.
    const closures = new ClosureService(s.db, s.svc);
    closures.reopenIssue(issue.id, { reason: "recheck blockers" });
    const current = prov.currentBlockers(issue.id);
    assert.deepEqual(current.blockers, [blocker.id]);
  });

  it("finds closures lacking provenance and results lacking receipts", () => {
    const { issue, prov } = seedMatrix(s);
    // Terminal issue with no Closure row (direct lifecycle move, no close).
    const bare = s.svc.createIssue({ projectId: "prj_xtrm", title: "bare", kind: "task", contract: contract() });
    s.svc.setLifecycleState(bare.id, "done");
    // Open issue with a result but no receipt anywhere near it.
    const unreceipted = s.svc.createIssue({ projectId: "prj_xtrm", title: "unrec", kind: "task", contract: contract() });
    const journal = new JournalService(s.db, s.svc);
    const lonely = journal.appendEntry(unreceipted.id, {
      kind: "result", result: { summary: "no receipt", outcome: "completed" },
    });

    const lacking = prov.closuresLackingProvenance();
    assert.ok(
      lacking.some((l) => l.issueId === bare.id && l.reason === "terminal-without-closure"),
      `bare terminal issue must be reported: ${JSON.stringify(lacking)}`,
    );
    assert.ok(
      !lacking.some((l) => l.issueId === issue.id),
      "fully-cited closure must not be reported",
    );

    const unreceiptedResults = prov.resultsLackingReceipts(unreceipted.id);
    assert.deepEqual(unreceiptedResults.map((e) => e.id), [lonely.id]);
    assert.deepEqual(prov.resultsLackingReceipts(issue.id), [], "cited + receipt-covered result is not lacking");
  });
});

describe("P1 §81 session and activation queries", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("sessionDetail and activationDetail return the expected issues and artifacts", () => {
    const { issue, prov, receipt } = seedMatrix(s);
    const sess = prov.sessionDetail("sess-1");
    assert.equal(sess.sessionId, "sess-1");
    assert.deepEqual(sess.issueIds, [issue.id]);
    assert.equal(sess.bindingIds.length, 1);
    assert.deepEqual(sess.receiptIds, [receipt.id]);
    assert.ok(sess.artifacts.some((a) => a.kind === "commit" && a.value === SHA_A));
    assert.ok(sess.artifacts.some((a) => a.kind === "pr" && a.value === "github:xtrm/xtrm#121"));
    assert.equal(sess.resultCount, 1);

    const act = prov.activationDetail("act-1");
    assert.equal(act.activationId, "act-1");
    assert.deepEqual(act.issueIds, [issue.id]);
    assert.deepEqual(act.receiptIds, [receipt.id]);
    assert.ok(act.artifacts.some((a) => a.kind === "commit" && a.value === SHA_A));

    assert.deepEqual(prov.sessionDetail("no-such-session").issueIds, []);
    assert.deepEqual(prov.activationDetail("").issueIds, []);
  });

  it("sb provenance session/activation over the CLI return the same rows", () => {
    seedMatrix(s);
    const sess = cli(s.dbPath, ["provenance", "session", "sess-1"]) as {
      issueIds: string[]; receiptIds: string[]; resultCount: number;
      artifacts: Array<{ kind: string; value: string }>;
    };
    assert.equal(sess.issueIds.length, 1);
    assert.equal(sess.receiptIds.length, 1);
    assert.equal(sess.resultCount, 1);
    assert.ok(sess.artifacts.some((a) => a.kind === "commit" && a.value === SHA_A));
    const act = cli(s.dbPath, ["provenance", "activation", "act-1"]) as {
      issueIds: string[]; artifacts: Array<{ kind: string; value: string }>;
    };
    assert.equal(act.issueIds.length, 1);
    assert.ok(act.artifacts.some((a) => a.kind === "pr"));
    const empty = cli(s.dbPath, ["provenance", "session", "no-such-session"]) as { issueIds: string[] };
    assert.deepEqual(empty.issueIds, []);
  });
});

describe("P1 §95 zero-commit research issue stays complete", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("findings, result, evidence and closure with zero commits", () => {
    const issue = s.svc.createIssue({
      projectId: "prj_xtrm", title: "review", kind: "task",
      contract: contract({ problem: "review the design", success: "review recorded" }),
    });
    const journal = new JournalService(s.db, s.svc);
    const prov = new ProvenanceService(s.db, s.svc, journal);
    const closures = new ClosureService(s.db, s.svc);
    journal.appendEntry(issue.id, { kind: "finding", semantic: { summary: "design has a gap in retry policy" } });
    journal.appendEntry(issue.id, { kind: "finding", semantic: { summary: "backoff is unbounded" } });
    const result = journal.appendEntry(issue.id, {
      kind: "result",
      result: { summary: "review complete: two gaps", outcome: "completed", findings: ["gap-1", "gap-2"] },
      refs: [{ kind: "evidence", key: "design-doc", value: "docs/substrate/workflow.md" }],
    });
    const closure = closures.closeIssue(issue.id, {
      outcome: "completed", reason: "review recorded, no code change needed", actor: "reviewer",
      journalResultRefs: [result.id],
    });

    assert.deepEqual(prov.trace(issue.id).commits, [], "zero commits, still traceable");
    assert.equal(prov.resultsForIssue(issue.id).length, 1);
    assert.equal(prov.resultsForIssue(issue.id)[0]!.refs.length, 1, "evidence refs survive");
    assert.equal(prov.closureOutcomes(issue.id)[0]!.closureId, closure.closureId);
    assert.equal(prov.latestResult(issue.id)?.result?.outcome, "completed");
  });
});

describe("P1 §60 selective projection policy", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("mechanical checkpoints and runtime events are excluded; finding/decision/result/closure included", () => {
    const { issue } = readyIssue(s.svc, "proj");
    const journal = new JournalService(s.db, s.svc);
    const ix = new IntegrationService(s.db, s.svc);
    ix.bindExternal(issue.id, { provider: "github", remoteScope: "x/y", remoteId: "7", mode: "projection" });

    const finding = journal.appendEntry(issue.id, { kind: "finding", semantic: { summary: "matters" } });
    const decision = journal.appendEntry(issue.id, { kind: "decision", semantic: { summary: "we chose" } });
    const result = journal.appendEntry(issue.id, {
      kind: "result", result: { summary: "done", outcome: "completed" },
    });
    const plainNote = journal.appendEntry(issue.id, { kind: "note", semantic: { summary: "chatter" } });
    const richNote = journal.appendEntry(issue.id, {
      kind: "note", semantic: { summary: "important" }, refs: [{ kind: "evidence", key: "k", value: "v" }],
    });
    const checkpoint = journal.appendEntry(issue.id, {
      kind: "checkpoint", mechanical: journal.collectMechanical(issue.id),
    });
    const compaction = journal.appendEntry(issue.id, {
      kind: "compaction", mechanical: journal.collectMechanical(issue.id),
    });
    const scope = { provider: "github" as const, remoteScope: "x/y", operation: "upsert-note" };

    assert.equal(ix.enqueueJournalProjection(issue.id, finding.id, scope).enqueued, true, "finding projects");
    assert.equal(ix.enqueueJournalProjection(issue.id, decision.id, scope).enqueued, true, "decision projects");
    assert.equal(ix.enqueueJournalProjection(issue.id, result.id, scope).enqueued, true, "result projects");
    assert.equal(ix.enqueueJournalProjection(issue.id, richNote.id, scope).enqueued, true, "high-value note projects");

    const mech = ix.enqueueJournalProjection(issue.id, checkpoint.id, scope);
    assert.equal(mech.enqueued, false, "mechanical checkpoint does not project");
    const comp = ix.enqueueJournalProjection(issue.id, compaction.id, scope);
    assert.equal(comp.enqueued, false, "compaction checkpoint does not project");
    const plain = ix.enqueueJournalProjection(issue.id, plainNote.id, scope);
    assert.equal(plain.enqueued, false, "ordinary note stays local");
    assert.deepEqual(ix.classifyClosureForProjection().project, true, "closure projects");

    assert.equal(ix.isProjectableEvent("projection.pushed"), false, "runtime events never project");
    assert.equal(ix.isProjectableEvent("provenance.receipt_bound"), false);
    assert.equal(ix.isProjectableEvent("issue.closed"), true);
    assert.equal(
      ix.listOutbox().length, 4,
      "only the four projectable entries reached the outbox",
    );
  });
});

describe("P1 §61 inbound external comment trust boundary", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("preserves provider/remote/author/timestamp, marks untrusted, leaves the contract and revision alone", () => {
    const { issue } = readyIssue(s.svc, "commented");
    const ix = new IntegrationService(s.db, s.svc);
    const before = s.svc.getIssue(issue.id);
    const beforeHash = before.currentContractHash;

    const { entry, revision } = ix.receiveComment(issue.id, "github", {
      remoteScope: "xtrm-dev/xtrm",
      remoteId: "c-9921",
      remoteAuthor: "external-reviewer",
      remoteTimestamp: 1_784_000_000_000,
      body: "Have you considered the retry bound?",
    });

    assert.equal(entry.kind, "note");
    assert.equal(entry.semantic?.summary, "Have you considered the retry bound?");
    const ref = entry.refs[0]!;
    assert.equal(ref.kind, "external-comment");
    const v = ref.value as Record<string, unknown>;
    assert.equal(v["provider"], "github");
    assert.equal(v["remoteId"], "c-9921");
    assert.equal(v["remoteAuthor"], "external-reviewer");
    assert.equal(v["remoteTimestamp"], 1_784_000_000_000);
    assert.equal(v["untrusted"], true, "trust boundary is explicit on the ref");

    const events = s.svc.listEvents(issue.id);
    const received = events.filter((e) => e.type === "external.comment_received");
    assert.equal(received.length, 1);
    assert.equal((received[0]!.payload as Record<string, unknown>)["untrusted"], true);

    const after = s.svc.getIssue(issue.id);
    assert.equal(after.currentRevision, before.currentRevision, "revision not bumped");
    assert.equal(revision, before.currentRevision);
    assert.equal(after.currentContractHash, beforeHash, "contract unchanged");
    assert.deepEqual(
      s.svc.getRevision(issue.id, after.currentRevision).contract,
      s.svc.getRevision(issue.id, before.currentRevision).contract,
    );
  });

  it("rejects comment payloads missing the trust-boundary fields before any mutation", () => {
    const { issue } = readyIssue(s.svc, "commented2");
    const ix = new IntegrationService(s.db, s.svc);
    const journal = new JournalService(s.db, s.svc);
    const beforeCount = journal.listEntries(issue.id).length;
    assert.throws(() => ix.receiveComment(issue.id, "github", {
      remoteScope: "s", remoteId: "1", body: "no author, no timestamp",
    }), /invalid external comment/);
    assert.throws(() => ix.receiveComment(issue.id, "github", {
      remoteScope: "s", remoteId: "1", remoteAuthor: "x", remoteTimestamp: 5, body: "  ",
    }), /invalid external comment/);
    assert.equal(journal.listEntries(issue.id).length, beforeCount, "rejected comment mutates nothing");
  });
});
