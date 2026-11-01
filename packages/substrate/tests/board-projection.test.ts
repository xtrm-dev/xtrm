// Board projection correctness gates (XTRM-393).
//
// Three properties, in order of importance:
//   1. Equivalence: the batched projection must return exactly what the
//      per-issue path returns for the same issue. Only the loading changed, so
//      any divergence is a defect, not a tuning difference.
//   2. Query count: the cost of a page must not grow with the project size.
//      Proven by counting statements at two sizes, never by wall clock.
//   3. Latency budget on a synthetic project, with the statement count held to
//      the same bound at every size.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import type { DatabaseSync } from "../src/store/database.ts";
import { TERMINAL_LIFECYCLE, registerScrutinyPolicy } from "../src/domain/readiness.ts";
import { BOARD_ROW_FIELDS, DEFAULT_PAGE_LIMIT, type IssueBoardRow } from "../src/domain/board.ts";
import { contract } from "./helpers.ts";

// -- harness ----------------------------------------------------------------

/** Counts statements executed through the service. `prepare` is the statement
 * boundary: every read in IssueService prepares inline and immediately runs. */
function countingDb(db: DatabaseSync): { db: DatabaseSync; statements: () => number; reset: () => void } {
  let count = 0;
  const proxy = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "prepare") {
        return (sql: string) => {
          count += 1;
          return target.prepare(sql);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as DatabaseSync;
  return { db: proxy, statements: () => count, reset: () => (count = 0) };
}

function tempService(): { db: DatabaseSync; svc: IssueService; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "sb-board-"));
  const db = openSubstrate(join(dir, "state.db"));
  return { db, svc: new IssueService(db), dir };
}

interface SeedOptions {
  projectId: string;
  prefix: string;
  count: number;
  /** Every nth issue gets a current attestation, so readiness varies. */
  readyEvery?: number;
  /** Every nth issue (after the first) becomes a child of the previous one. */
  parentEvery?: number;
  now?: number;
}

