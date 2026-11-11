// Issue-to-PR links, slice 1 (XTRM-726): migration 013, the read model and
// the `sb links check --dry-run` candidate scan. No writers exist yet, so the
// tests insert rows directly and prove the constraints and the read order.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { PullRequestService } from "../src/service/pull-request-service.ts";
import { trailerIssueRefs } from "../src/domain/pull-request.ts";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";
import { contract } from "./helpers.ts";

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), "substrate-pr-links-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const issue = svc.createIssue({
    projectId: "prj_xtrm",
    title: "link target",
    kind: "task",
    contract: contract({ problem: "p", success: "s" }),
    scrutiny: "LOW",
    authoredBy: "tester",
  });
  return { dir, dbPath, db, svc, issue };
}

function cli(dbPath: string, argv: string[]): Record<string, unknown> {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
  const env = JSON.parse(res.stdout) as { schema: string; ok: boolean; data: Record<string, unknown> };
  assert.equal(env.schema, SCHEMA_VERSION);
  assert.equal(env.ok, true);
  return env.data;
}

describe("migration 013", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("creates both tables and records version 13", () => {
    const tables = s.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('issue_pull_requests','issue_pr_commits') ORDER BY name")
      .all() as Array<{ name: string }>;
    assert.deepEqual(tables.map((t) => t.name), ["issue_pr_commits", "issue_pull_requests"]);
    const v = s.db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
    assert.equal(v.v, 13);
  });

  it("rejects a duplicate relation row and a duplicate commit", () => {
    const insert = s.db.prepare(
      "INSERT INTO issue_pull_requests (issue_id, repository, number, relation, source, url, actor, created_at) VALUES (?,?,?,?,?,?,?,?)",
    );
    insert.run(s.issue.id, "o/r", 7, "created_from", "provenance", null, "a", 1);
    assert.throws(() => insert.run(s.issue.id, "o/r", 7, "created_from", "provenance", null, "a", 2), /UNIQUE|PRIMARY KEY/);
    insert.run(s.issue.id, "o/r", 7, "mentioned", "title", null, "a", 3);

    const commit = s.db.prepare(
      "INSERT INTO issue_pr_commits (issue_id, repository, number, sha, landed_sha, trailer_revision) VALUES (?,?,?,?,?,?)",
    );
    commit.run(s.issue.id, "o/r", 7, "abc", null, null);
    assert.throws(() => commit.run(s.issue.id, "o/r", 7, "abc", null, null), /UNIQUE|PRIMARY KEY/);

    assert.throws(
      () => insert.run(s.issue.id, "o/r", 8, "implements", "provenance", null, "a", 4),
      /CHECK constraint failed/,
    );
    assert.throws(
      () => insert.run(s.issue.id, "o/r", 9, "mentioned", "invented", null, "a", 5),
      /CHECK constraint failed/,
    );
  });

  it("rejects one commit SHA claimed by two issues in the same PR", () => {
    const other = s.svc.createIssue({
      projectId: "prj_xtrm", title: "second", kind: "task",
      contract: contract({ problem: "p2", success: "s2" }), scrutiny: "LOW", authoredBy: "tester",
    });
    const commit = s.db.prepare(
      "INSERT INTO issue_pr_commits (issue_id, repository, number, sha, landed_sha, trailer_revision) VALUES (?,?,?,?,?,?)",
    );
    commit.run(s.issue.id, "o/r", 7, "abc", null, null);
    assert.throws(() => commit.run(other.id, "o/r", 7, "abc", null, null), /UNIQUE constraint failed/);
  });

  it("allows one commit SHA under a different PR (backport / coordinator chain)", () => {
    const commit = s.db.prepare(
      "INSERT INTO issue_pr_commits (issue_id, repository, number, sha, landed_sha, trailer_revision) VALUES (?,?,?,?,?,?)",
    );
    commit.run(s.issue.id, "o/r", 7, "abc", null, null);
    commit.run(s.issue.id, "o/r", 8, "abc", null, null);
    const n = s.db.prepare("SELECT COUNT(*) AS n FROM issue_pr_commits").get() as { n: number };
    assert.equal(n.n, 2);
  });

  it("allows several issues to share one landed squash SHA", () => {
    const parent = s.issue;
    const rev = s.svc.getRevision(parent.id, parent.currentRevision);
    const other = s.svc.createIssue({
      projectId: "prj_xtrm", title: "second", kind: "task",
      contract: contract({ problem: "p2", success: "s2" }), scrutiny: "LOW", authoredBy: "tester",
    });
    assert.ok(rev);
    const commit = s.db.prepare(
      "INSERT INTO issue_pr_commits (issue_id, repository, number, sha, landed_sha, trailer_revision) VALUES (?,?,?,?,?,?)",
    );
    commit.run(parent.id, "o/r", 7, "abc", "landed", null);
    commit.run(other.id, "o/r", 7, "def", "landed", null);
    const rows = s.db.prepare("SELECT COUNT(*) AS n FROM issue_pr_commits WHERE landed_sha = 'landed'").get() as { n: number };
    assert.equal(rows.n, 2);
  });
});

