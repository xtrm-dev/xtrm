import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { runCli, SCHEMA_VERSION } from "../cli/sb.ts";
import { contract } from "./helpers.ts";

// Repository-relative project resolution (xtrm-7wc.5.6, corrected by
// XTRM-252.2 / ADR §§4-5): precedence flag > env > repository binding >
// explicit checkout link > fail-closed. Global database cardinality is never
// evidence, so an uninitialized repository fails closed with the `sb init`
// guidance. Also covers the link/unlink round-trip, non-git skip, a
// real-checkout CLI test, and a freshness probe (service write -> CLI read).

function setup(): { dir: string; dbPath: string; svc: IssueService; db: ReturnType<typeof openSubstrate> } {
  const dir = mkdtempSync(join(tmpdir(), "sb-resolve-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  return { dir, dbPath, svc: new IssueService(db), db };
}

describe("project resolution (xtrm-7wc.5.6)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("precedence: flag beats env beats repository binding beats checkout link", () => {
    ctx.svc.createProject({ id: "prj_a", prefix: "A", name: "a" });
    ctx.svc.createProject({ id: "prj_b", prefix: "B", name: "b" });
    ctx.svc.linkCheckout("/repo", "prj_b");
    // The checkout link is the local alias/cache; the binding is authority.
    ctx.db
      .prepare("INSERT INTO repository_bindings (repository_key, project_id, base_branch, canonical_remote, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("github.com/a/service", "prj_a", "main", "github.com/a/service", 1, 1);
    assert.equal(ctx.svc.resolveProject({ explicit: "prj_b", env: "prj_a", gitRoot: "/repo", repositoryKey: "github.com/a/service" }).projectId, "prj_b");
    assert.equal(ctx.svc.resolveProject({ explicit: "prj_b", env: "prj_a", gitRoot: "/repo", repositoryKey: "github.com/a/service" }).source, "flag");
    assert.equal(ctx.svc.resolveProject({ env: "prj_b", gitRoot: "/repo", repositoryKey: "github.com/a/service" }).source, "env");
    assert.deepEqual(ctx.svc.resolveProject({ gitRoot: "/repo", repositoryKey: "github.com/a/service" }), { projectId: "prj_a", source: "binding" });
    // No binding for this key: the explicit checkout link still resolves.
    assert.deepEqual(ctx.svc.resolveProject({ gitRoot: "/repo", repositoryKey: "github.com/other/service" }), { projectId: "prj_b", source: "link" });
  });

  it("global database cardinality is never evidence: uninitialized repositories fail closed with `sb init` guidance", () => {
    // Zero projects.
    assert.throws(() => ctx.svc.resolveProject({}), /Run `sb init`/);
    // Exactly one project is still not evidence for this repository (ADR §5).
    ctx.svc.createProject({ id: "prj_only", prefix: "ONLY", name: "only" });
    assert.throws(() => ctx.svc.resolveProject({}), /not inside a Git checkout.*Run `sb init`/);
    assert.throws(() => ctx.svc.resolveProject({ gitRoot: "/unlinked" }), /not initialized.*Run `sb init`/);
    assert.throws(() => ctx.svc.resolveProject({ gitRoot: "/unlinked", repositoryKey: "github.com/x/service" }), /github\.com\/x\/service.*Run `sb init`/);
    // Several projects do not change the fail-closed outcome either.
    ctx.svc.createProject({ id: "prj_second", prefix: "SECOND", name: "second" });
    assert.throws(() => ctx.svc.resolveProject({}), /Run `sb init`/);
    assert.throws(() => ctx.svc.resolveProject({ gitRoot: "/unlinked" }), /SUBSTRATE_PROJECT/);
  });

  it("a binding that points at a missing project fails closed, never a silent fallback", () => {
    ctx.db.exec("PRAGMA foreign_keys = OFF");
    ctx.db
      .prepare("INSERT INTO repository_bindings (repository_key, project_id, base_branch, canonical_remote, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run("github.com/gone/service", "prj_gone", null, "github.com/gone/service", 1, 1);
    ctx.db.exec("PRAGMA foreign_keys = ON");
    assert.throws(
      () => ctx.svc.resolveProject({ repositoryKey: "github.com/gone/service" }),
      /bound to missing project prj_gone.*repair/i,
    );
  });

  it("link round-trip: link, re-link moves, unlink removes; unknown project refused", () => {
    ctx.svc.createProject({ id: "prj_a", prefix: "A", name: "a" });
    ctx.svc.createProject({ id: "prj_b", prefix: "B", name: "b" });
    assert.deepEqual(ctx.svc.linkCheckout("/repo", "prj_a"), { gitRoot: "/repo", projectId: "prj_a" });
    assert.deepEqual(ctx.svc.linkCheckout("/repo", "prj_b"), { gitRoot: "/repo", projectId: "prj_b" });
    assert.equal(ctx.svc.listLinks().length, 1);
    assert.equal(ctx.svc.unlinkCheckout("/repo"), true);
    assert.equal(ctx.svc.unlinkCheckout("/repo"), false);
    assert.throws(() => ctx.svc.linkCheckout("/repo", "prj_nope"), /unknown project/);
    assert.throws(() => ctx.svc.linkCheckout("  "), /not inside a git checkout/);
  });

  it("link without --project infers exactly-one, requires explicit with several", () => {
    ctx.svc.createProject({ id: "prj_only", prefix: "ONLY", name: "only" });
    assert.deepEqual(ctx.svc.linkCheckout("/repo"), { gitRoot: "/repo", projectId: "prj_only" });
    ctx.svc.createProject({ id: "prj_second", prefix: "SECOND", name: "second" });
    assert.throws(() => ctx.svc.linkCheckout("/other"), /pass --project/);
  });

  it("dangling link -> resolution fails with re-link guidance", () => {
    // FK normally prevents this; force the dangling row to prove the
    // defensive catch (e.g. a DB edited with FK off).
    ctx.db.exec("PRAGMA foreign_keys = OFF");
    ctx.db.prepare("INSERT INTO checkout_links (git_root, project_id, linked_at) VALUES (?, ?, ?)").run("/repo", "prj_gone", Date.now());
    ctx.db.exec("PRAGMA foreign_keys = ON");
    assert.throws(() => ctx.svc.resolveProject({ gitRoot: "/repo" }), /re-link this checkout/);
  });

  it("CLI: real git checkout links, then flagless list/show/tree/ready resolve (freshness probe)", () => {
    const repo = mkdtempSync(join(tmpdir(), "sb-linked-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: repo });
      const cli = (argv: string[]): unknown => {
        const res = runCli(["--db", ctx.dbPath, "--json", ...argv]);
        assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
        const env = JSON.parse(res.stdout) as { schema: string; ok: boolean; data: unknown };
        assert.equal(env.schema, SCHEMA_VERSION);
        assert.equal(env.ok, true);
        return env.data;
      };
      const prev = process.cwd();
      process.chdir(repo);
      try {
        // unlinked checkout with zero projects: fail-closed with guidance
        const bare = runCli(["--db", ctx.dbPath, "--json", "issue", "list"]);
        assert.equal(bare.code, 1);
        assert.match(bare.stdout, /Run `sb init`/);
        // create + explicit link from inside the checkout (project link
        // never infers: bare `project link` refuses even with one project)
        const project = cli(["project", "create", "--prefix", "LINK", "--name", "linked"]) as { id: string };
        const linked = cli(["project", "link", "--project", project.id]) as { gitRoot: string; projectId: string };
        assert.equal(linked.projectId, project.id);
        // service write -> linked CLI read (freshness: no cached resolution)
        const cpath = join(repo, "c.json");
        writeFileSync(cpath, JSON.stringify({ ...contract(), problem: "P", success: "S" }));
        const created = cli(["issue", "create", "--title", "T", "--kind", "task", "--contract", cpath]) as { humanRef: string };
        const listed = cli(["issue", "list"]) as Array<{ humanRef: string }>;
        assert.ok(listed.some((i) => i.humanRef === created.humanRef));
        const shown = cli(["issue", "show", created.humanRef]) as { humanRef: string };
        assert.equal(shown.humanRef, created.humanRef);
        const ready = cli(["issue", "ready"]) as unknown[];
        assert.ok(Array.isArray(ready));
        const human = runCli(["--db", ctx.dbPath, "issue", "tree"]);
        assert.equal(human.code, 0, human.stderr);
        assert.ok(human.stdout.includes(created.humanRef));
        // explicit --project still wins over the link
        ctx.svc.createProject({ id: "prj_other", prefix: "OTHER", name: "other" });
        const scoped = cli(["issue", "list", "--project", "prj_other"]) as unknown[];
        assert.equal(scoped.length, 0);
      } finally {
        process.chdir(prev);
      }
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
