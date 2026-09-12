// Override acceptance (ADR §§16-17, 91; bead XTRM-252.2) and the
// `source:"single"` regression. An override changes the effective command
// context only: it never binds the checkout or repository, never makes
// `sb doctor` report the repository initialized, and `sb init` still
// initializes the repository.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { contract, repoEnv, type RepoEnv } from "./helpers.ts";

interface DoctorData {
  project: { id: string; prefix: string; name: string } | null;
  projectError: string | null;
  effectiveOverride: string | null;
  repository: { repositoryKey: string | null; gitRoot: string | null; initialized: boolean; baseBranch: string | null };
  link: { projectId: string; source: string; gitRoot: string | null } | null;
  linkError: string | null;
}

function withProject<T>(projectId: string | undefined, fn: () => T): T {
  const saved = process.env["SUBSTRATE_PROJECT"];
  if (projectId === undefined) delete process.env["SUBSTRATE_PROJECT"];
  else process.env["SUBSTRATE_PROJECT"] = projectId;
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env["SUBSTRATE_PROJECT"];
    else process.env["SUBSTRATE_PROJECT"] = saved;
  }
}

describe("override acceptance (ADR §91)", () => {
  let env: RepoEnv;
  before(() => {
    env = repoEnv("sb-ovr-");
  });
  after(() => {
    env.restore();
  });

  it("SUBSTRATE_PROJECT grants intentional access while doctor stays uninitialized; sb init still binds", () => {
    const a = env.gitRepo("alpha");
    const initA = env.inCwd(a, () => env.run(["init"]));
    assert.equal(initA.code, 0, initA.stderr || initA.stdout);
    const contractFile = join(env.temp("sb-ovr-c-"), "c.json");
    writeFileSync(contractFile, JSON.stringify(contract({ problem: "alpha", success: "alpha" })));
    const created = env.inCwd(a, () => env.run(["issue", "create", "--title", "alpha work", "--kind", "task", "--contract", contractFile]));
    assert.equal(created.code, 0, created.stderr || created.stdout);

    const b = env.gitRepo("beta");

    // Intentional cross-project access from an uninitialized repository.
    const list = env.inCwd(b, () => withProject("prj_alpha", () => env.run(["issue", "list"])));
    assert.equal(list.code, 0, list.stderr || list.stdout);
    assert.deepEqual((list.data as Array<{ humanRef: string }>).map((i) => i.humanRef), ["ALPHA-1"]);

    // The override does not initialize the repository and does not bind it.
    const doctor = env.inCwd(b, () => withProject("prj_alpha", () => env.run(["doctor"])));
    assert.equal(doctor.code, 0, doctor.stderr || doctor.stdout);
    const data = doctor.data as DoctorData;
    assert.equal(data.repository.initialized, false, "an override must never claim the repository is initialized");
    assert.equal(data.effectiveOverride, "prj_alpha");
    assert.equal(data.project, null, "uninitialized repository has no bound Project");
    assert.equal(data.link?.projectId, "prj_alpha");
    assert.ok(!doctor.stdout.includes('"single"'), "doctor must not emit the removed single-project source");

    const db = openSubstrate(env.dbPath);
    try {
      const bound = db.prepare("SELECT repository_key, project_id FROM repository_bindings").all() as Array<{ repository_key: string }>;
      assert.equal(bound.length, 1);
      assert.ok(!bound.some((r) => r.repository_key === `local:${realpathSync(b)}`), "the override must not create a binding");
    } finally {
      db.close();
    }

    // `sb init` still initializes the repository rather than accepting the
    // override as a binding (ADR §91).
    const initB = env.inCwd(b, () => withProject("prj_alpha", () => env.run(["init"])));
    assert.equal(initB.code, 0, initB.stderr || initB.stdout);
    const initData = initB.data as { project: { id: string }; created: boolean };
    assert.equal(initData.project.id, "prj_beta");
    assert.equal(initData.created, true);

    // Afterwards the two facts stay separate: bound Project vs override.
    const doctor2 = env.inCwd(b, () => withProject("prj_alpha", () => env.run(["doctor"])));
    const data2 = doctor2.data as DoctorData;
    assert.equal(data2.repository.initialized, true);
    assert.equal(data2.repository.repositoryKey, `local:${realpathSync(b)}`);
    assert.equal(data2.project?.id, "prj_beta");
    assert.equal(data2.effectiveOverride, "prj_alpha");
  });

  it("a checkout link alone never makes doctor report the repository initialized", () => {
    const a = env.gitRepo("linked-src");
    assert.equal(env.inCwd(a, () => env.run(["init"])).code, 0);
    const projectId = "prj_linked_src";

    const c = env.gitRepo("linked-alias");
    const link = env.inCwd(c, () => env.run(["project", "link", "--project", projectId]));
    assert.equal(link.code, 0, link.stderr || link.stdout);

    const doctor = env.inCwd(c, () => env.run(["doctor"]));
    const data = doctor.data as DoctorData;
    assert.equal(data.repository.initialized, false, "checkout_links is an alias/cache, not initialization");
    assert.equal(data.project, null);
    assert.equal(data.link?.projectId, projectId);
    assert.equal(data.link?.source, "link");
  });

  it("source:\"single\" no longer exists in resolver output or in issue-service.ts", () => {
    const db = openSubstrate(env.dbPath);
    try {
      const svc = new IssueService(db);
      svc.createProject({ id: "prj_solo", prefix: "SOLO", name: "solo" });
      svc.linkCheckout("/solo-checkout", "prj_solo");
      db.prepare(
        "INSERT INTO repository_bindings (repository_key, project_id, base_branch, canonical_remote, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run("github.com/solo/repo", "prj_solo", "main", "github.com/solo/repo", 1, 1);
      const results = [
        svc.resolveProject({ explicit: "prj_solo" }),
        svc.resolveProject({ env: "prj_solo" }),
        svc.resolveProject({ repositoryKey: "github.com/solo/repo" }),
        svc.resolveProject({ gitRoot: "/solo-checkout" }),
      ];
      for (const r of results) {
        assert.notEqual(r.source, "single");
        assert.ok(!JSON.stringify(r).includes('"single"'));
      }
      assert.deepEqual(results.map((r) => r.source), ["flag", "env", "binding", "link"]);
      // Exactly one Project exists; it is still never inferred from cardinality.
      assert.throws(() => svc.resolveProject({}), /Run `sb init`/);
    } finally {
      db.close();
    }
    const source = readFileSync(join(import.meta.dirname, "..", "src", "service", "issue-service.ts"), "utf8");
    assert.ok(!source.includes('"single"'), "issue-service.ts must not carry the single-project source");
  });
});
