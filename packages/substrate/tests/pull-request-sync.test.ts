// Reconciler, slice 3 (XTRM-728): state upsert, conditional reads, trailer-first
// links, weak mentions, landed_sha, backfill and failure findings.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { contract, setup } from "./helpers.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { PullRequestService } from "../src/service/pull-request-service.ts";
import { GhCliPullRequestSource, PullRequestSyncService } from "../src/service/pull-request-sync-service.ts";
import type {
  PullRequestCommit,
  PullRequestObservation,
  PullRequestSource,
} from "../src/domain/pull-request-state.ts";

class FakeSource implements PullRequestSource {
  listCalls = 0;
  getCalls = 0;
  entries = new Map<string, { observation: PullRequestObservation; commits: PullRequestCommit[]; notModified?: boolean; fail?: boolean; commitsFail?: number }>();
  key(repository: string, number: number): string {
    return `${repository}#${number}`;
  }
  put(observation: PullRequestObservation, commits: PullRequestCommit[] = []): void {
    this.entries.set(this.key(observation.repository, observation.number), { observation, commits });
  }
  list(repository: string, _opts: { limit: number }): Array<{ number: number; updatedAt: string | null }> {
    this.listCalls += 1;
    return [...this.entries.values()]
      .filter((e) => e.observation.repository === repository)
      .map((e) => ({ number: e.observation.number, updatedAt: e.observation.updatedAt }));
  }
  get(repository: string, number: number): PullRequestObservation | "not-modified" {
    this.getCalls += 1;
    const entry = this.entries.get(this.key(repository, number));
    if (!entry) throw new Error("not found");
    if (entry.fail) throw new Error("gh failed");
    if (entry.notModified) return "not-modified";
    return entry.observation;
  }
  commits(repository: string, number: number): PullRequestCommit[] {
    const entry = this.entries.get(this.key(repository, number));
    if (entry && entry.commitsFail !== undefined && entry.commitsFail > 0) {
      entry.commitsFail -= 1;
      throw new Error("commits read failed");
    }
    return entry?.commits ?? [];
  }
}

function observation(overrides: Partial<PullRequestObservation> = {}): PullRequestObservation {
  return {
    repository: "o/r",
    number: 7,
    state: "open",
    draft: false,
    headSha: "a".repeat(40),
    headRef: "xt/xtrm-1",
    baseRef: "main",
    mergeCommitSha: null,
    title: "work",
    url: "https://github.com/o/r/pull/7",
    body: null,
    mergedAt: null,
    closedAt: null,
    etag: '"e1"',
    lastModified: "Wed, 11 Nov 2026 01:00:00 GMT",
    updatedAt: "2026-11-11T01:00:00Z",
    ...overrides,
  } as PullRequestObservation;
}