describe("read model", () => {
  let s: ReturnType<typeof scratch>;
  beforeEach(() => { s = scratch(); });
  afterEach(() => { try { s.db.close(); } catch { /* closed */ } rmSync(s.dir, { recursive: true, force: true }); });

  it("collapses to the strongest relation and keeps every source", () => {
    const insert = s.db.prepare(
      "INSERT INTO issue_pull_requests (issue_id, repository, number, relation, source, url, actor, created_at) VALUES (?,?,?,?,?,?,?,?)",
    );
    insert.run(s.issue.id, "o/r", 8, "mentioned", "title", null, "a", 1);
    insert.run(s.issue.id, "o/r", 7, "mentioned", "prose", null, "a", 2);
    insert.run(s.issue.id, "o/r", 7, "created_from", "provenance", "https://github.com/o/r/pull/7", "a", 3);
    insert.run(s.issue.id, "o/r", 7, "mentioned", "branch", null, "a", 4);
    const commit = s.db.prepare(
      "INSERT INTO issue_pr_commits (issue_id, repository, number, sha, landed_sha, trailer_revision) VALUES (?,?,?,?,?,?)",
    );
    commit.run(s.issue.id, "o/r", 7, "bbbb", null, null);
    commit.run(s.issue.id, "o/r", 7, "aaaa", "landed", 2);

    const view = new PullRequestService(s.db).listForIssue(s.issue.id);
    assert.equal(view.length, 2);
    // created_from outranks a mention that was created earlier.
    assert.equal(view[0]!.number, 7);
    assert.equal(view[1]!.number, 8);
    assert.equal(view[0]!.relation, "created_from");
    assert.deepEqual(view[0]!.sources, ["provenance"]);
    assert.equal(view[0]!.alsoMentioned, true);
    assert.equal(view[0]!.url, "https://github.com/o/r/pull/7");
    assert.deepEqual(view[0]!.commits.map((c) => c.sha), ["aaaa", "bbbb"]);
    assert.equal(view[0]!.commits[0]!.landedSha, "landed");
  });

  it("orders mentions by created_at ascending, not descending", () => {
    const insert = s.db.prepare(
      "INSERT INTO issue_pull_requests (issue_id, repository, number, relation, source, url, actor, created_at) VALUES (?,?,?,?,?,?,?,?)",
    );
    insert.run(s.issue.id, "o/r", 8, "mentioned", "title", null, "a", 9);
    insert.run(s.issue.id, "o/r", 9, "mentioned", "title", null, "a", 1);
    const view = new PullRequestService(s.db).listForIssue(s.issue.id);
    assert.deepEqual(view.map((v) => v.number), [9, 8]);
  });

  it("re-places an upgraded mention at its created_from row", () => {
    const insert = s.db.prepare(
      "INSERT INTO issue_pull_requests (issue_id, repository, number, relation, source, url, actor, created_at) VALUES (?,?,?,?,?,?,?,?)",
    );
    // Mentions: A then B. Upgrades: B then A. The created_from rows decide
    // the order, so the view must move each PR when it upgrades.
    insert.run(s.issue.id, "o/r", 1, "mentioned", "title", null, "a", 1);
    insert.run(s.issue.id, "o/r", 2, "mentioned", "title", null, "a", 2);
    insert.run(s.issue.id, "o/r", 2, "created_from", "provenance", "https://github.com/o/r/pull/2", "a", 3);
    insert.run(s.issue.id, "o/r", 1, "created_from", "provenance", "https://github.com/o/r/pull/1", "a", 4);
    const view = new PullRequestService(s.db).listForIssue(s.issue.id);
    assert.deepEqual(view.map((v) => v.number), [2, 1]);
    assert.ok(view.every((v) => v.relation === "created_from"));
  });

  it("orders an equal created_at by insertion (rowid), not descending", () => {
    const insert = s.db.prepare(
      "INSERT INTO issue_pull_requests (issue_id, repository, number, relation, source, url, actor, created_at) VALUES (?,?,?,?,?,?,?,?)",
    );
    insert.run(s.issue.id, "o/r", 9, "mentioned", "title", null, "a", 5);
    insert.run(s.issue.id, "o/r", 8, "mentioned", "title", null, "a", 5);
    const view = new PullRequestService(s.db).listForIssue(s.issue.id);
    assert.deepEqual(view.map((v) => v.number), [9, 8]);
  });

  it("inserts every declared source, and one source under both relations", () => {
    const insert = s.db.prepare(
      "INSERT INTO issue_pull_requests (issue_id, repository, number, relation, source, url, actor, created_at) VALUES (?,?,?,?,?,?,?,?)",
    );
    const sources = ["provenance", "explicit", "trailer", "title", "branch", "prose", "backfill"];
    sources.forEach((source, i) => insert.run(s.issue.id, "o/r", 20 + i, "mentioned", source, null, "a", i));
    assert.equal(sources.length, 7);
    // The same source under both relations is two rows: relation is in the PK.
    insert.run(s.issue.id, "o/r", 7, "created_from", "explicit", null, "a", 8);
    insert.run(s.issue.id, "o/r", 7, "mentioned", "explicit", null, "a", 9);
    const n = s.db.prepare("SELECT COUNT(*) AS n FROM issue_pull_requests").get() as { n: number };
    assert.equal(n.n, 9);
  });

  it("issue show carries pullRequests in JSON and a bounded block in text", () => {
    const insert = s.db.prepare(
      "INSERT INTO issue_pull_requests (issue_id, repository, number, relation, source, url, actor, created_at) VALUES (?,?,?,?,?,?,?,?)",
    );
    insert.run(s.issue.id, "o/r", 7, "created_from", "provenance", "https://github.com/o/r/pull/7", "a", 1);
    insert.run(s.issue.id, "o/r", 7, "mentioned", "title", null, "a", 2);

    const data = cli(s.dbPath, ["issue", "show", s.issue.humanRef]);
    const pulls = data["pullRequests"] as Array<Record<string, unknown>>;
    assert.equal(pulls.length, 1);
    assert.equal(pulls[0]!["relation"], "created_from");
    assert.equal(pulls[0]!["alsoMentioned"], true);

    const res = runCli(["--db", s.dbPath, "issue", "show", s.issue.humanRef]);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /PULL REQUESTS/);
    assert.match(res.stdout, /created_from o\/r#7/);
  });
});