/** Bulk seed: a read-model benchmark must not spend its time in createIssue. */
function seed(db: DatabaseSync, opts: SeedOptions): void {
  const now = opts.now ?? 1_700_000_000_000;
  const body = JSON.stringify(contract());
  db.prepare("INSERT INTO projects (id, prefix, name, created_at) VALUES (?, ?, ?, ?)").run(
    opts.projectId,
    opts.prefix,
    "bench",
    now,
  );
  const insertIssue = db.prepare(
    `INSERT INTO issues (id, project_id, human_number, kind, title, lifecycle_state, priority, scrutiny,
                         current_revision, current_contract_hash, defer_until, created_at, updated_at)
     VALUES (?, ?, ?, 'task', ?, 'open', 0, 'MEDIUM', 1, 'hash', NULL, ?, ?)`,
  );
  const insertRev = db.prepare(
    `INSERT INTO issue_revisions (issue_id, revision, contract_hash, contract_json, context_refs_json,
                                  ownership_json, authored_by, source_json, created_at)
     VALUES (?, 1, 'hash', ?, '[]', NULL, 'seed', NULL, ?)`,
  );
  const insertAttest = db.prepare(
    `INSERT INTO readiness_attestations (issue_id, issue_revision, contract_hash, outcome, policy, attested_by,
                                         evidence_refs_json, blocking_gaps_json, created_at)
     VALUES (?, 1, 'hash', 'ready', 'default', 'seed', '[]', '[]', ?)`,
  );
  const insertEdge = db.prepare(
    `INSERT INTO issue_edges (from_issue, to_issue, kind, child_slot, active, created_at) VALUES (?, ?, 'parent_child', ?, 1, ?)`,
  );

  db.exec("BEGIN IMMEDIATE");
  try {
    for (let i = 1; i <= opts.count; i += 1) {
      const id = `${opts.projectId}-${i}`;
      insertIssue.run(id, opts.projectId, i, `issue ${i}`, now, now);
      insertRev.run(id, body, now);
      if (opts.readyEvery && i % opts.readyEvery === 0) insertAttest.run(id, now);
      if (opts.parentEvery && i > 1 && i % opts.parentEvery === 0) {
        insertEdge.run(`${opts.projectId}-${i - 1}`, id, 0, now);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** A small project built through the real API, so the equivalence check runs
 * against issues that actually carry revisions, attestations, edges, claims
 * and lifecycle transitions rather than seeded rows. */
function variedProject(svc: IssueService, db: DatabaseSync): string {
  const projectId = svc.createProject({ id: "prj_var", prefix: "VAR", name: "varied" }).id;
  const root = svc.createIssue({ projectId, title: "root", kind: "epic", contract: contract(), scrutiny: "MEDIUM" });
  const ready = svc.createIssue({ projectId, title: "ready", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  svc.attestReadiness(ready.id, { outcome: "ready", policy: "default", attestedBy: "t" });
  const draft = svc.createIssue({ projectId, title: "draft", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  const rejected = svc.createIssue({ projectId, title: "rejected", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  svc.attestReadiness(rejected.id, { outcome: "reject", policy: "default", attestedBy: "t" });
  const blocked = svc.createIssue({ projectId, title: "blocked", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  svc.attestReadiness(blocked.id, { outcome: "ready", policy: "default", attestedBy: "t" });
  svc.addEdge(blocked.id, ready.id, "blocks");
  // Two unsatisfied blockers on one issue. With a single blocker, blocker
  // ORDER is unobservable, so a mis-sorted batch loader would pass silently.
  const multiBlocked = svc.createIssue({ projectId, title: "multi-blocked", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  svc.attestReadiness(multiBlocked.id, { outcome: "ready", policy: "default", attestedBy: "t" });
  const blockerOne = svc.createIssue({ projectId, title: "blocker one", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  const blockerTwo = svc.createIssue({ projectId, title: "blocker two", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  svc.addEdge(blockerOne.id, multiBlocked.id, "blocks");
  svc.addEdge(blockerTwo.id, multiBlocked.id, "blocks");
  const blockedByCancelled = svc.createIssue({ projectId, title: "blocked-by-cancelled", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  svc.attestReadiness(blockedByCancelled.id, { outcome: "ready", policy: "default", attestedBy: "t" });
  const cancelled = svc.createIssue({ projectId, title: "cancelled blocker", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  svc.setLifecycleState(cancelled.id, "cancelled");
  svc.addEdge(cancelled.id, blockedByCancelled.id, "blocks");
  const claimed = svc.createIssue({ projectId, title: "claimed", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  svc.attestReadiness(claimed.id, { outcome: "ready", policy: "default", attestedBy: "t" });
  svc.claimIssue(claimed.id, "worker", { ttlMs: 60_000 });
  const deferred = svc.createIssue({ projectId, title: "deferred", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  svc.attestReadiness(deferred.id, { outcome: "ready", policy: "default", attestedBy: "t" });
  svc.setDeferral(deferred.id, Date.now() + 3_600_000);
  const doneChild = svc.createIssue({ projectId, title: "child done", kind: "task", contract: contract(), scrutiny: "MEDIUM", parentId: root.id });
  svc.setLifecycleState(doneChild.id, "done");
  const openChild = svc.createIssue({ projectId, title: "child open", kind: "task", contract: contract(), scrutiny: "MEDIUM", parentId: root.id });
  // A cancelled child: terminal for the board's children counter, but NOT a
  // satisfied blocker. Only this state separates the two rules.
  const cancelledChild = svc.createIssue({ projectId, title: "child cancelled", kind: "task", contract: contract(), scrutiny: "MEDIUM", parentId: root.id });
  svc.setLifecycleState(cancelledChild.id, "cancelled");
  svc.createIssue({ projectId, title: "grandchild", kind: "task", contract: contract(), scrutiny: "MEDIUM", parentId: doneChild.id });
  // Nested under the SECOND root child, so the slot path has distinct values
  // (root.slot1.slot0). With equal slots a reversed join order is invisible,
  // which is exactly the bug this fixture must be able to catch.
  const deep = svc.createIssue({ projectId, title: "deep grandchild", kind: "task", contract: contract(), scrutiny: "MEDIUM", parentId: openChild.id });
  assert.match(svc.currentLocator(deep.id), /\.\d+\.\d+$/, "fixture must exercise a distinct multi-slot locator");
  // A contract edit that invalidates an attestation, so a stale attestation is
  // present in the fixture rather than only a missing one.
  svc.updateContract(draft.id, contract({ problem: "edited after attestation" }), "t", { expectedRevision: 1 });
  const stale = svc.createIssue({ projectId, title: "stale attestation", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  svc.attestReadiness(stale.id, { outcome: "ready", policy: "default", attestedBy: "t" });
  svc.updateContract(stale.id, contract({ problem: "moved on after attestation" }), "t", { expectedRevision: 1 });
  // An unclosed but EXPIRED claim: unclosedClaim sees it, openClaim must not.
  // The batched loader takes the same latest-row-then-liveness path, so this is
  // the case where a shortcut would silently report a dead claim as live.
  const expired = svc.createIssue({ projectId, title: "expired claim", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
  svc.attestReadiness(expired.id, { outcome: "ready", policy: "default", attestedBy: "t" });
  const nowMs = Date.now();
  db.prepare(
    `INSERT INTO issue_claims (issue_id, issue_revision, contract_hash, holder, activation_id,
                               acquired_at, expires_at, released_at, generation)
     VALUES (?, 1, ?, 'expired-worker', NULL, ?, ?, NULL, 1)`,
  ).run(expired.id, svc.getIssue(expired.id).currentContractHash, nowMs - 60_000, nowMs - 30_000);
  return projectId;
}

function byId(rows: IssueBoardRow[]): Map<string, IssueBoardRow> {
  return new Map(rows.map((r) => [r.id, r]));
}

// -- 1. equivalence ---------------------------------------------------------

describe("queryIssues equivalence with the per-issue path", () => {
  it("returns the same readiness, dispatchability, blockers, locator and claim state as getReadiness", () => {
    const { db, svc } = tempService();
    const projectId = variedProject(svc, db);
    const ids = svc.listIssues(projectId).map((i) => i.id);
    const page = svc.queryIssues({ project: projectId, limit: 500 });
    assert.equal(page.rows.length, ids.length, "every issue is on the page");
    assert.equal(page.hasMore, false);

    const seen = byId(page.rows);
    for (const id of ids) {
      const row = seen.get(id);
      assert.ok(row, `row missing for ${id}`);
      const report = svc.getReadiness(id);
      const issue = svc.getIssue(id);
      assert.equal(row.readinessState, report.state, `readinessState for ${issue.title}`);
      assert.equal(row.dispatchable, report.dispatchable, `dispatchable for ${issue.title}`);
      assert.deepEqual(
        row.blockedBy,
        report.unsatisfiedBlockers.map((b) => svc.getIssue(b).humanRef),
        `blockedBy order and refs for ${issue.title}`,
      );
      assert.equal(row.humanRef, issue.humanRef, `humanRef for ${issue.title}`);
      assert.equal(row.locator, svc.currentLocator(id), `locator for ${issue.title}`);
      assert.equal(row.revision, issue.currentRevision);
      assert.equal(row.lifecycleState, issue.lifecycleState);
      assert.equal(row.title, issue.title);
      assert.equal(row.updatedAt, issue.updatedAt);
      const parent = svc.getParent(id);
      assert.equal(row.parentRef, parent ? parent.humanRef : null, `parentRef for ${issue.title}`);
      assert.equal(row.parentLocator, parent ? svc.currentLocator(parent.id) : null, `parentLocator for ${issue.title}`);
      const children = svc.listChildren(id);
      assert.equal(row.childCount, children.length, `childCount for ${issue.title}`);
      assert.equal(
        row.childrenTerminal,
        children.filter((c) => (TERMINAL_LIFECYCLE as readonly string[]).includes(c.lifecycleState)).length,
        `childrenTerminal for ${issue.title}`,
      );
      assert.equal(row.claimState, svc.getActiveClaim(id) ? "claimed" : "none", `claimState for ${issue.title}`);
    }
    db.close();
  });

  it("keeps the derived state varied, so the comparison is not vacuous", () => {
    const { db, svc } = tempService();
    const projectId = variedProject(svc, db);
    const states = new Set(svc.queryIssues({ project: projectId, limit: 500 }).rows.map((r) => r.readinessState));
    for (const expected of ["ready", "draft", "blocked", "claimed", "deferred", "terminal"]) {
      assert.ok(states.has(expected as never), `fixture is missing a ${expected} issue; got ${[...states].join(", ")}`);
    }
    db.close();
  });

  it("locates a nested issue through distinct slots, not just equal ones", () => {
    const { db, svc } = tempService();
    const projectId = variedProject(svc, db);
    const deep = svc.queryIssues({ project: projectId, limit: 500 }).rows.find((r) => r.title === "deep grandchild");
    assert.ok(deep);
    assert.equal(deep.locator, svc.currentLocator(deep.id));
    const slots = deep.locator.split(".").slice(1);
    assert.equal(slots.length, 2, `expected two slots, got ${deep.locator}`);
    assert.notDeepEqual(slots[0], slots[1], "both slots are equal, so join order is untested");
    db.close();
  });

  it("counts a cancelled child as terminal while still counting it as an unsatisfied blocker", () => {
    const { db, svc } = tempService();
    const projectId = variedProject(svc, db);
    const root = svc
      .queryIssues({ project: projectId, limit: 500 })
      .rows.find((r) => r.title === "root");
    assert.ok(root);
    assert.equal(root.childCount, 3, "root children: done, open, cancelled");
    assert.equal(root.childrenTerminal, 2, "done + cancelled are terminal for the counter");
    const cancelled = svc.queryIssues({ project: projectId, limit: 500 }).rows.find((r) => r.title === "child cancelled");
    assert.ok(cancelled);
    assert.equal(cancelled.lifecycleState, "cancelled");
    db.close();
  });

  it("treats a cancelled blocker as still unsatisfied, matching readiness", () => {
    const { db, svc } = tempService();
    const projectId = variedProject(svc, db);
    const row = svc
      .queryIssues({ project: projectId, limit: 500 })
      .rows.find((r) => r.title === "blocked-by-cancelled");
    assert.ok(row);
    assert.equal(row.readinessState, "blocked");
    assert.equal(row.blockedBy.length, 1, "the cancelled prerequisite is still reported as blocking");
    db.close();
  });
});

// -- 2. query count ---------------------------------------------------------

describe("queryIssues query count", () => {
  const BOUND = 16;

  for (const size of [200, 2_000]) {
    it(`costs a bounded number of statements at ${size} issues`, () => {
      const { db, svc } = tempService();
      seed(db, { projectId: "prj_count", prefix: "CNT", count: size, readyEvery: 7, parentEvery: 5 });
      const counter = countingDb(db);
      const counted = new IssueService(counter.db);
      counter.reset();
      const page = counted.queryIssues({ project: "prj_count", limit: DEFAULT_PAGE_LIMIT });
      const used = counter.statements();
      assert.equal(page.rows.length, DEFAULT_PAGE_LIMIT);
      // Exactly 200 issues at limit 200 means the data ends at the page edge:
      // hasMore must be false there, not "the page filled". This assertion
      // used to say `true`, which encoded the phantom-cursor defect XTRM-540
      // reported; the lookahead row fixed it.
      assert.equal(page.hasMore, size > DEFAULT_PAGE_LIMIT);
      assert.equal(page.nextCursor !== null, size > DEFAULT_PAGE_LIMIT);
      assert.ok(used <= BOUND, `page cost ${used} statements, expected <= ${BOUND}`);
      // The page must not read the whole project to fill itself: at most the
      // page plus the single lookahead row, and no lookahead when data ends.
      assert.equal(page.scanned, Math.min(size, DEFAULT_PAGE_LIMIT + 1), "page (+ lookahead), no wider hydration");
      db.close();
    });
  }

  it("does not grow the page cost when the project grows tenfold", () => {
    const costs: number[] = [];
    for (const size of [200, 2_000]) {
      const { db, svc } = tempService();
      seed(db, { projectId: "prj_scale", prefix: "SCL", count: size, readyEvery: 7, parentEvery: 5 });
      const counter = countingDb(db);
      const counted = new IssueService(counter.db);
      counter.reset();
      counted.queryIssues({ project: "prj_scale", limit: DEFAULT_PAGE_LIMIT });
      costs.push(counter.statements());
      db.close();
    }
    assert.deepEqual(costs[1], costs[0], `statement count changed with project size: ${costs.join(" vs ")}`);
  });
});

// -- 3. latency budget ------------------------------------------------------

describe("queryIssues latency budget", () => {
  const ISSUES = Number(process.env["XTRM_BOARD_BENCH_ISSUES"] ?? 20_000);

  it(`serves the first row and the first page inside budget on ${ISSUES} issues`, () => {
    const { db } = tempService();
    const seedStart = performance.now();
    seed(db, { projectId: "prj_bench", prefix: "BNC", count: ISSUES, readyEvery: 11, parentEvery: 4 });
    const seedMs = performance.now() - seedStart;

    const counter = countingDb(db);
    const svc = new IssueService(counter.db);

    counter.reset();
    const firstStart = performance.now();
    const first = svc.queryIssues({ project: "prj_bench", limit: 1 });
    const firstMs = performance.now() - firstStart;
    const firstStatements = counter.statements();

    counter.reset();
    const pageStart = performance.now();
    const page = svc.queryIssues({ project: "prj_bench", limit: DEFAULT_PAGE_LIMIT });
    const pageMs = performance.now() - pageStart;
    const pageStatements = counter.statements();

    assert.equal(first.rows.length, 1);
    assert.equal(page.rows.length, DEFAULT_PAGE_LIMIT);
    // Report the measurement even when it passes: the PR body quotes these.
    console.log(
      JSON.stringify({
        issues: ISSUES,
        seedMs: Math.round(seedMs),
        firstRowMs: Math.round(firstMs * 100) / 100,
        firstPageMs: Math.round(pageMs * 100) / 100,
        firstRowStatements: firstStatements,
        firstPageStatements: pageStatements,
      }),
    );
    assert.ok(firstMs < 150, `first useful row took ${firstMs.toFixed(1)} ms, budget 150 ms`);
    assert.ok(pageMs < 300, `first page took ${pageMs.toFixed(1)} ms, budget 300 ms`);
    assert.ok(firstStatements <= 16, `first row cost ${firstStatements} statements`);
    assert.ok(pageStatements <= 16, `first page cost ${pageStatements} statements`);
    db.close();
  });
});

// -- 4. consumed surfaces (XTRM-393 W1) --------------------------------------
// The CLI list/ready verbs, the MCP list/ready tools and the Pi search now
// read through the projection. These gates prove the consumed surfaces stay
// byte-identical to the per-issue path AND bounded in statement cost: the
// shape assertions compare against the old loading directly, the counting
// proxy proves cost independence from N.

describe("consumed surfaces read through the projection", () => {
  it("sb issue query --limit 2 pages every issue exactly once", () => {
    const { db, svc } = tempService();
    const projectId = variedProject(svc, db);
    const expected = new Set(svc.listIssues(projectId).map((i) => i.id));
    const first = svc.queryIssues({ project: projectId, limit: 2 });
    assert.equal(first.rows.length, 2);
    assert.ok(first.nextCursor !== null, "a partial page must hand back a resumable cursor");
    const seen: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page = svc.queryIssues({ project: projectId, limit: 2, cursor });
      seen.push(...page.rows.map((r) => r.id));
      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
    }
    assert.deepEqual(new Set(seen), expected, "cursor walk visits every issue");
    assert.equal(seen.length, expected.size, "cursor walk visits no issue twice");
    db.close();
  });

  it("sb issue ready selects exactly the dispatchable set, bounded in statements", () => {
    // The consumed `ready` surface is readiness: ["ready"] over the
    // projection; the old surface was listIssues + getReadiness per issue.
    // First leg: the selections agree exactly on the varied fixture.
    {
      const { db, svc } = tempService();
      const projectId = variedProject(svc, db);
      const rows = svc.queryAllIssues({ project: projectId, readiness: ["ready"] });
      const expected = svc.listIssues(projectId).filter((i) => svc.getReadiness(i.id).dispatchable);
      assert.deepEqual(
        rows.map((r) => r.id).sort(),
        expected.map((i) => i.id).sort(),
        "readiness filter selects exactly the getReadiness dispatchable set",
      );
      for (const r of rows) assert.equal(r.readinessState, "ready");
      db.close();
    }
    // Second leg: statement cost is independent of N per page. The gate
    // uses the UNFILTERED page the projection bounds directly (one page =
    // a bounded statement count at any project size): the consumed `ready`
    // surface walks those pages, so its per-page cost inherits the bound.
    // A readiness-filtered first page legitimately scans more chunks when
    // the project doubles, which is why the gate pins the unfiltered page
    // the walk is built from.
    const costs: number[] = [];
    for (const count of [500, 1_000]) {
      const { db } = tempService();
      seed(db, { projectId: "prj_ready", prefix: "RDY", count, readyEvery: 7, parentEvery: 5 });
      const counter = countingDb(db);
      const counted = new IssueService(counter.db);
      counter.reset();
      const page = counted.queryIssues({ project: "prj_ready", limit: 200 });
      assert.equal(page.rows.length, 200);
      costs.push(counter.statements());
      db.close();
    }
    assert.deepEqual(costs[1], costs[0], `page cost grew with N: ${costs.join(" vs ")}`);
    assert.ok(costs[0]! <= 16, `page cost ${costs[0]} statements, expected <= 16`);
  });

  it("a full readiness-filtered walk costs pages, not per-issue statements", () => {
    // SUCCESS.6: `sb issue ready` must stop scaling with N. A derived predicate
    // has to derive every candidate, but that is CPU, not statements, so the
    // walk costs a small constant per 500-row chunk. The old path was 1 + N
    // statements (listIssues then getReadiness per issue).
    const { db } = tempService();
    seed(db, { projectId: "prj_walk", prefix: "WLK", count: 1_000, readyEvery: 7 });
    const counter = countingDb(db);
    const counted = new IssueService(counter.db);
    counter.reset();
    const rows = counted.queryAllIssues({ project: "prj_walk", readiness: ["ready"] });
    const used = counter.statements();
    assert.ok(rows.length > 0, "fixture must produce ready rows");
    for (const row of rows) assert.equal(row.readinessState, "ready");
    assert.ok(used < 60, `filtered walk cost ${used} statements for 1000 issues (per-issue would be ~1000)`);
    db.close();
  });

  it("sb issue list shape matches the per-issue summaries key for key", () => {
    const { db, svc } = tempService();
    const projectId = variedProject(svc, db);
    const rows = svc.queryAllIssues({ project: projectId });
    const issues = svc.listIssues(projectId);
    assert.equal(rows.length, issues.length, "the exhaustive walk returns every issue");
    const byId = new Map(issues.map((i) => [i.id, i]));
    for (const r of rows) {
      const i = byId.get(r.id)!;
      assert.ok(i, `row without issue: ${r.id}`);
      // The 7 list keys, same order issueSummary emits them.
      assert.deepEqual(
        [r.id, r.locator, r.humanRef, r.title, r.kind, r.lifecycleState, r.revision],
        [i.id, i.locator, i.humanRef, i.title, i.kind, i.lifecycleState, i.currentRevision],
      );
    }
    db.close();
  });
});

// -- payload shape ----------------------------------------------------------

describe("board row payload", () => {
  it("returns exactly the board fields and nothing else", () => {
    const { db, svc } = tempService();
    const projectId = variedProject(svc, db);
    const row = svc.queryIssues({ project: projectId, limit: 1 }).rows[0]!;
    assert.deepEqual(Object.keys(row).sort(), [...BOARD_ROW_FIELDS].sort());
    const serialized = JSON.stringify(row);
    for (const forbidden of ["contract", "problem", "success", "nonGoals", "validation", "reasons", "attestedBy"]) {
      assert.ok(!serialized.includes(forbidden), `row leaked ${forbidden}`);
    }
    assert.equal(row.claimState, "none");
    db.close();
  });
});

describe("board row attestation state", () => {
  it("reports none, rejected, current and stale against the current revision", () => {
    const { db, svc } = tempService();
    const projectId = svc.createProject({ id: "prj_att", prefix: "ATT", name: "attested" }).id;
    const issue = svc.createIssue({ projectId, title: "t", kind: "task", contract: contract(), scrutiny: "MEDIUM" });
    const row = () => svc.queryIssues({ project: projectId, limit: 1 }).rows[0]!;
    assert.equal(row().attestationState, "none");
    assert.equal(row().structurallyValid, true);
    svc.attestReadiness(issue.id, { outcome: "reject", policy: "default", attestedBy: "t" });
    assert.equal(row().attestationState, "rejected");
    svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "t" });
    assert.equal(row().attestationState, "current");
    svc.updateContract(issue.id, contract({ problem: "changed" }), "t");
    assert.equal(row().attestationState, "stale");
    db.close();
  });
});

describe("board row journal activity", () => {
  it("counts journal entries and refs and moves lastActivityAt, while updatedAt stays put", () => {
    const { svc, db } = tempService();
    const projectId = variedProject(svc, db);
    const before = svc.queryIssues({ project: projectId, limit: 2 }).rows;
    const [target, quiet] = [before[0]!, before[1]!];
    assert.equal(target.journalCount, 0);
    assert.equal(target.pointerCount, 0);
    assert.equal(target.lastActivityAt, target.updatedAt);

    const journal = new JournalService(db, svc);
    journal.appendEntry(target.id, { kind: "note", semantic: { summary: "one" }, refs: [{ kind: "evidence", key: "a", value: "1" }, { kind: "evidence", key: "b", value: "2" }] });
    journal.appendEntry(target.id, { kind: "note", semantic: { summary: "two" } });
    db.prepare("UPDATE issue_journal SET created_at = ? WHERE issue_id = ?").run(target.updatedAt + 5_000, target.id);

    const [row, other] = svc.queryIssues({ project: projectId, limit: 2 }).rows;
    assert.equal(row!.journalCount, 2);
    assert.equal(row!.pointerCount, 2);
    assert.equal(row!.updatedAt, target.updatedAt);
    assert.equal(row!.lastActivityAt, target.updatedAt + 5_000);
    assert.equal(other!.journalCount, quiet.journalCount);
    db.close();
  });
});

// -- review-seeded edge cases ----------------------------------------------
// Named by the XTRM-543 second-opinion review as properties its own reading
// could not settle, and by XTRM-540's gap list.

describe("review-seeded edge cases", () => {
  it("resolves the attestation tie by the highest id on both paths", () => {
    // getReadiness reads ORDER BY id DESC LIMIT 1; the loader reads MAX(id).
    // A "latest READY attestation" shortcut answers `ready` here and diverges.
    const { db, svc } = tempService();
    const project = svc.createProject({ id: "prj_tie", prefix: "TIE", name: "tie" }).id;
    const rejectedLast = svc.createIssue({ projectId: project, title: "rejected last", kind: "task", contract: contract(), scrutiny: "LOW" });
    svc.attestReadiness(rejectedLast.id, { outcome: "ready", policy: "default", attestedBy: "t" });
    svc.attestReadiness(rejectedLast.id, { outcome: "reject", policy: "default", attestedBy: "t" });
    const readyLast = svc.createIssue({ projectId: project, title: "ready last", kind: "task", contract: contract(), scrutiny: "LOW" });
    svc.attestReadiness(readyLast.id, { outcome: "reject", policy: "default", attestedBy: "t" });
    svc.attestReadiness(readyLast.id, { outcome: "ready", policy: "default", attestedBy: "t" });

    const rows = byId(svc.queryIssues({ project, limit: 50 }).rows);
    const first = svc.getReadiness(rejectedLast.id);
    const second = svc.getReadiness(readyLast.id);
    assert.equal(first.state, "draft", "the newest attestation rejects");
    assert.equal(second.state, "ready", "the newest attestation authorizes");
    assert.equal(rows.get(rejectedLast.id)!.readinessState, first.state);
    assert.equal(rows.get(readyLast.id)!.readinessState, second.state);
    db.close();
  });

  it("keeps a dangling blocker edge impossible, which is why the loader LEFT JOINs", () => {
    // The defensive LEFT JOIN in batchBlockers cannot be exercised by data:
    // the store turns foreign keys on, so a blocker that does not exist is
    // refused at write time. Pinning the invariant is the honest version of
    // an "untested" case.
    const { db, svc } = tempService();
    const project = svc.createProject({ id: "prj_fk", prefix: "FK", name: "fk" }).id;
    const target = svc.createIssue({ projectId: project, title: "target", kind: "task", contract: contract(), scrutiny: "LOW" });
    const pragma = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    assert.equal(pragma.foreign_keys, 1, "the store opens with foreign keys enforced");
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO issue_edges (from_issue, to_issue, kind, child_slot, active, created_at)
             VALUES ('iss_does_not_exist', ?, 'blocks', NULL, 1, 1)`,
          )
          .run(target.id),
      /FOREIGN KEY/i,
      "a dangling blocker edge is refused by the database",
    );
    assert.deepEqual(svc.queryIssues({ project, limit: 10 }).rows[0]!.blockedBy, []);
    db.close();
  });

  it("applies the scrutiny policy to the batched path too", () => {
    const { db, svc } = tempService();
    registerScrutinyPolicy({ ref: "xtrm393-only-high", allow: (level) => level === "HIGH" });
    const project = svc.createProject({ id: "prj_pol", prefix: "POL", name: "pol" }).id;
    const issue = svc.createIssue({ projectId: project, title: "low scrutiny", kind: "task", contract: contract(), scrutiny: "LOW" });
    svc.attestReadiness(issue.id, { outcome: "ready", policy: "xtrm393-only-high", attestedBy: "t" });
    const report = svc.getReadiness(issue.id);
    const row = svc.queryIssues({ project, limit: 10 }).rows.find((r) => r.id === issue.id)!;
    assert.equal(report.state, "draft", "the policy denies LOW scrutiny");
    assert.equal(row.readinessState, report.state, "the batched path rechecks the policy too");
    assert.equal(row.dispatchable, false);
    db.close();
  });
});
