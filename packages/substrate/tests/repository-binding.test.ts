// Repository binding + migration 008 (ADR sbcloseout4 §§13-15, 84-90; bead
// XTRM-252.1). Covers every VALIDATION check of the contract: the live-shape
// migration snapshot, credential stripping at rest, deterministic collision
// behavior, adoption of existing/Beads-era Projects, and fail-closed conflict
// handling.

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { RepositoryService, RepositoryBindingConflictError } from "../src/service/repository-service.ts";
import { deriveRepositoryIdentity, localRepositoryKey, type RepositoryIdentity } from "../src/domain/repository.ts";
import { importBeads } from "../src/compatibility/beads/import.ts";
import { contract } from "./helpers.ts";
import * as m1 from "../src/store/migrations/001_baseline.ts";
import * as m2 from "../src/store/migrations/002_projections_sync.ts";
import * as m3 from "../src/store/migrations/003_readiness.ts";
import * as m4 from "../src/store/migrations/004_claims_leases.ts";
import * as m5 from "../src/store/migrations/005_journal.ts";
import * as m6 from "../src/store/migrations/006_provenance.ts";
import * as m7 from "../src/store/migrations/007_checkout_links.ts";

const V7_MIGRATIONS = [m1, m2, m3, m4, m5, m6, m7];
const NOW = 1788999550162;