describe("trailer reads", () => {
  it("returns every XTRM-Issue value, deduped, and ignores malformed lines", () => {
    const msg = [
      "feat: work",
      "",
      "XTRM-Issue: XTRM-1",
      "XTRM-Issue: XTRM-2",
      "XTRM-Issue: XTRM-1",
      " XTRM-Issue: XTRM-3",
      "XTRM-Issue:",
    ].join("\n");
    assert.deepEqual(trailerIssueRefs(msg), ["XTRM-1", "XTRM-2"]);
  });
});

describe("links check --dry-run", () => {
  let s: ReturnType<typeof scratch>;
  let bin: string;
  let oldPath: string | undefined;
  beforeEach(() => {
    s = scratch();
    bin = mkdtempSync(join(tmpdir(), "substrate-gh-"));
    oldPath = process.env["PATH"];
  });
  afterEach(() => {
    if (oldPath !== undefined) process.env["PATH"] = oldPath;
    try { s.db.close(); } catch { /* closed */ }
    rmSync(bin, { recursive: true, force: true });
    rmSync(s.dir, { recursive: true, force: true });
  });

  it("lists trailer candidates through gh and writes nothing", () => {
    const gh = join(bin, "gh");
    writeFileSync(gh, `#!/bin/sh
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  printf '%s\n' '[{"number":7,"title":"work","url":"https://github.com/o/r/pull/7"}]'
elif [ "$1" = "pr" ] && [ "$2" = "view" ]; then
  printf '%s\n' '{"url":"https://github.com/o/r/pull/7","commits":[{"oid":"abc123","messageHeadline":"feat: work","messageBody":"XTRM-Issue: ${s.issue.humanRef}\\nXTRM-Issue: NOPE-9"}]}'
else
  echo "unexpected: $*" >&2; exit 1
fi
`);
    chmodSync(gh, 0o755);
    process.env["PATH"] = `${bin}:${oldPath ?? ""}`;

    const data = cli(s.dbPath, ["links", "check", "--dry-run", "--project", "prj_xtrm", "--repo", "o/r"]);
    const candidates = data["candidates"] as Array<Record<string, unknown>>;
    assert.equal(data["dryRun"], true);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!["issue"], s.issue.humanRef);
    assert.equal(candidates[0]!["number"], 7);
    const count = s.db.prepare("SELECT COUNT(*) AS n FROM issue_pull_requests").get() as { n: number };
    assert.equal(count.n, 0);
    const commits = s.db.prepare("SELECT COUNT(*) AS n FROM issue_pr_commits").get() as { n: number };
    assert.equal(commits.n, 0);
  });
});

describe("links help", () => {
  it("answers sb links --help, sb help links, and lists links in the bare usage", () => {
    const db = join(mkdtempSync(join(tmpdir(), "substrate-pr-links-help-")), "state.db");
    const direct = runCli(["--db", db, "links", "--help"]);
    assert.equal(direct.code, 0);
    assert.match(direct.stdout, /usage: sb links/);

    const viaHelp = runCli(["--db", db, "help", "links"]);
    assert.equal(viaHelp.code, 0);
    assert.match(viaHelp.stdout, /usage: sb links/);

    const bare = runCli(["--db", db, "links"]);
    assert.notEqual(bare.code, 0);
    assert.match(bare.stderr, /\|links\|/);
  });
});
