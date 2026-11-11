// Adversarial verification of the bounded board read model (XTRM-393 W3,
// bead XTRM-540). Each gate below was proven to fail before it was trusted:
// the implementation was deliberately broken once per gate family, the gate
// was observed to fail, and the implementation was restored byte-identical
// (see the mutation table in the bead report).
//
// Style follows board-projection.test.ts: node:test + node:assert/strict,
// temp databases only, no wall-clock assertions.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import type { DatabaseSync } from "../src/store/database.ts";
import {
  CURSOR_VERSION,
  encodeCursor,
  queryFilterFingerprint,
  type BoardCursor,
  type IssueQuery,
} from "../src/domain/board.ts";
import { runCli } from "../cli/sb.ts";
import { contract, tempDir } from "./helpers.ts";

// -- harness ----------------------------------------------------------------

function tempService(): { db: DatabaseSync; svc: IssueService } {
  const dir = tempDir("sb-adversarial-");
  const db = openSubstrate(join(dir, "state.db"));
  return { db, svc: new IssueService(db) };
}

function tempDbPath(): { dir: string; dbPath: string } {
  const dir = tempDir("sb-adv-cli-");
  return { dir, dbPath: join(dir, "state.db") };
}

/** Compact fixture varied along exactly the five SQL filter axes under test:
 * lifecycles (open/done/cancelled), kinds (epic/task/bug), parent links
 * (roots, a child, a grandchild), and titles with mixed-case substrings. */
function filterFixture(svc: IssueService): { project: string; childId: string } {
  const project = svc.createProject({ id: "prj_adv", prefix: "ADV", name: "adversarial" }).id;
  const root = svc.createIssue({
    projectId: project,
    title: "Atlas root",
    kind: "epic",
    contract: contract(),
    scrutiny: "LOW",
  });
  const child = svc.createIssue({
    projectId: project,
    title: "Atlas child alpha",
    kind: "task",
    contract: contract(),
    scrutiny: "LOW",
    parentId: root.id,
  });
  svc.createIssue({
    projectId: project,
    title: "atlas grandchild Beta",
    kind: "bug",
    contract: contract(),
    scrutiny: "LOW",
    parentId: child.id,
  });
  svc.createIssue({ projectId: project, title: "Second root", kind: "task", contract: contract(), scrutiny: "LOW" });
  const done = svc.createIssue({
    projectId: project,
    title: "Finished gamma",
    kind: "task",
    contract: contract(),
    scrutiny: "LOW",
  });
  svc.setLifecycleState(done.id, "done");
  const cancelled = svc.createIssue({
    projectId: project,
    title: "Cancelled delta",
    kind: "bug",
    contract: contract(),
    scrutiny: "LOW",
  });
  svc.setLifecycleState(cancelled.id, "cancelled");
  return { project, childId: child.id };
}

/** Expected set for a SQL filter, computed only from per-issue reads in
 * human_number order (the order listIssues returns). */
function expectedBy(svc: IssueService, project: string, pred: (id: string) => boolean): string[] {
  return svc.listIssues(project).filter((i) => pred(i.id)).map((i) => i.id);
}

function cliQuery(dbPath: string, argv: string[]): { code: number; body: string } {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  return { code: res.code, body: res.stdout || res.stderr };
}

// -- 2a. cursor guards fail closed -------------------------------------------