// The live store (§90) is a v7 database holding prj_xtrm with Issues,
// revisions, aliases, locator history, edges, attestations, a claim, journal,
// an execution binding and four checkout_links rows (xtrm, specialists, core,
// mmd). The fixture below is that shape in miniature: migration 008 must add
// the binding table without touching one existing row.
function seedV7Store(path: string): void {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(
    "CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL)",
  );
  for (const m of V7_MIGRATIONS) {
    db.exec(m.sql);
    db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)").run(
      m.version,
      m.name,
      createHash("sha256").update(m.sql).digest("hex"),
      NOW,
    );
  }
  const project = db.prepare("INSERT INTO projects (id, prefix, name, created_at) VALUES (?, ?, ?, ?)");
  project.run("prj_xtrm", "XTRM", "xtrm", NOW);
  project.run("prj_specialists", "SPECIALISTS", "specialists", NOW);
  project.run("prj_core", "CORE", "core", NOW);
  project.run("prj_mmd", "MMD", "mmd", NOW);
  const link = db.prepare("INSERT INTO checkout_links (git_root, project_id, linked_at) VALUES (?, ?, ?)");
  link.run("/home/dawid/dev/xtrm", "prj_xtrm", NOW);
  link.run("/home/dawid/dev/specialists", "prj_specialists", NOW);
  link.run("/home/dawid/dev/core", "prj_core", NOW);
  link.run("/home/dawid/projects/mercury/market-data", "prj_mmd", NOW);
  const issue = db.prepare(
    `INSERT INTO issues (id, project_id, human_number, kind, title, lifecycle_state, priority, scrutiny,
      current_revision, current_contract_hash, defer_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  issue.run("iss_live_1", "prj_xtrm", 1, "task", "Land the ADR amendment", "open", 1, "HIGH", 1, "hash_1", null, NOW, NOW);
  issue.run("iss_live_2", "prj_xtrm", 2, "task", "Import the Beads board", "done", 0, "", 1, "hash_2", null, NOW, NOW);
  const revision = db.prepare(
    `INSERT INTO issue_revisions (issue_id, revision, contract_hash, contract_json, context_refs_json,
      ownership_json, authored_by, source_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  revision.run("iss_live_1", 1, "hash_1", JSON.stringify({ problem: "p", success: "s" }), "[]", null, "human:planner", null, NOW);
  revision.run("iss_live_2", 1, "hash_2", JSON.stringify({ problem: "p2", success: "s2" }), "[]", null, "human:planner", null, NOW);
  db.prepare("INSERT INTO issue_aliases (alias, issue_id, kind, created_at) VALUES (?, ?, ?, ?)").run("xtrm-legacy-1", "iss_live_1", "beads", NOW);
  db.prepare("INSERT INTO issue_locator_history (project_id, locator, issue_id, created_at) VALUES (?, ?, ?, ?)").run("prj_xtrm", "XTRM-1", "iss_live_1", NOW);
  db.prepare("INSERT INTO issue_edges (from_issue, to_issue, kind, child_slot, active, created_at) VALUES (?, ?, ?, ?, ?, ?)").run("iss_live_2", "iss_live_1", "blocks", null, 1, NOW);
  db.prepare(
    `INSERT INTO readiness_attestations (issue_id, issue_revision, contract_hash, outcome, policy, attested_by,
      evidence_refs_json, blocking_gaps_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("iss_live_1", 1, "hash_1", "ready", "default", "human:planner", "[]", "[]", NOW);
  db.prepare(
    `INSERT INTO issue_claims (issue_id, issue_revision, contract_hash, holder, activation_id, acquired_at,
      expires_at, released_at, generation) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("iss_live_1", 1, "hash_1", "human:dev", null, NOW, NOW + 60000, null, 1);
  db.prepare(
    `INSERT INTO issue_journal (id, issue_id, issue_revision, sequence, run_id, participant_id, activation_id,
      session_id, kind, mechanical_json, semantic_json, refs_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("jrn_1", "iss_live_1", 1, 1, null, "human:dev", null, null, "checkpoint", null, JSON.stringify({ summary: "started" }), "[]", NOW);
  db.prepare(
    `INSERT INTO execution_bindings (id, issue_id, issue_revision, contract_hash, resolved_context_hash, claim_id,
      participant_id, activation_id, attempt_id, session_id, workspace, base_commit, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("exb_1", "iss_live_1", 1, "hash_1", "ctx_1", null, "human:dev", null, null, null, "/home/dawid/dev/xtrm", null, NOW);
  db.prepare("INSERT INTO issue_events (issue_id, type, payload_json, created_at) VALUES (?, ?, ?, ?)").run("iss_live_1", "issue.created", "{}", NOW);
  db.prepare("INSERT INTO seq_counters (namespace, name, next_val) VALUES (?, ?, ?)").run("human_ref", "prj_xtrm", 3);
  db.close();
}

const SNAPSHOT_TABLES = [
  "projects",
  "issues",
  "issue_revisions",
  "issue_aliases",
  "issue_locator_history",
  "issue_edges",
  "readiness_attestations",
  "issue_claims",
  "issue_journal",
  "execution_bindings",
  "issue_events",
  "checkout_links",
  "seq_counters",
];

function snapshot(path: string): Record<string, unknown[]> {
  const db = new DatabaseSync(path);
  const out: Record<string, unknown[]> = {};
  for (const table of SNAPSHOT_TABLES) out[table] = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  db.close();
  return out;
}

// A later migration may add nullable columns. "Additive" means no existing
// value changed, so compare on the pre-migration column set and ignore
// columns the old store did not have.
function onPreMigrationColumns(after: Record<string, unknown[]>, before: Record<string, unknown[]>): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const [table, rows] of Object.entries(before)) {
    const keys = rows.length > 0 ? Object.keys(rows[0] as object) : [];
    out[table] = (after[table] ?? []).map((r) => {
      const rec = r as Record<string, unknown>;
      // node:sqlite rows are null-prototype objects; keep that shape so the
      // comparison stays value-based.
      const picked: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const k of keys) picked[k] = rec[k];
      return picked;
    });
  }
  return out;
}

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setup(): { dir: string; db: ReturnType<typeof openSubstrate>; svc: IssueService; repos: RepositoryService } {
  const dir = tempDir("sb-repobind-");
  const db = openSubstrate(join(dir, "state.db"));
  return { dir, db, svc: new IssueService(db), repos: new RepositoryService(db) };
}

function identityFor(remoteUrl: string, commonRoot = "/repo"): RepositoryIdentity {
  return deriveRepositoryIdentity({ commonRoot, remotes: [{ name: "origin", url: remoteUrl }] });
}

function identityForRemoteKey(repositoryKey: string): RepositoryIdentity {
  return { repositoryKey, canonicalRemote: repositoryKey, local: false };
}

describe("migration 008 on the live prj_xtrm store shape (§90)", () => {
  it("adds repository_bindings without touching or dropping any existing row", () => {
    const dir = tempDir("sb-mig008-");
    const path = join(dir, "state.db");
    seedV7Store(path);
    const before = snapshot(path);

    const db = openSubstrate(path);
    const version = db.prepare("SELECT MAX(version) AS v FROM schema_migrations").get() as { v: number };
    // Head advances with every landed migration; 008 is proven applied below.
    assert.equal(version.v, 9);
    const applied = db.prepare("SELECT name FROM schema_migrations WHERE version = 8").get() as { name: string };
    assert.equal(applied.name, "repository-bindings");
    const head = db.prepare("SELECT name FROM schema_migrations WHERE version = 9").get() as { name: string };
    assert.equal(head.name, "journal-result-payload");
    const bindings = db.prepare("SELECT COUNT(*) AS n FROM repository_bindings").get() as { n: number };
    assert.equal(bindings.n, 0);
    // The Project surface is untouched: prj_xtrm is neither duplicated nor renumbered.
    const projects = db.prepare("SELECT id, prefix, name FROM projects ORDER BY id").all() as Array<{ id: string; prefix: string }>;
    assert.deepEqual(projects.map((p) => p.id), ["prj_core", "prj_mmd", "prj_specialists", "prj_xtrm"]);
    db.close();

    assert.deepEqual(
      onPreMigrationColumns(snapshot(path), before),
      before,
      "landed migrations must be additive: no pre-existing row value changes",
    );

    // checkout_links is demoted to a cache, not deleted: resolution still uses it.
    const reopened = openSubstrate(path);
    try {
      const svc = new IssueService(reopened);
      const resolved = svc.resolveProject({ gitRoot: "/home/dawid/dev/xtrm" });
      assert.equal(resolved.projectId, "prj_xtrm");
      // checkout_links stays the explicit local alias/cache (never the
      // removed global-cardinality default).
      assert.deepEqual(resolved, { projectId: "prj_xtrm", source: "link" });
      const issues = svc.listIssues("prj_xtrm");
      assert.deepEqual(
        issues.map((i) => i.humanRef).sort(),
        ["XTRM-1", "XTRM-2"],
        "Issue refs must be unchanged by the migration",
      );
    } finally {
      reopened.close();
    }
  });
});

describe("binding, adoption and idempotency (§§13-14, §90)", () => {
  it("adopts the existing prj_xtrm Project instead of creating a duplicate", () => {
    const { db, svc, repos } = setup();
    svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "xtrm" });
    svc.createIssue({
      projectId: "prj_xtrm",
      title: "existing work",
      kind: "task",
      contract: { problem: "p", success: "s", scope: ["a"], nonGoals: ["b"], constraints: ["c"], validation: [{ check: "v" }], output: [{ artifact: "o" }] },
    });

    const result = repos.bindRepository({
      identity: identityFor("git@github.com:xtrm-dev/xtrm.git", "/home/dawid/dev/xtrm"),
      commonRoot: "/home/dawid/dev/xtrm",
      baseBranch: "main",
      now: 111,
    });

    assert.equal(result.projectId, "prj_xtrm");
    assert.equal(result.created, false);
    assert.equal(result.adopted, true);
    assert.equal(result.idempotent, false);
    assert.deepEqual(result.binding, {
      repositoryKey: "github.com/xtrm-dev/xtrm",
      projectId: "prj_xtrm",
      baseBranch: "main",
      canonicalRemote: "github.com/xtrm-dev/xtrm",
      createdAt: 111,
      updatedAt: 111,
    });
    // No duplicate Project, and the Issue surface is intact.
    const projects = db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number };
    assert.equal(projects.n, 1);
    assert.deepEqual(svc.listIssues("prj_xtrm").map((i) => i.humanRef), ["XTRM-1"]);
    // checkout_links is refreshed as the local cache alias for the checkout.
    const alias = svc.listLinks().find((l) => l.gitRoot === "/home/dawid/dev/xtrm");
    assert.equal(alias?.projectId, "prj_xtrm");
  });

  it("adopts a Beads-imported Project and preserves its aliases and Issues", () => {
    const { db, svc, repos } = setup();
    svc.createProject({ id: "prj_specialists", prefix: "SPECIALISTS", name: "specialists" });
    const imported = importBeads(svc, "prj_specialists", [{ id: "spec-legacy-1", title: "Legacy bead", status: "open", issue_type: "task" }], []);
    assert.deepEqual(imported.created, ["spec-legacy-1"]);

    const result = repos.bindRepository({
      identity: identityFor("ssh://git@github.com/xtrm-dev/specialists.git"),
      baseBranch: "main",
    });

    assert.equal(result.projectId, "prj_specialists");
    assert.equal(result.adopted, true);
    assert.equal(result.created, false);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n, 1);
    assert.equal(svc.resolveRef("spec-legacy-1").projectId, "prj_specialists");
  });

  it("second bind is idempotent: same Project, one row, no rewrite", () => {
    const { db, repos } = setup();
    const identity = identityForRemoteKey("github.com/xtrm-dev/xtrm");
    const first = repos.bindRepository({ identity, baseBranch: "main", now: 100 });
    const second = repos.bindRepository({ identity, baseBranch: "main", now: 999 });
    assert.equal(second.projectId, first.projectId);
    assert.equal(second.idempotent, true);
    assert.equal(second.created, false);
    assert.deepEqual(second.binding, first.binding, "no-op rebind must not rewrite timestamps");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM repository_bindings").get() as { n: number }).n, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n, 1);
  });

  it("never persists a credential and stores unknown facts absent (§98)", () => {
    const { db, svc, repos } = setup();
    const secret = "ghp_SUPERSECRETTOKEN";
    const identity = identityFor(`https://x-access-token:${secret}@github.com/xtrm-dev/xtrm.git`);
    const result = repos.bindRepository({ identity });
    assert.equal(result.binding.canonicalRemote, "github.com/xtrm-dev/xtrm");
    assert.equal(result.binding.baseBranch, null, "unknown base branch stays absent");
    assert.ok(!JSON.stringify(result.binding).includes(secret));
    const rows = db.prepare("SELECT * FROM repository_bindings").all();
    assert.ok(!JSON.stringify(rows).includes(secret));

    // Remote-less repository: deterministic local identity, no invented remote.
    const local = deriveRepositoryIdentity({ commonRoot: "/srv/local-only" });
    const bound = repos.bindRepository({ identity: local, commonRoot: "/srv/local-only", now: 5 });
    assert.equal(bound.binding.repositoryKey, localRepositoryKey("/srv/local-only"));
    assert.equal(bound.binding.canonicalRemote, null);
    assert.equal(bound.projectId, "prj_local_only");
    assert.equal(svc.listLinks().some((l) => l.gitRoot === "/srv/local-only"), true);
  });

  it("a remote-less repository that later gains a remote gets the canonical identity, never a silent relink", () => {
    const { repos } = setup();
    const local = deriveRepositoryIdentity({ commonRoot: "/srv/xtrm" });
    repos.bindRepository({ identity: local, commonRoot: "/srv/xtrm", now: 1 });
    const remote = deriveRepositoryIdentity({
      commonRoot: "/srv/xtrm",
      remotes: [{ name: "origin", url: "git@github.com:xtrm-dev/xtrm.git" }],
    });
    const bound = repos.bindRepository({ identity: remote, commonRoot: "/srv/xtrm", now: 2 });
    // ADR §9 documents the local limitation; ADR §15 forbids a silent relink.
    // The outcome is visible: two bindings, and the local Project is untouched.
    assert.notEqual(bound.projectId, repos.getBinding(local.repositoryKey)?.projectId);
    assert.equal(bound.adopted, false);
    assert.equal(repos.listBindings().length, 2);
    assert.equal(repos.getBinding(local.repositoryKey)?.projectId, "prj_xtrm");
  });
});

