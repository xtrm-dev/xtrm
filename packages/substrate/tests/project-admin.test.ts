import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { runCli, discoverRepository, SCHEMA_VERSION } from "../cli/sb.ts";
import { contract } from "./helpers.ts";

// Low-level project administration (ADR sbcloseout4 §18, R3): `sb project`
// is an advanced/recovery surface, never the normal onboarding workflow
// (`sb init`). Covers list/show/links/repair, explicit link --project, the
// bare-link refusal (no sole-Project inference), per-verb help markers, and
// the alias-corruption recovery round-trip without renumbering Issues.

function setup(): { dir: string; dbPath: string; svc: IssueService; db: ReturnType<typeof openSubstrate> } {
  const dir = mkdtempSync(join(tmpdir(), "sb-projadmin-"));
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  return { dir, dbPath, svc: new IssueService(db), db };
}

function cli(dbPath: string, argv: string[]): unknown {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr || res.stdout}`);
  const env = JSON.parse(res.stdout) as { schema: string; command: string; ok: boolean; data: unknown };
  assert.equal(env.schema, SCHEMA_VERSION);
  assert.equal(env.ok, true);
  return env.data;
}

function fails(dbPath: string, argv: string[]): string {
  const res = runCli(["--db", dbPath, "--json", ...argv]);
  assert.equal(res.code, 1, `sb ${argv.join(" ")} should have failed`);
  const env = JSON.parse(res.stdout) as { schema: string; ok: boolean; error: string };
  assert.equal(env.ok, false);
  return env.error;
}

function withGitRepo(fn: (repo: string) => void): void {
  const repo = mkdtempSync(join(tmpdir(), "sb-projadmin-repo-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["remote", "add", "origin", "https://github.com/test/projadmin-recovery.git"], { cwd: repo });
    const prev = process.cwd();
    process.chdir(repo);
    try {
      fn(repo);
    } finally {
      process.chdir(prev);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

describe("sb project administration (R3)", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });
  afterEach(() => {
    ctx.db.close();
    rmSync(ctx.dir, { recursive: true, force: true });
  });

  it("list returns every project; show --project reports identity plus bindings", () => {
    ctx.svc.createProject({ id: "prj_a", prefix: "A", name: "a" });
    ctx.svc.createProject({ id: "prj_b", prefix: "B", name: "b" });
    const listed = cli(ctx.dbPath, ["project", "list"]) as Array<{ id: string; prefix: string; name: string }>;
    assert.deepEqual(listed.map((p) => p.id), ["prj_a", "prj_b"]);
    assert.deepEqual(listed.map((p) => p.prefix), ["A", "B"]);
    const shown = cli(ctx.dbPath, ["project", "show", "--project", "prj_a"]) as {
      id: string; prefix: string; name: string; source: string; bindings: unknown[];
    };
    assert.equal(shown.id, "prj_a");
    assert.equal(shown.prefix, "A");
    assert.equal(shown.source, "flag");
    assert.deepEqual(shown.bindings, []);
  });

  it("show without --project fails closed on an uninitialized checkout (never guesses)", () => {
    ctx.svc.createProject({ id: "prj_only", prefix: "ONLY", name: "only" });
    withGitRepo(() => {
      const error = fails(ctx.dbPath, ["project", "show"]);
      assert.match(error, /sb init/, "fail-closed guidance points at sb init");
    });
  });

  it("links lists checkout aliases; link --project is explicit; unlink removes", () => {
    ctx.svc.createProject({ id: "prj_a", prefix: "A", name: "a" });
    withGitRepo((repo) => {
      const linked = cli(ctx.dbPath, ["project", "link", "--project", "prj_a"]) as { gitRoot: string; projectId: string };
      assert.equal(linked.projectId, "prj_a");
      const links = cli(ctx.dbPath, ["project", "links"]) as {
        gitRoot: string; links: Array<{ gitRoot: string; projectId: string }>;
      };
      assert.equal(links.gitRoot, linked.gitRoot);
      assert.ok(links.links.some((l) => l.gitRoot === linked.gitRoot && l.projectId === "prj_a"));
      // The resolved project through the corrected resolver is the linked one.
      const shown = cli(ctx.dbPath, ["project", "show"]) as { id: string; source: string };
      assert.equal(shown.id, "prj_a");
      const unlinked = cli(ctx.dbPath, ["project", "unlink"]) as { gitRoot: string; unlinked: boolean };
      assert.equal(unlinked.unlinked, true);
      const after = cli(ctx.dbPath, ["project", "links"]) as { links: unknown[] };
      assert.equal(after.links.length, 0);
    });
  });

  it("bare `project link` refuses to infer the sole Project", () => {
    ctx.svc.createProject({ id: "prj_only", prefix: "ONLY", name: "only" });
    withGitRepo(() => {
      const error = fails(ctx.dbPath, ["project", "link"]);
      assert.match(error, /requires --project/, "bare link names the missing explicit flag");
      assert.match(error, /never infers/, "bare link states the no-inference rule");
      assert.match(error, /sb init/, "bare link points at the normal workflow");
      // Refusal wrote nothing: no alias was inferred.
      assert.deepEqual(ctx.svc.listLinks(), []);
    });
  });

  it("link --project with an unknown project fails without writing an alias", () => {
    ctx.svc.createProject({ id: "prj_a", prefix: "A", name: "a" });
    withGitRepo(() => {
      const error = fails(ctx.dbPath, ["project", "link", "--project", "prj_nope"]);
      assert.match(error, /unknown project/);
      assert.deepEqual(ctx.svc.listLinks(), []);
    });
  });

  it("unknown project verbs fail closed with the full verb list", () => {
    const error = fails(ctx.dbPath, ["project", "frobnicate"]);
    assert.match(error, /unknown project verb/);
    assert.match(error, /list\|show\|links\|repair/);
  });

  it("every project verb help is marked advanced/recovery and references sb init", () => {
    for (const argv of [
      ["help", "project"],
      ["help", "project", "create"],
      ["help", "project", "link"],
      ["help", "project", "unlink"],
      ["help", "project", "list"],
      ["help", "project", "show"],
      ["help", "project", "links"],
      ["help", "project", "repair"],
    ]) {
      const res = runCli(argv, { dbPath: join(mkdtempSync(join(tmpdir(), "sb-help-")), "x.db") });
      assert.equal(res.code, 0, `sb ${argv.join(" ")} failed: ${res.stderr}`);
      const text = res.stdout.replace(/\s+/g, " ");
      assert.match(text, /Advanced\/recovery/, `sb ${argv.join(" ")} must be marked advanced/recovery`);
      assert.match(text, /not the normal onboarding workflow/, `sb ${argv.join(" ")} must disclaim the normal workflow`);
      assert.match(text, /sb init/, `sb ${argv.join(" ")} must point at sb init`);
    }
  });

  it("recovery: corrupt the local alias, inspect with links, repair, resolve again without renumbering", () => {
    const savedProject = process.env["SUBSTRATE_PROJECT"];
    delete process.env["SUBSTRATE_PROJECT"];
    try {
      ctx.svc.createProject({ id: "prj_rec", prefix: "REC", name: "recovery" });
      ctx.svc.createProject({ id: "prj_decoy", prefix: "DECOY", name: "decoy" });
      withGitRepo((repo) => {
        const identity = discoverRepository().identity;
        assert.ok(identity, "the test checkout must yield a repository identity");
        // Seed the authority (repository binding) exactly as `sb init` would
        // record it, plus the local alias cache.
        ctx.db
          .prepare(
            "INSERT INTO repository_bindings (repository_key, project_id, base_branch, canonical_remote, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(identity.repositoryKey, "prj_rec", "main", identity.canonicalRemote, 1, 1);
        const root = discoverRepository().gitRoot!;
        ctx.svc.linkCheckout(root, "prj_rec");
        // One issue lives in the bound project; its reference is the
        // no-renumbering witness.
        const cpath = join(repo, "c.json");
        writeFileSync(cpath, JSON.stringify({ ...contract(), problem: "P", success: "S" }));
        const created = cli(ctx.dbPath, ["issue", "create", "--title", "T", "--kind", "task", "--contract", cpath, "--scrutiny", "LOW"]) as {
          humanRef: string;
        };
        assert.equal(created.humanRef, "REC-1");
        // Corrupt the local alias: point it at the decoy project.
        ctx.svc.linkCheckout(root, "prj_decoy");
        // Inspection shows the corruption (binding still says prj_rec).
        const links = cli(ctx.dbPath, ["project", "links"]) as {
          links: Array<{ gitRoot: string; projectId: string }>;
        };
        assert.ok(links.links.some((l) => l.gitRoot === root && l.projectId === "prj_decoy"));
        const shown = cli(ctx.dbPath, ["project", "show", "--project", "prj_rec"]) as {
          id: string; bindings: Array<{ repositoryKey: string }>;
        };
        assert.ok(shown.bindings.some((b) => b.repositoryKey === identity.repositoryKey));
        // Repair re-establishes the alias from the binding and verifies.
        const repaired = cli(ctx.dbPath, ["project", "repair"]) as {
          gitRoot: string; repositoryKey: string; projectId: string; previous: string | null; repaired: boolean; source: string;
        };
        assert.equal(repaired.projectId, "prj_rec");
        assert.equal(repaired.previous, "prj_decoy");
        assert.equal(repaired.repaired, true);
        // The repository resolves again through the corrected resolver, and
        // the issue reference is unchanged (no renumbering: repair touches
        // bindings/aliases only).
        const resolved = cli(ctx.dbPath, ["project", "show"]) as { id: string; source: string };
        assert.equal(resolved.id, "prj_rec");
        assert.equal(resolved.source, "binding");
        const listed = cli(ctx.dbPath, ["issue", "list"]) as Array<{ humanRef: string }>;
        assert.ok(listed.some((i) => i.humanRef === "REC-1"), "REC-1 still resolves after repair");
        // Repair is idempotent: a healthy checkout reports repaired:false.
        const again = cli(ctx.dbPath, ["project", "repair"]) as { repaired: boolean; previous: string | null };
        assert.equal(again.repaired, false);
        assert.equal(again.previous, "prj_rec");
      });
    } finally {
      if (savedProject !== undefined) process.env["SUBSTRATE_PROJECT"] = savedProject;
    }
  });

  it("repair without a repository binding fails closed into sb init and writes nothing", () => {
    ctx.svc.createProject({ id: "prj_a", prefix: "A", name: "a" });
    withGitRepo(() => {
      const error = fails(ctx.dbPath, ["project", "repair"]);
      assert.match(error, /no binding/, "repair states the missing authority");
      assert.match(error, /sb init/, "repair points at sb init");
      assert.deepEqual(ctx.svc.listLinks(), [], "failed repair writes no alias");
    });
  });
});