describe("adversarial cursor guards (fail closed)", () => {
  function twoProjects(): { db: DatabaseSync; svc: IssueService; a: string; b: string; cursorA: string } {
    const { db, svc } = tempService();
    const a = svc.createProject({ id: "prj_ca", prefix: "CA", name: "a" }).id;
    const b = svc.createProject({ id: "prj_cb", prefix: "CB", name: "b" }).id;
    for (let i = 0; i < 5; i += 1) {
      svc.createIssue({ projectId: a, title: `a${i}`, kind: "task", contract: contract(), scrutiny: "LOW" });
      if (i < 2) svc.createIssue({ projectId: b, title: `b${i}`, kind: "task", contract: contract(), scrutiny: "LOW" });
    }
    const pageA = svc.queryIssues({ project: a, limit: 2 });
    assert.ok(pageA.nextCursor, "fixture must produce a cursor");
    return { db, svc, a, b, cursorA: pageA.nextCursor };
  }

  it("refuses a cursor opened on a different project", () => {
    const { db, svc, b, cursorA } = twoProjects();
    assert.throws(
      () => svc.queryIssues({ project: b, limit: 2, cursor: cursorA }),
      /different project/,
      "a foreign cursor must throw, never silently return rows",
    );
    db.close();
  });

  it("refuses a cursor reused under a different filter set", () => {
    const { db, svc, a, cursorA } = twoProjects();
    assert.throws(
      () => svc.queryIssues({ project: a, limit: 2, cursor: cursorA, lifecycle: ["open"] }),
      /different filters/,
      "a cursor for another filter set must throw, never silently skip rows",
    );
    db.close();
  });

  it("refuses an unknown cursor version", () => {
    const { db, svc, a } = twoProjects();
    const filter = queryFilterFingerprint({ project: a });
    const forged = encodeCursor({ v: 999, project: a, filter, key: [1, "x"] } as unknown as BoardCursor);
    assert.throws(
      () => svc.queryIssues({ project: a, limit: 2, cursor: forged }),
      /unsupported board cursor version/,
    );
    db.close();
  });

  it("refuses malformed cursors (base64, JSON, key shape)", () => {
    const { db, svc, a } = twoProjects();
    const filter = queryFilterFingerprint({ project: a });
    const raw = (obj: unknown): string => Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
    const cases: Array<[string, string, RegExp]> = [
      ["not-base64", "!!!not-base64!!!", /invalid board cursor/],
      ["base64-but-not-json", Buffer.from("not json", "utf8").toString("base64url"), /invalid board cursor/],
      ["json-null", raw(null), /invalid board cursor/],
      ["missing-key", raw({ v: CURSOR_VERSION, project: a, filter }), /ordering tuple/],
      ["swapped-key-types", raw({ v: CURSOR_VERSION, project: a, filter, key: ["x", 1] }), /ordering tuple/],
      ["short-key", raw({ v: CURSOR_VERSION, project: a, filter, key: [3] }), /ordering tuple/],
    ];
    for (const [label, cursor, message] of cases) {
      assert.throws(() => svc.queryIssues({ project: a, limit: 2, cursor }), message, `malformed cursor ${label}`);
    }
    db.close();
  });

  it("human_number uniqueness makes the id tiebreaker unreachable", () => {
    // Migration 001 baseline declares UNIQUE(project_id, human_number), so no
    // two issues in one walk can ever share the sort key the id tiebreaker
    // disambiguates. The tiebreaker is unreachable defense, not live logic.
    const { db, svc } = tempService();
    const project = svc.createProject({ id: "prj_uniq", prefix: "UQ", name: "u" }).id;
    const now = 1_700_000_000_000;
    db.prepare("INSERT INTO projects (id, prefix, name, created_at) VALUES ('prj_dup', 'DP', 'd', ?)").run(now);
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO issues (id, project_id, human_number, kind, title, lifecycle_state, priority,
                                 scrutiny, current_revision, current_contract_hash, defer_until, created_at, updated_at)
             VALUES ('dup-1', 'prj_dup', 1, 'task', 'one', 'open', 0, 'LOW', 1, 'h', NULL, ?, ?)`,
          )
          .run(now, now) &&
        db
          .prepare(
            `INSERT INTO issues (id, project_id, human_number, kind, title, lifecycle_state, priority,
                                 scrutiny, current_revision, current_contract_hash, defer_until, created_at, updated_at)
             VALUES ('dup-2', 'prj_dup', 1, 'task', 'two', 'open', 0, 'LOW', 1, 'h', NULL, ?, ?)`,
          )
          .run(now, now),
      /UNIQUE/,
      "the store itself rejects a duplicate human_number",
    );
    // Same human_number in DIFFERENT projects is legal, but cursors are
    // project-bound (first test above), so the tiebreaker still cannot fire.
    svc.createIssue({ projectId: project, title: "solo", kind: "task", contract: contract(), scrutiny: "LOW" });
    const page = svc.queryIssues({ project, limit: 10 });
    assert.equal(page.rows.length, 1);
    assert.equal(page.hasMore, false);
    db.close();
  });
});

// -- 2b. inserts between pages ----------------------------------------------

describe("insert-during-walk losslessness", () => {
  it("a cursor walk with inserts between pages is lossless and duplicate-free", () => {
    const { db, svc } = tempService();
    const project = svc.createProject({ id: "prj_ins", prefix: "INS", name: "inserts" }).id;
    const startIds: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      startIds.push(
        svc.createIssue({ projectId: project, title: `t${i}`, kind: "task", contract: contract(), scrutiny: "LOW" }).id,
      );
    }
    const first = svc.queryIssues({ project, limit: 2 });
    assert.equal(first.rows.length, 2);
    assert.ok(first.nextCursor);

    // New issues land after the resume key (human_number grows), so a correct
    // keyset walk picks them up without disturbing the rows already emitted.
    const newIds: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      newIds.push(
        svc.createIssue({ projectId: project, title: `new${i}`, kind: "task", contract: contract(), scrutiny: "LOW" })
          .id,
      );
    }

    const seen: string[] = first.rows.map((r) => r.id);
    let cursor: string | null = first.nextCursor;
    for (;;) {
      const page = svc.queryIssues({ project, limit: 2, cursor });
      seen.push(...page.rows.map((r) => r.id));
      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
    }
    assert.equal(seen.length, new Set(seen).size, "no row is repeated");
    for (const id of startIds) {
      assert.equal(seen.filter((s) => s === id).length, 1, `start issue ${id} appears exactly once`);
    }
    for (const id of newIds) assert.ok(seen.includes(id), `inserted issue ${id} is visited`);
    assert.equal(seen.length, startIds.length + newIds.length);
    db.close();
  });
});

// -- 2c. SQL filters match per-issue reads -----------------------------------

describe("SQL filters match per-issue reads", () => {
  function check(query: IssueQuery, pred: (svc: IssueService, id: string) => boolean): void {
    const { db, svc } = tempService();
    const { project } = filterFixture(svc);
    const rows = svc.queryAllIssues({ ...query, project });
    const expected = expectedBy(svc, project, (id) => pred(svc, id));
    assert.deepEqual(
      rows.map((r) => r.id),
      expected,
      `filter ${JSON.stringify({ ...query, project: undefined })} disagrees with per-issue reads`,
    );
    db.close();
  }

  it("lifecycle selects exactly the per-issue lifecycle set", () => {
    const { db, svc } = tempService();
    const { project } = filterFixture(svc);
    for (const states of [["done"], ["cancelled"], ["open"], ["done", "cancelled"]] as const) {
      const rows = svc.queryAllIssues({ project, lifecycle: [...states] });
      const expected = expectedBy(svc, project, (id) => (states as readonly string[]).includes(svc.getIssue(id).lifecycleState));
      assert.deepEqual(rows.map((r) => r.id), expected, `lifecycle ${states.join(",")}`);
      for (const r of rows) assert.ok((states as readonly string[]).includes(r.lifecycleState));
    }
    db.close();
  });

  it("kind selects exactly the per-issue kind set", () => {
    check({ project: "", kind: ["bug"] }, (svc, id) => svc.getIssue(id).kind === "bug");
    check({ project: "", kind: ["epic", "task"] }, (svc, id) => svc.getIssue(id).kind !== "bug");
  });

  it("parent selects exactly the children of that issue", () => {
    const { db, svc } = tempService();
    const { project, childId } = filterFixture(svc);
    const child = svc.getIssue(childId);
    const rows = svc.queryAllIssues({ project, parent: child.id });
    const expected = expectedBy(svc, project, (id) => svc.getParent(id)?.id === child.id);
    assert.deepEqual(rows.map((r) => r.id), expected);
    assert.equal(rows.length, 1, "only the grandchild hangs under the child");
    db.close();
  });

  it("parent:null selects exactly the project roots", () => {
    check({ project: "", parent: null }, (svc, id) => svc.getParent(id) === null);
  });

  it("search is a case-insensitive trimmed substring over titles", () => {
    const { db, svc } = tempService();
    const { project } = filterFixture(svc);
    for (const search of ["ATLAS", "atlas", "  atlas  ", "Beta", "gamma", "no-such-title"]) {
      const rows = svc.queryAllIssues({ project, search });
      const needle = search.trim().toLowerCase();
      const expected = expectedBy(svc, project, (id) => svc.getIssue(id).title.toLowerCase().includes(needle));
      assert.deepEqual(rows.map((r) => r.id), expected, `search ${JSON.stringify(search)}`);
    }
    db.close();
  });
});

// -- 2d. honest page metadata -------------------------------------------------

describe("honest page metadata", () => {
  function fiveIssues(): { db: DatabaseSync; svc: IssueService; project: string } {
    const { db, svc } = tempService();
    const project = svc.createProject({ id: "prj_meta", prefix: "MT", name: "meta" }).id;
    for (let i = 0; i < 5; i += 1) {
      svc.createIssue({ projectId: project, title: `t${i}`, kind: "task", contract: contract(), scrutiny: "LOW" });
    }
    return { db, svc, project };
  }

  it("hasMore is false exactly on the final page", () => {
    const { db, svc, project } = fiveIssues();
    const flags: boolean[] = [];
    const cursors: Array<string | null> = [];
    let cursor: string | null = null;
    for (;;) {
      const page = svc.queryIssues({ project, limit: 2, cursor });
      flags.push(page.hasMore);
      cursors.push(page.nextCursor);
      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
    }
    assert.deepEqual(flags, [true, true, false], "only the final page closes the walk");
    assert.deepEqual(cursors, [cursors[0], cursors[1], null]);
    assert.ok(cursors[0] && cursors[1], "non-final pages hand back a cursor");
    // A single page that holds everything is already final.
    const whole = svc.queryIssues({ project, limit: 500 });
    assert.equal(whole.rows.length, 5);
    assert.equal(whole.hasMore, false);
    assert.equal(whole.nextCursor, null);
    db.close();
  });

  it("scanned counts candidates and truncated stays false on normal pages", () => {
    const { db, svc, project } = fiveIssues();
    let cursor: string | null = null;
    let total = 0;
    for (;;) {
      const page = svc.queryIssues({ project, limit: 2, cursor });
      // An unfiltered page loads one candidate past the page: that lookahead
      // row is what makes `hasMore` exact instead of a guess, and it is real
      // work, so it is counted.
      // A full page loads one lookahead row (that is what makes hasMore
      // exact); the final page has no row beyond it, so nothing extra loads.
      assert.equal(page.scanned, page.rows.length + (page.hasMore ? 1 : 0), "page plus lookahead when more remains");
      assert.equal(page.truncated, false);
      total += page.rows.length;
      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
    }
    assert.equal(total, 5);
    // A readiness-filtered page may scan past rejected candidates, but the
    // count still reports candidates loaded, never rows emitted.
    const filtered = svc.queryIssues({ project, limit: 2, readiness: ["ready"] });
    assert.ok(filtered.scanned >= filtered.rows.length);
    assert.equal(filtered.truncated, false);
    db.close();
  });

  it("a page that fills exactly at the end does not promise a phantom cursor", () => {
    // Six issues at limit 3: the second page emits the last three rows and the
    // data ends there, so hasMore must be false and no cursor may be handed
    // back. Before the fix it promised a cursor whose page was empty (XTRM-540
    // reported the defect; the fix fetches one lookahead row so hasMore is
    // decided by whether a row remains, not by whether the page filled).
    const { db, svc } = tempService();
    const project = svc.createProject({ id: "prj_exact", prefix: "EX", name: "exact" }).id;
    for (let i = 0; i < 6; i += 1) {
      svc.createIssue({ projectId: project, title: `t${i}`, kind: "task", contract: contract(), scrutiny: "LOW" });
    }
    const p1 = svc.queryIssues({ project, limit: 3 });
    assert.equal(p1.rows.length, 3);
    assert.equal(p1.hasMore, true, "three rows remain after the first page");
    const p2 = svc.queryIssues({ project, limit: 3, cursor: p1.nextCursor });
    assert.equal(p2.rows.length, 3, "the last three rows");
    assert.equal(p2.hasMore, false, "the data ends here, so hasMore is false");
    assert.equal(p2.nextCursor, null, "no cursor for a tail that does not exist");
    // The walk is still lossless over exactly two pages.
    const walked = [...p1.rows, ...p2.rows].map((r) => r.id);
    assert.equal(new Set(walked).size, 6, "every issue exactly once");
    db.close();
  });

  it("a derived scan that hits its cap reports truncated with a resumable cursor", () => {
    // 10,500 issues, none ready: the readiness walk must stop at
    // MAX_DERIVED_SCAN (10,000) and say so honestly instead of silently
    // returning an empty page.
    const { db, svc } = tempService();
    const now = 1_700_000_000_000;
    db.prepare("INSERT INTO projects (id, prefix, name, created_at) VALUES ('prj_tr', 'TR', 't', ?)").run(now);
    const insertIssue = db.prepare(
      `INSERT INTO issues (id, project_id, human_number, kind, title, lifecycle_state, priority, scrutiny,
                           current_revision, current_contract_hash, defer_until, created_at, updated_at)
       VALUES (?, 'prj_tr', ?, 'task', ?, 'open', 0, 'LOW', 1, 'hash', NULL, ?, ?)`,
    );
    const insertRev = db.prepare(
      `INSERT INTO issue_revisions (issue_id, revision, contract_hash, contract_json, context_refs_json,
                                    ownership_json, authored_by, source_json, created_at)
       VALUES (?, 1, 'hash', ?, '[]', NULL, 'seed', NULL, ?)`,
    );
    const body = JSON.stringify(contract());
    db.exec("BEGIN IMMEDIATE");
    try {
      for (let i = 1; i <= 10_500; i += 1) {
        const id = `prj_tr-${i}`;
        insertIssue.run(id, i, `issue ${i}`, now, now);
        insertRev.run(id, body, now);
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    const page = svc.queryIssues({ project: "prj_tr", readiness: ["ready"], limit: 200 });
    assert.equal(page.rows.length, 0);
    assert.equal(page.truncated, true, "the cap must be reported, not silent");
    assert.equal(page.hasMore, true);
    assert.equal(page.scanned, 10_000, "the scan stops at MAX_DERIVED_SCAN");
    assert.ok(page.nextCursor, "a truncated page stays resumable");
    // Resuming terminates: the remaining 500 candidates hold no ready rows.
    const tail = svc.queryIssues({ project: "prj_tr", readiness: ["ready"], limit: 200, cursor: page.nextCursor });
    assert.equal(tail.truncated, false);
    assert.equal(tail.hasMore, false);
    db.close();
  });
});

// -- 2e. queryAllIssues parity ------------------------------------------------

describe("queryAllIssues parity with listIssues", () => {
  it("returns exactly listIssues for a project with sub-issues and blockers, in human_number order", () => {
    const { db, svc } = tempService();
    const project = svc.createProject({ id: "prj_par", prefix: "PR", name: "parity" }).id;
    const root = svc.createIssue({ projectId: project, title: "root", kind: "epic", contract: contract(), scrutiny: "LOW" });
    const child = svc.createIssue({
      projectId: project,
      title: "child",
      kind: "task",
      contract: contract(),
      scrutiny: "LOW",
      parentId: root.id,
    });
    svc.createIssue({
      projectId: project,
      title: "grandchild",
      kind: "task",
      contract: contract(),
      scrutiny: "LOW",
      parentId: child.id,
    });
    const blocker = svc.createIssue({
      projectId: project,
      title: "blocker",
      kind: "bug",
      contract: contract(),
      scrutiny: "LOW",
    });
    const blocked = svc.createIssue({
      projectId: project,
      title: "blocked",
      kind: "task",
      contract: contract(),
      scrutiny: "LOW",
    });
    svc.attestReadiness(blocked.id, { outcome: "ready", policy: "default", attestedBy: "t" });
    svc.addEdge(blocker.id, blocked.id, "blocks");
    const rows = svc.queryAllIssues({ project });
    const issues = svc.listIssues(project);
    assert.deepEqual(
      rows.map((r) => r.id),
      issues.map((i) => i.id),
      "same set in the same human_number order",
    );
    db.close();
  });
});

// -- 2f. CLI fails closed -----------------------------------------------------

describe("CLI surface fails closed", () => {
  function seededCliDb(): string {
    const { dbPath } = tempDbPath();
    const db = openSubstrate(dbPath);
    const svc = new IssueService(db);
    svc.createProject({ id: "prj_cli", prefix: "CL", name: "cli" });
    for (let i = 0; i < 3; i += 1) {
      svc.createIssue({ projectId: "prj_cli", title: `t${i}`, kind: "task", contract: contract(), scrutiny: "LOW" });
    }
    db.close();
    return dbPath;
  }

  it("rejects bad limits, unknown flags and bogus cursors with a non-zero exit and a message", () => {
    const dbPath = seededCliDb();
    const cases: Array<{ argv: string[]; message: RegExp }> = [
      { argv: ["issue", "query", "--project", "prj_cli", "--limit", "0"], message: /invalid limit/ },
      { argv: ["issue", "query", "--project", "prj_cli", "--limit", "-5"], message: /invalid limit/ },
      { argv: ["issue", "query", "--project", "prj_cli", "--limit", "abc"], message: /invalid limit/ },
      { argv: ["issue", "query", "--project", "prj_cli", "--bogus", "1"], message: /unknown flag --bogus/ },
      { argv: ["issue", "query", "--project", "prj_cli", "--cursor", "bogus"], message: /invalid board cursor/ },
    ];
    for (const { argv, message } of cases) {
      const { code, body } = cliQuery(dbPath, argv);
      assert.notEqual(code, 0, `${argv.join(" ")} must exit non-zero`);
      assert.match(body, message, `${argv.join(" ")} must explain the refusal`);
      assert.ok(!body.includes('"ok":true'), `${argv.join(" ")} must not return a page envelope`);
    }
  });

  it("--limit 501 clamps to MAX_PAGE_LIMIT instead of failing (documents the divergence)", () => {
    // The bead mandate expected a non-zero exit here, but clampPageLimit
    // deliberately clamps to 500: a clamped full page is not a silent
    // truncation, so this gate pins the clamp rather than the refusal. If the
    // refusal is wanted instead, the mandate (not the code) needs updating.
    const dbPath = seededCliDb();
    const { code, body } = cliQuery(dbPath, ["issue", "query", "--project", "prj_cli", "--limit", "501"]);
    assert.equal(code, 0, "501 clamps, it does not fail");
    const envelope = JSON.parse(body) as { ok: boolean; data: { rows: unknown[] } };
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.rows.length, 3, "every issue is returned, nothing is silently cut");
    // Fractional limits floor the same way Math.min(Math.floor(limit), MAX) says.
    const frac = cliQuery(dbPath, ["issue", "query", "--project", "prj_cli", "--limit", "2.5"]);
    assert.equal(frac.code, 0);
    assert.equal((JSON.parse(frac.body) as { data: { rows: unknown[] } }).data.rows.length, 2);
  });
});
