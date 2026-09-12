// Multi-repository isolation acceptance (ADR §85; bead XTRM-252.2). Release
// blocking: an uninitialized repository must fail closed with the `sb init`
// guidance and must never see or mutate another repository's Issues, while an
// explicit override keeps deliberate cross-project work possible.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { contract, repoEnv, type RepoEnv } from "./helpers.ts";

describe("multi-repository isolation (ADR §85)", () => {
  let env: RepoEnv;
  before(() => {
    env = repoEnv("sb-iso-");
  });
  after(() => {
    env.restore();
  });

  function createIssue(dir: string, title: string): string {
    const contractFile = join(env.temp("sb-iso-c-"), `${title}.json`);
    writeFileSync(contractFile, JSON.stringify(contract({ problem: title, success: title })));
    const res = env.inCwd(dir, () => env.run(["issue", "create", "--title", title, "--kind", "task", "--contract", contractFile]));
    assert.equal(res.code, 0, res.stderr || res.stdout);
    return (res.data as { humanRef: string }).humanRef;
  }

  it("uninitialized repository fails closed with the `sb init` guidance and leaks nothing", () => {
    const a = env.gitRepo("alpha");
    assert.equal(env.inCwd(a, () => env.run(["init"])).code, 0, "repo A initializes");
    const ref = createIssue(a, "alpha work");
    assert.equal(ref, "ALPHA-1");
    const b = env.gitRepo("beta");

    const list = env.inCwd(b, () => env.run(["issue", "list"]));
    assert.equal(list.code, 1);
    assert.match(list.error ?? "", /not initialized for Substrate/);
    assert.match(list.error ?? "", /Run `sb init`/);
    assert.ok(!list.stdout.includes("ALPHA-1"), "an uninitialized repository must not return another Project's Issues");

    // The same fail-closed rule covers ready/tree/create/planning and the
    // ref-scoped mutations (ADR §5).
    assert.equal(env.inCwd(b, () => env.run(["issue", "ready"])).code, 1);
    assert.equal(env.inCwd(b, () => env.run(["issue", "tree"])).code, 1);
    assert.match(env.inCwd(b, () => env.run(["issue", "create", "--title", "x", "--kind", "task", "--contract", "{}"])).error ?? "", /Run `sb init`/);
    const claim = env.inCwd(b, () => env.run(["issue", "claim", "ALPHA-1", "--holder", "intruder"]));
    assert.equal(claim.code, 1);
    assert.match(claim.error ?? "", /Run `sb init`/);
    const close = env.inCwd(b, () => env.run(["issue", "close", "ALPHA-1"]));
    assert.equal(close.code, 1);
    assert.match(close.error ?? "", /Run `sb init`/);
    const note = env.inCwd(b, () => env.run(["journal", "append", "ALPHA-1", "--kind", "finding"]));
    assert.equal(note.code, 1);
    assert.match(note.error ?? "", /Run `sb init`/);
  });

  it("after init in B, A sees only A's Issues and B only B's", () => {
    const a = env.gitRepo("gamma");
    assert.equal(env.inCwd(a, () => env.run(["init"])).code, 0, "repo A initializes");
    const aRef = createIssue(a, "gamma work");
    const b = env.gitRepo("delta");
    const bInit = env.inCwd(b, () => env.run(["init"]));
    assert.equal(bInit.code, 0, bInit.stderr || bInit.stdout);
    const bRef = createIssue(b, "delta work");
    assert.equal(aRef, "GAMMA-1");
    assert.equal(bRef, "DELTA-1");

    const inA = env.inCwd(a, () => env.run(["issue", "list"]));
    assert.equal(inA.code, 0, inA.stderr || inA.stdout);
    assert.deepEqual((inA.data as Array<{ humanRef: string }>).map((i) => i.humanRef), ["GAMMA-1"]);
    const inB = env.inCwd(b, () => env.run(["issue", "list"]));
    assert.equal(inB.code, 0, inB.stderr || inB.stdout);
    assert.deepEqual((inB.data as Array<{ humanRef: string }>).map((i) => i.humanRef), ["DELTA-1"]);
  });

  it("a cross-project ref is refused from an initialized repository unless the Project is selected deliberately", () => {
    const a = env.gitRepo("epsilon");
    assert.equal(env.inCwd(a, () => env.run(["init"])).code, 0, "repo A initializes");
    createIssue(a, "epsilon work");
    const b = env.gitRepo("zeta");
    assert.equal(env.inCwd(b, () => env.run(["init"])).code, 0);
    createIssue(b, "zeta work");

    const refused = env.inCwd(a, () => env.run(["issue", "close", "ZETA-1"]));
    assert.equal(refused.code, 1, "wrong-project mutation must fail closed (ADR §5)");
    assert.match(refused.error ?? "", /belongs to project prj_zeta, not the effective project prj_epsilon/);
    assert.match(refused.error ?? "", /pass --project prj_zeta/);
    // The deliberate override still works (ADR §16).
    const deliberate = env.inCwd(a, () => env.run(["issue", "close", "ZETA-1", "--project", "prj_zeta"]));
    assert.equal(deliberate.code, 0, deliberate.stderr || deliberate.stdout);
    assert.equal((deliberate.data as { lifecycleState: string }).lifecycleState, "done");
  });

  it("planning and provenance mutations are project-scoped too (ADR §5)", () => {
    const a = env.gitRepo("eta");
    assert.equal(env.inCwd(a, () => env.run(["init"])).code, 0);
    const b = env.gitRepo("theta");
    assert.equal(env.inCwd(b, () => env.run(["init"])).code, 0);
    createIssue(b, "theta work");

    const planPath = join(env.temp("sb-iso-plan-"), "plan.json");
    writeFileSync(
      planPath,
      JSON.stringify({
        planKey: "iso-plan",
        issues: [{ key: "x", projectId: "prj_theta", title: "X", kind: "task", contract: contract(), scrutiny: "LOW" }],
      }),
    );
    const refused = env.inCwd(a, () => env.run(["plan", "apply", "--file", planPath]));
    assert.equal(refused.code, 1, "a plan may not cross Projects by accident");
    assert.match(refused.error ?? "", /belongs to project prj_theta, not the effective project prj_eta/);
    const deliberate = env.inCwd(a, () => env.run(["plan", "apply", "--file", planPath, "--project", "prj_theta"]));
    assert.equal(deliberate.code, 0, deliberate.stderr || deliberate.stdout);

    const provRefused = env.inCwd(a, () => env.run(["provenance", "dispatch", "THETA-1", "--participant", "p"]));
    assert.equal(provRefused.code, 1, "provenance mutation must be project-scoped");
    assert.match(provRefused.error ?? "", /belongs to project prj_theta/);
  });
});
