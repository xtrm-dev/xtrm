// Issue-to-PR links (XTRM-726, XTRM-727, XTRM-730): migration 013, the read
// model, the `sb links check` scan and the link gate. Writers arrived with
// XTRM-727, so these tests use the services directly for the write paths and
// still insert rows directly where the storage constraint is the subject.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { PullRequestService } from "../src/service/pull-request-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { parseAllTrailers } from "../src/domain/provenance.ts";
import { runCli, SCHEMA_VERSION, FLAG_ALLOWLIST } from "../cli/sb.ts";
import { contract, tempDir } from "./helpers.ts";

function scratch() {
  const dir = tempDir("substrate-pr-links-");
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

  it("creates both tables and records the migration head", () => {
    const tables = s.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('issue_pull_requests','issue_pr_commits') ORDER BY name")
      .all() as Array<{ name: string }>;
    assert.deepEqual(tables.map((t) => t.name), ["issue_pr_commits", "issue_pull_requests"]);
    const v = s.db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
    // XTRM-959 adds 018 on top; the tables this test proves are still 013's.
    assert.equal(v.v, 18);
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
    assert.deepEqual(parseAllTrailers(msg).issues.map((i) => i.issueId), ["XTRM-1", "XTRM-2"]);
  });
});

describe("links check --dry-run", () => {
  let s: ReturnType<typeof scratch>;
  let bin: string;
  let oldPath: string | undefined;
  beforeEach(() => {
    s = scratch();
    bin = tempDir("substrate-gh-");
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
    const helpDir = tempDir("substrate-pr-links-help-");
    const db = join(helpDir, "state.db");
    const direct = runCli(["--db", db, "links", "--help"]);
    assert.equal(direct.code, 0);
    assert.match(direct.stdout, /usage: sb links/);
    assert.match(direct.stdout, /\bsync\b/);
    assert.doesNotMatch(direct.stdout, /slice 1/i);

    const viaHelp = runCli(["--db", db, "help", "links"]);
    assert.equal(viaHelp.code, 0);
    assert.match(viaHelp.stdout, /usage: sb links/);
    assert.match(viaHelp.stdout, /\bsync\b/);
    assert.doesNotMatch(viaHelp.stdout, /slice 1/i);

    const bare = runCli(["--db", db, "links"]);
    assert.notEqual(bare.code, 0);
    assert.match(bare.stderr, /\|links\|/);
    rmSync(helpDir, { recursive: true, force: true });
  });

  // XTRM-749: the shipped help described the first slice of this feature long
  // after the gate and the writers landed, so an operator read "--dry-run is the
  // only mode" while `--issue` and `--link-gate` were the flags that mattered.
  // The allowlist is the authority for what a command accepts; every flag it
  // permits must appear in that command's help.
  it("documents every flag the strict allowlist accepts", () => {
    const dir = tempDir("substrate-pr-links-help-");
    const db = join(dir, "state.db");
    for (const command of ["check", "sync"] as const) {
      const allowed = FLAG_ALLOWLIST[`links.${command}`];
      assert.ok(allowed !== undefined && allowed.length > 0, `no allowlist entry for links.${command}`);
      const res = runCli(["--db", db, "links", command, "--help"]);
      assert.equal(res.code, 0, res.stderr);
      for (const flag of allowed) {
        assert.match(res.stdout, new RegExp(`--${flag}(?![a-z-])`), `sb links ${command} --help omits --${flag}`);
      }
    }
    const check = runCli(["--db", db, "links", "check", "--help"]);
    assert.doesNotMatch(check.stdout, /Slice 1|slice 1/, "the slice-1 wording outlived the implementation");
    assert.doesNotMatch(check.stdout, /--dry-run is the only mode/, "check is read-only with or without --dry-run");
    // sb.ts resolves the repository from `gh repo view` when --repo is absent, so
    // the help must not claim --repo is required.
    assert.doesNotMatch(check.stdout, /\(requires --repo\)/, "--repo is a fallback, not a requirement");
    assert.match(check.stdout, /or the current gh\s+repository/, "the gh fallback is what the code does");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("link read surfaces (XTRM-730)", () => {
  let w: ReturnType<typeof scratch>;
  let prs: PullRequestService;
  beforeEach(() => {
    w = scratch();
    prs = new PullRequestService(w.db, w.svc, new ProvenanceService(w.db, w.svc, new JournalService(w.db, w.svc)));
  });
  afterEach(() => { w.db.close(); rmSync(w.dir, { recursive: true, force: true }); });

  it("issue show carries linkEvents oldest-first and the manual gate verdict", () => {
    prs.linkMention({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w" });
    prs.linkMention({ issueId: w.issue.id, repository: "o/r", number: 8, actor: "w" });
    const data = cli(w.dbPath, ["issue", "show", w.issue.humanRef]);
    const events = data.linkEvents as Array<{ type: string }>;
    assert.deepEqual(events.map((e) => e.type), ["provenance.link_mentioned", "provenance.link_mentioned"]);
    const gate = data.linkGate as { mode: string; manual: { verdict: string; codes: string[] } };
    assert.equal(gate.mode, "manual");
    assert.equal(gate.manual.verdict, "refuse");
    assert.deepEqual(gate.manual.codes, ["gate_mentioned_only"]);
    assert.equal((data.pullRequests as unknown[]).length, 2);
  });

  it("unlink appends provenance.link_unlinked with its actor", () => {
    prs.linkMention({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w" });
    prs.unlink({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "operator" });
    const data = cli(w.dbPath, ["issue", "show", w.issue.humanRef]);
    const last = (data.linkEvents as Array<{ type: string; payload: { actor?: string } }>).at(-1)!;
    assert.equal(last.type, "provenance.link_unlinked");
    assert.equal(last.payload.actor, "operator");
  });

  it("issue query rows carry primaryPr with the cached state", () => {
    prs.linkMention({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w" });
    w.db.prepare(
      "INSERT INTO pull_requests (repository, number, state, draft, head_sha, merge_commit_sha, title, url, base_ref, merged_at, closed_at, etag, last_modified, last_synced_at) VALUES (?,?,?,0,NULL,NULL,NULL,NULL,?,NULL,NULL,NULL,NULL,?)",
    ).run("o/r", 7, "merged", "main", Date.now());
    const page = cli(w.dbPath, ["issue", "query", "--project", "prj_xtrm"]);
    const row = (page.rows as Array<{ primaryPr: Record<string, unknown> | null }>)[0]!;
    // XTRM-767: the projection carries the same field set as the view, so a
    // caller never has to guess whether a missing field means "absent" or "not
    // published". A raw row here has no state_source, hence null.
    assert.deepEqual(row.primaryPr, {
      repository: "o/r",
      number: 7,
      relation: "mentioned",
      url: null,
      state: "merged",
      stateSource: null,
      title: null,
      mergedAt: null,
    });
  });
});

describe("link surfaces round 2 (XTRM-730)", () => {
  let w: ReturnType<typeof scratch>;
  let prs: PullRequestService;
  beforeEach(() => {
    w = scratch();
    prs = new PullRequestService(w.db, w.svc, new ProvenanceService(w.db, w.svc, new JournalService(w.db, w.svc)));
  });
  afterEach(() => { w.db.close(); rmSync(w.dir, { recursive: true, force: true }); });

  const insert = (number: number, relation: string, createdAt: number, superseded: number | null = null) =>
    w.db.prepare(
      "INSERT INTO issue_pull_requests (issue_id, repository, number, relation, source, url, actor, created_at, superseded_at) VALUES (?,?,?,?,?,NULL,NULL,?,?)",
    ).run(w.issue.id, "o/r", number, relation, "explicit", createdAt, superseded);

  it("linkEvents is bounded to the last 20, oldest first", () => {
    for (let n = 1; n <= 25; n++) prs.linkMention({ issueId: w.issue.id, repository: "o/r", number: n, actor: "w" });
    const events = cli(w.dbPath, ["issue", "show", w.issue.humanRef]).linkEvents as Array<{ payload: { number: number } }>;
    assert.equal(events.length, 20);
    assert.equal(events[0]!.payload.number, 6);
    assert.equal(events.at(-1)!.payload.number, 25);
  });

  it("primaryPr prefers created_from over an older mention and hides superseded rows", () => {
    insert(7, "mentioned", 100);
    insert(8, "created_from", 200);
    const data = cli(w.dbPath, ["issue", "query", "--project", "prj_xtrm"]);
    const row = (data.rows as Array<{ primaryPr: { number: number } | null }>)[0]!;
    assert.equal(row.primaryPr!.number, 8);
    insert(9, "created_from", 50, 400);
    const after = cli(w.dbPath, ["issue", "query", "--project", "prj_xtrm"]);
    assert.equal((after.rows as Array<{ primaryPr: { number: number } | null }>)[0]!.primaryPr!.number, 8);
  });

  it("issue show carries primaryPr", () => {
    insert(7, "created_from", 100);
    const data = cli(w.dbPath, ["issue", "show", w.issue.humanRef]);
    assert.deepEqual((data.primaryPr as { number: number }).number, 7);
  });

  // XTRM-767: an opener-sourced row is published in full, with the unknown
  // values null and state_source saying who wrote them.
  it("primaryPr publishes the opener-sourced field set, nulls included", () => {
    insert(7, "created_from", 100);
    w.db.prepare(
      "INSERT INTO pull_requests (repository, number, state, state_source, draft, url, last_synced_at) VALUES (?,?,?,?,0,NULL,?)",
    ).run("o/r", 7, "open", "assumed", 1_760_000_000_000);
    const data = cli(w.dbPath, ["issue", "show", w.issue.humanRef]);
    assert.deepEqual(data.primaryPr, {
      repository: "o/r",
      number: 7,
      relation: "created_from",
      url: null,
      state: "open",
      stateSource: "assumed",
      title: null,
      mergedAt: null,
    });
  });

  it("primaryPr publishes the observed field set once a reconciler row exists", () => {
    insert(7, "created_from", 100);
    w.db.prepare(
      "INSERT INTO pull_requests (repository, number, state, state_source, draft, url, title, merged_at, last_synced_at) VALUES (?,?,?,?,0,NULL,?,?,?)",
    ).run("o/r", 7, "merged", "observed", "the real title", 1_760_000_000_000, 1_760_000_000_000);
    const data = cli(w.dbPath, ["issue", "show", w.issue.humanRef]);
    assert.deepEqual(data.primaryPr, {
      repository: "o/r",
      number: 7,
      relation: "created_from",
      url: null,
      state: "merged",
      stateSource: "observed",
      title: "the real title",
      mergedAt: 1_760_000_000_000,
    });
  });

  it("CLI unlink records the actor flag", () => {
    prs.linkMention({ issueId: w.issue.id, repository: "o/r", number: 7, actor: "w" });
    const res = runCli(["--db", w.dbPath, "issue", "unlink", "pr", w.issue.humanRef, "--repo", "o/r", "--number", "7", "--project", "prj_xtrm", "--actor", "operator"]);
    assert.equal(res.code, 0, res.stderr || res.stdout);
    const last = (cli(w.dbPath, ["issue", "show", w.issue.humanRef]).linkEvents as Array<{ type: string; payload: { actor?: string } }>).at(-1)!;
    assert.equal(last.type, "provenance.link_unlinked");
    assert.equal(last.payload.actor, "operator");
  });
});