function world() {
  const ctx = setup();
  const issue = ctx.svc.createIssue({ projectId: "prj_xtrm", title: "work", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  ctx.svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  const journal = new JournalService(ctx.db, ctx.svc);
  const prov = new ProvenanceService(ctx.db, ctx.svc, journal);
  const links = new PullRequestService(ctx.db, ctx.svc, prov);
  const source = new FakeSource();
  const sync = new PullRequestSyncService(ctx.db, ctx.svc, links, source);
  return { ...ctx, issue, prov, links, source, sync };
}

function receiptFor(w: ReturnType<typeof world>, holder = "w") {
  const claim = w.svc.claimIssue(w.issue.id, holder, { ttlMs: 60_000 });
  const binding = w.prov.dispatch(w.issue.id, { workspace: "/tmp/ws", participantId: holder, claimId: claim.id });
  return w.prov.allocateReceipt(binding.id);
}

function run(w: ReturnType<typeof world>, extra: Partial<Parameters<PullRequestSyncService["sync"]>[0]> = {}) {
  return w.sync.sync({ projectId: "prj_xtrm", repositories: ["o/r"], actor: "w", ...extra });
}

describe("pull-request reconciler", () => {
  let w: ReturnType<typeof world>;
  beforeEach(() => {
    w = world();
  });
  afterEach(() => {
    w.db.close();
    rmSync(w.dir, { recursive: true, force: true });
  });

  it("a single PR sync upserts pull_requests state (PR-open path)", () => {
    const receipt = receiptFor(w);
    const message = `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}`;
    w.source.put(observation(), [{ sha: "b".repeat(40), message }]);
    const report = w.sync.sync({ projectId: "prj_xtrm", repositories: ["o/r"], actor: "w", onlyPr: { repository: "o/r", number: 7 } });
    assert.equal(report.failures, 0);
    const row = w.db.prepare("SELECT state FROM pull_requests WHERE repository = ? AND number = ?").get("o/r", 7) as { state: string } | undefined;
    assert.ok(row, "pull_requests row missing");
    assert.equal(row.state, "open");
  });

  it("migration 015 stores live state with the conditional cache", () => {
    const cols = w.db.prepare("PRAGMA table_info(pull_requests)").all() as Array<{ name: string }>;
    for (const name of ["state", "draft", "head_sha", "merge_commit_sha", "title", "url", "base_ref", "merged_at", "closed_at", "etag", "last_modified", "last_synced_at"]) {
      assert.ok(cols.some((c) => c.name === name), name);
    }
  });

  it("upserts state, writes created_from from a trailer, and lands the merge SHA", () => {
    const receipt = receiptFor(w);
    const message = `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}`;
    w.source.put(observation(), [{ sha: "b".repeat(40), message }]);
    const first = run(w);
    assert.deepEqual({ created: first.created, mentioned: first.mentioned }, { created: 1, mentioned: 0 });
    const row = w.db.prepare("SELECT state, etag, last_modified FROM pull_requests").get() as { state: string; etag: string; last_modified: string };
    assert.deepEqual({ ...row }, { state: "open", etag: '"e1"', last_modified: "Wed, 11 Nov 2026 01:00:00 GMT" });
    // The reconciler's row is an OBSERVATION, not the opener's assumption.
    assert.equal((w.db.prepare("SELECT state_source FROM pull_requests").get() as { state_source: string }).state_source, "observed");

    w.source.put(observation({ state: "merged", mergeCommitSha: "c".repeat(40), mergedAt: Date.parse("2026-11-11T02:00:00Z") }), [{ sha: "b".repeat(40), message }]);
    run(w);
    assert.equal((w.db.prepare("SELECT state FROM pull_requests").get() as { state: string }).state, "merged");
    assert.equal((w.db.prepare("SELECT landed_sha FROM issue_pr_commits").get() as { landed_sha: string }).landed_sha, "c".repeat(40));
  });

  it("a 304 writes nothing", () => {
    const receipt = receiptFor(w);
    w.source.put(observation(), [{ sha: "d".repeat(40), message: `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}` }]);
    run(w);
    const before = w.db.prepare("SELECT last_synced_at FROM pull_requests").get() as { last_synced_at: number };
    const events = w.svc.listEvents(w.issue.id).length;
    w.source.entries.get("o/r#7")!.notModified = true;
    const report = run(w);
    assert.equal(report.skipped, 1);
    assert.deepEqual({ ...(w.db.prepare("SELECT last_synced_at FROM pull_requests").get() as object) }, { ...before });
    assert.equal(w.svc.listEvents(w.issue.id).length, events);
  });

  it("title, branch and body become mentions with their source", () => {
    w.source.put(observation({ title: "work XTRM-1", headRef: "xt/XTRM-1", body: "see XTRM-1" }));
    const report = run(w);
    assert.equal(report.mentioned, 3);
    const view = w.links.listForIssue(w.issue.id)[0]!;
    assert.equal(view.relation, "mentioned");
    assert.deepEqual([...view.sources].sort(), ["branch", "prose", "title"]);
    const mentioned = w.svc.listEvents(w.issue.id).filter((e) => e.type === "provenance.link_mentioned");
    assert.equal(mentioned.length, 3);
    assert.ok(mentioned.every((e) => (e.payload as { actor?: string }).actor === "w"));
  });

  it("a foreign trailer becomes a mention plus a finding, not created_from", () => {
    const other = w.svc.createIssue({ projectId: "prj_xtrm", title: "other", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
    w.svc.attestReadiness(other.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
    const claim = w.svc.claimIssue(other.id, "w", { ttlMs: 60_000 });
    const binding = w.prov.dispatch(other.id, { workspace: "/tmp/ws", participantId: "w", claimId: claim.id });
    const foreign = w.prov.allocateReceipt(binding.id);
    w.source.put(observation(), [{ sha: "e".repeat(40), message: `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${foreign.id}` }]);
    run(w);
    const view = w.links.listForIssue(w.issue.id)[0]!;
    assert.equal(view.relation, "mentioned");
    assert.deepEqual(view.sources, ["trailer"]);
    assert.deepEqual(w.links.listFindings("prj_xtrm").map((f) => f.code), ["trailer_receipt_foreign_issue"]);
  });

  it("a rerun is idempotent", () => {
    const receipt = receiptFor(w);
    w.source.put(observation({ title: "work XTRM-1" }), [{ sha: "f".repeat(40), message: `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}` }]);
    run(w);
    const rows = w.db.prepare("SELECT COUNT(*) AS n FROM issue_pull_requests").get() as { n: number };
    const events = w.svc.listEvents(w.issue.id).length;
    run(w);
    assert.deepEqual(w.db.prepare("SELECT COUNT(*) AS n FROM issue_pull_requests").get(), rows);
    assert.equal(w.svc.listEvents(w.issue.id).length, events);
  });

  it("--dry-run writes nothing", () => {
    const receipt = receiptFor(w);
    w.source.put(observation({ title: "work XTRM-1" }), [{ sha: "1".repeat(40), message: `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}` }]);
    const report = run(w, { dryRun: true });
    assert.equal(report.dryRun, true);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM pull_requests").get() as { n: number }).n, 0);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM issue_pull_requests").get() as { n: number }).n, 0);
  });

  it("a per-PR failure records pr_unavailable and the run continues", () => {
    const receipt = receiptFor(w);
    w.source.put(observation(), [{ sha: "2".repeat(40), message: `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}` }]);
    run(w);
    w.source.put(observation({ number: 8 }), []);
    w.source.entries.get("o/r#8")!.fail = true;
    const report = run(w);
    assert.equal(report.failures, 1);
    // #8 has no link yet, so the finding lands where a link exists; #7 still scans.
    assert.equal(report.scanned >= 1, true);
    w.source.entries.get("o/r#7")!.fail = true;
    run(w);
    assert.deepEqual(w.links.listFindings("prj_xtrm").map((f) => f.code), ["pr_unavailable"]);
  });

  it("--since filters old PRs and records mentions as backfill", () => {
    w.source.put(observation({ number: 7, updatedAt: "2025-01-01T00:00:00Z", title: "old XTRM-1" }), []);
    w.source.put(observation({ number: 9, updatedAt: "2026-11-11T01:00:00Z", title: "new XTRM-1" }), []);
    const report = run(w, { since: "2026-01-01T00:00:00Z" });
    assert.equal(report.scanned, 1);
    const view = w.links.listForIssue(w.issue.id)[0]!;
    assert.deepEqual(view.sources, ["backfill"]);
  });

  it("a 250-commit PR records pr_commits_truncated on the linked issue", () => {
    const receipt = receiptFor(w);
    w.source.put(observation(), [{ sha: "3".repeat(40), message: `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}` }]);
    run(w);
    const many = Array.from({ length: 250 }, (_, i) => ({ sha: i.toString(16).padStart(40, "0"), message: "chore" }));
    w.source.put(observation(), many);
    const report = run(w);
    assert.equal(report.truncated, 1);
    assert.ok(w.links.listFindings("prj_xtrm").some((f) => f.code === "pr_commits_truncated"));
  });

  it("a commits() failure leaves no etag, and the next run recovers the links", () => {
    const receipt = receiptFor(w);
    w.source.put(observation(), [{ sha: "8".repeat(40), message: `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}` }]);
    w.source.entries.get("o/r#7")!.commitsFail = 1;
    const first = run(w);
    assert.equal(first.failures, 1);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM pull_requests").get() as { n: number }).n, 0);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM issue_pull_requests").get() as { n: number }).n, 0);
    const second = run(w);
    assert.equal(second.created, 1);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM issue_pull_requests").get() as { n: number }).n, 1);
  });

  it("a dry run writes zero events even on failures and on a 250-commit PR", () => {
    const receipt = receiptFor(w);
    w.source.put(observation(), [{ sha: "9".repeat(40), message: `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}` }]);
    run(w);
    const before = w.svc.listEvents(w.issue.id).length;
    w.source.entries.get("o/r#7")!.notModified = false;
    w.source.entries.get("o/r#7")!.fail = true;
    run(w, { dryRun: true });
    assert.equal(w.svc.listEvents(w.issue.id).length, before);
    w.source.entries.get("o/r#7")!.fail = false;
    w.source.put(observation(), Array.from({ length: 250 }, (_, i) => ({ sha: i.toString(16).padStart(40, "0"), message: "chore" })));
    run(w, { dryRun: true });
    assert.equal(w.svc.listEvents(w.issue.id).length, before);
  });

  it("PR-level findings dedupe with a NULL SHA across reruns", () => {
    const receipt = receiptFor(w);
    w.source.put(observation(), [{ sha: "a1".repeat(20), message: `XTRM-Issue: ${w.issue.humanRef}\nXTRM-Receipt: ${receipt.id}` }]);
    run(w);
    w.source.entries.get("o/r#7")!.fail = true;
    run(w);
    run(w);
    const findings = w.links.listFindings("prj_xtrm").filter((f) => f.code === "pr_unavailable");
    assert.equal(findings.length, 1);
  });

  it("the trailer-path mention event carries the actor", () => {
    w.source.put(observation(), [{ sha: "a2".repeat(20), message: `XTRM-Issue: ${w.issue.humanRef}` }]);
    run(w);
    const events = w.svc.listEvents(w.issue.id).filter((e) => e.type === "provenance.link_mentioned");
    assert.equal(events.length, 1);
    assert.equal((events[0]!.payload as { actor?: string }).actor, "w");
  });

  it("report.findings names the PR even when it has no link yet", () => {
    w.source.put(observation({ number: 99 }), []);
    w.source.entries.get("o/r#99")!.fail = true;
    const report = run(w);
    assert.deepEqual(report.findings.map((f) => [f.repository, f.number, f.code]), [["o/r", 99, "pr_unavailable"]]);
    assert.equal(report.findingCount, 1);
  });

  it("a second run does not count already-present mentions", () => {
    w.source.put(observation({ title: "works on XTRM-1" }));
    assert.equal(run(w).mentioned, 1);
    assert.equal(run(w).mentioned, 0);
  });

  it("pages with a constant per_page and returns unique PRs up to --limit", () => {
    const pages = (limit: number) => {
      const source = new GhCliPullRequestSource((args) => {
        const url = new URL(`https://x/${args[1]}`);
        const perPage = Number(url.searchParams.get("per_page"));
        const page = Number(url.searchParams.get("page"));
        const start = (page - 1) * perPage;
        return JSON.stringify(Array.from({ length: perPage }, (_, i) => ({ number: start + i + 1, updated_at: "2026-11-11T00:00:00Z" })));
      });
      return source.list("o/r", { limit });
    };
    for (const limit of [150, 250]) {
      const list = pages(limit);
      assert.equal(list.length, limit);
      assert.equal(new Set(list.map((p) => p.number)).size, limit);
      assert.equal(list[0]!.number, 1);
      assert.equal(list[list.length - 1]!.number, limit);
    }
  });

  it("a linkMention throw rolls that PR back and the others still succeed", () => {
    const receipt = receiptFor(w);
    // Pre-link #7 so the failure has an issue to attach its finding to.
    w.links.linkMention({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w" });
    const rowsBefore = (w.db.prepare("SELECT COUNT(*) AS n FROM issue_pull_requests").get() as { n: number }).n;
    w.source.put(observation({ number: 7, title: "work XTRM-1" }), []);
    w.source.put(observation({ number: 9, title: "work XTRM-1" }), []);
    const original = w.links.linkMention.bind(w.links);
    let calls = 0;
    (w.links as unknown as { linkMention: (input: { number: number }) => unknown }).linkMention = (input) => {
      calls += 1;
      if (input.number === 7) throw new Error("forced mention failure");
      return original(input as never);
    };
    const report = run(w);
    assert.equal(calls >= 1, true);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM pull_requests WHERE number = 7").get() as { n: number }).n, 0);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM pull_requests WHERE number = 9").get() as { n: number }).n, 1);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM issue_pull_requests WHERE number = 7").get() as { n: number }).n, rowsBefore);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM issue_pull_requests WHERE number = 9").get() as { n: number }).n, 1);
    assert.equal(report.failures, 1);
    assert.deepEqual(report.findings.map((f) => [f.number, f.code]), [[7, "pr_link_write_failed"]]);
    assert.deepEqual(w.links.listFindings("prj_xtrm").map((f) => f.code), ["pr_link_write_failed"]);
  });

  it("a dry run still attributes findings in the report", () => {
    w.links.linkMention({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w" });
    w.source.put(observation({ number: 7 }), []);
    w.source.entries.get("o/r#7")!.fail = true;
    const report = run(w, { dryRun: true });
    assert.deepEqual(report.findings.map((f) => [f.repository, f.number, f.code]), [["o/r", 7, "pr_unavailable"]]);
    assert.equal(report.findingCount, 0);
  });

  it("one-shot <pr> does not list the repository", () => {
    w.source.put(observation(), []);
    const report = run(w, { onlyPr: { repository: "o/r", number: 7 } });
    assert.equal(w.source.listCalls, 0);
    assert.equal(report.scanned, 1);
  });
});