describe("basename collision policy (§12, §89)", () => {
  it("gives two owners of the same basename different, deterministic Projects", () => {
    const { db, svc, repos } = setup();
    const a = repos.bindRepository({ identity: identityForRemoteKey("github.com/a/service"), baseBranch: "main" });
    const b = repos.bindRepository({ identity: identityForRemoteKey("github.com/b/service"), baseBranch: "main" });

    assert.equal(a.projectId, "prj_service");
    assert.equal(b.projectId, "prj_b_service");
    assert.notEqual(a.projectId, b.projectId);
    assert.deepEqual(repos.getBinding("github.com/a/service")?.projectId, "prj_service", "the established Project is never renamed");
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n, 2);
    const ids = (db.prepare("SELECT id FROM projects ORDER BY id").all() as Array<{ id: string }>).map((r) => r.id);
    assert.deepEqual(ids, ["prj_b_service", "prj_service"], "no random suffix, no accidental sharing");
    // Isolation extends to collisions: neither Project can see the other's work.
    svc.createIssue({ projectId: "prj_service", title: "owned by a", kind: "task", contract: contract() });
    assert.deepEqual(svc.listIssues("prj_b_service"), []);
    assert.deepEqual(svc.listIssues("prj_service").map((i) => i.humanRef), ["SERVICE-1"]);
  });

  it("never renames an established Project when its prefix is already taken", () => {
    const { db, svc, repos } = setup();
    svc.createProject({ id: "prj_legacy", prefix: "XTRM", name: "legacy" });
    const result = repos.bindRepository({ identity: identityForRemoteKey("github.com/xtrm-dev/xtrm") });
    assert.equal(result.projectId, "prj_xtrm_dev_xtrm");
    const legacy = db.prepare("SELECT prefix, name FROM projects WHERE id = 'prj_legacy'").get() as { prefix: string; name: string };
    assert.equal(legacy.prefix, "XTRM", "an established Project is never silently renamed");
    assert.equal(legacy.name, "legacy");
  });

  it("fails closed with identity, conflicting Project and repair action when every candidate is taken", () => {
    const { db, svc, repos } = setup();
    repos.bindRepository({ identity: identityForRemoteKey("github.com/a/service") });
    // Occupy the remaining deterministic candidates, so all three of
    // github.com/b/service's candidates are authoritatively bound elsewhere.
    repos.bindRepository({ identity: identityForRemoteKey("github.com/x/b-service") });
    svc.createProject({ id: "prj_github_com_b_service", prefix: "GITHUBCOMB", name: "b-service" });
    db.prepare(
      "INSERT INTO repository_bindings (repository_key, project_id, base_branch, canonical_remote, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("github.com/z/b_service", "prj_github_com_b_service", "main", "github.com/z/b_service", 1, 1);
    // github.com/b/service -> candidates [prj_service, prj_b_service, prj_github_com_b_service]; all bound elsewhere.
    let error: unknown;
    try {
      repos.bindRepository({ identity: identityForRemoteKey("github.com/b/service") });
    } catch (err) {
      error = err;
    }
    assert.ok(error instanceof RepositoryBindingConflictError);
    const conflict = error as RepositoryBindingConflictError;
    assert.equal(conflict.repositoryKey, "github.com/b/service");
    assert.ok(conflict.conflictingProjectId.startsWith("prj_"));
    assert.match(conflict.message, /github\.com\/b\/service/);
    assert.match(conflict.message, /Repair:/);
    assert.equal(repos.getBinding("github.com/b/service"), null, "a failed bind writes nothing");
  });
});

describe("contradictory durable evidence fails closed (§15)", () => {
  it("detects one Project bound to two unrelated repositories", () => {
    const { db, repos } = setup();
    repos.bindRepository({ identity: identityForRemoteKey("github.com/a/service"), baseBranch: "main" });
    // Contradiction forced directly: repository_key is unique, so only an
    // external writer can bind one Project to a second repository.
    db.prepare(
      "INSERT INTO repository_bindings (repository_key, project_id, base_branch, canonical_remote, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run("github.com/x/service", "prj_service", "main", "github.com/x/service", 1, 1);

    assert.deepEqual(repos.findContradictions(), [
      { projectId: "prj_service", repositoryKeys: ["github.com/a/service", "github.com/x/service"] },
    ]);
    assert.throws(() => repos.assertConsistent(), RepositoryBindingConflictError);
    assert.throws(
      () => repos.bindRepository({ identity: identityForRemoteKey("github.com/a/service") }),
      (err: unknown) => {
        assert.ok(err instanceof RepositoryBindingConflictError);
        assert.equal(err.conflictingProjectId, "prj_service");
        assert.match(err.message, /github\.com\/x\/service/);
        assert.match(err.message, /Repair:/);
        return true;
      },
    );
  });
});
