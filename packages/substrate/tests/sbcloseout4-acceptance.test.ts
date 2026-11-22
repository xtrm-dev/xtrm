// A1 terminal adversarial acceptance (XTRM-252.14, ADR sbcloseout4 §§84-98, §102-§103).
//
// Runs on merged main with an isolated HOME. Every test uses the repository-
// relative harness (tests/helpers.ts `repoEnv`), which sets HOME to a fresh
// temp directory, GIT_CONFIG_GLOBAL=/dev/null, GIT_CONFIG_NOSYSTEM=1, deletes
// SUBSTRATE_PROJECT, and passes an explicit temp --db plus SUBSTRATE_DB as a
// belt. The live store (~/.xtrm/state.db) and the real HOME are never read or
// written. All CLI access goes through the MIRROR's in-process CLI
// (`../cli/sb.ts` runCli, invoked here as `node cli/sb.ts` would invoke it),
// never the PATH `sb`, which is a different, older main-checkout build.
//
// Evidence only: no runtime implementation lives in this file. Failures found
// by this suite become child issues for the coordinator to file.
//
// Single run command (from packages/substrate, isolated HOME):
//   HOME=$(mktemp -d) SUBSTRATE_DB=$(mktemp -u --suffix=-a1-state.db) \
//     GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
//     node --test tests/sbcloseout4-acceptance.test.ts
// or via the wrapper:
//   ./scripts/run-sbcloseout4-acceptance.sh
//
// Transcript: docs/substrate/sbcloseout4-acceptance-transcript.md
// Closeout:   docs/substrate/sbcloseout4-closeout.md

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, realpathSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { ResumeService } from "../src/service/resume-service.ts";
import { ProvenanceService } from "../src/service/provenance-service.ts";
import { ClosureService } from "../src/service/closure-service.ts";
import { CLOSURE_OUTCOMES } from "../src/domain/closure.ts";
import { JOURNAL_KINDS } from "../src/domain/journal.ts";
import { normalizeRemote } from "../src/domain/repository.ts";
import { contract, repoEnv, type RepoEnv } from "./helpers.ts";

function contractFile(env: RepoEnv, name: string, problem = "A1 problem", success = "A1 success"): string {
  const p = join(env.temp("sb-a1-c-"), name);
  writeFileSync(p, JSON.stringify(contract({ problem, success })));
  return p;
}

function createInRepo(env: RepoEnv, repo: string, title: string, kind = "task"): string {
  const c = contractFile(env, `${title.replace(/[^a-z0-9]+/gi, "-")}.json`, `${title} problem`, `${title} success`);
  const res = env.inCwd(repo, () => env.run(["issue", "create", "--title", title, "--kind", kind, "--contract", c, "--scrutiny", "LOW"]));
  assert.equal(res.code, 0, `create ${title}: ${res.stderr || res.stdout}`);
  return (res.data as { humanRef: string; id: string }).humanRef;
}

function attestInRepo(env: RepoEnv, repo: string, ref: string): void {
  const r = env.inCwd(repo, () => env.run(["issue", "attest", ref, "--outcome", "ready", "--policy", "default", "--attested-by", "a1"]));
  assert.equal(r.code, 0, `attest ${ref}: ${r.stderr || r.stdout}`);
}

// XTRM-448: this suite asserts hermetic counts, so ambient identity env exported
// by the operator shell must not leak in (XTRM_SESSION_NAME made it fail 741/1;
// scrubbed it passes). Same save/delete/restore pattern as tests/journal.test.ts.
const EPHEMERAL_IDENTITY_ENV = [
  "XTRM_SESSION_ID",
  "XTRM_SESSION_NAME",
  "SUBSTRATE_HOLDER",
  "SUBSTRATE_ACTIVATION_ID",
] as const;
const savedIdentityEnv = new Map<string, string | undefined>();
for (const key of EPHEMERAL_IDENTITY_ENV) {
  savedIdentityEnv.set(key, process.env[key]);
  delete process.env[key];
}
after(() => {
  for (const [key, value] of savedIdentityEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// ---------------------------------------------------------------------------
// §§84-91: repository authority (each block owns its env for hermetic counts)
// ---------------------------------------------------------------------------

describe("A1 §84 fresh-repository onboarding", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-84-"); });
  after(() => { env.restore(); });

  it("sb init detects, binds, detects base branch, works flagless, is idempotent", () => {
    const repo = env.gitRepo("a1service");
    const root = realpathSync(repo);
    const first = env.inCwd(repo, () => env.run(["init"]));
    assert.equal(first.code, 0, first.stderr || first.stdout);
    const init = first.data as {
      repository: { repositoryKey: string; canonicalRemote: string | null; local: boolean; gitRoot: string };
      project: { id: string; prefix: string; name: string };
      baseBranch: string | null; created: boolean; adopted: boolean; idempotent: boolean;
    };
    assert.equal(init.repository.repositoryKey, `local:${root}`);
    assert.equal(init.repository.canonicalRemote, null);
    assert.equal(init.repository.local, true);
    assert.equal(init.repository.gitRoot, root);
    assert.deepEqual(init.project, { id: "prj_a1service", prefix: "A1SERVICE", name: "a1service" });
    assert.equal(init.baseBranch, "main");
    assert.equal(init.created, true);
    assert.equal(init.adopted, false);
    assert.equal(init.idempotent, false);

    const ref = createInRepo(env, repo, "onboarded work");
    assert.equal(ref, "A1SERVICE-1");
    const listed = env.inCwd(repo, () => env.run(["issue", "list"]));
    assert.equal(listed.code, 0, listed.stderr || listed.stdout);
    assert.deepEqual((listed.data as Array<{ humanRef: string }>).map((i) => i.humanRef), ["A1SERVICE-1"]);

    const second = env.inCwd(repo, () => env.run(["init"]));
    assert.equal(second.code, 0, second.stderr || second.stdout);
    const again = second.data as typeof init;
    assert.equal(again.project.id, "prj_a1service");
    assert.equal(again.created, false);
    assert.equal(again.idempotent, true);
  });
});

describe("A1 §85 multi-repository isolation (release blocking)", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-85-"); });
  after(() => { env.restore(); });

  it("uninitialized repository fails closed with sb init guidance and leaks nothing", () => {
    const a = env.gitRepo("a1alpha");
    assert.equal(env.inCwd(a, () => env.run(["init"])).code, 0);
    const ref = createInRepo(env, a, "alpha work");
    assert.equal(ref, "A1ALPHA-1");
    const b = env.gitRepo("a1beta");

    const list = env.inCwd(b, () => env.run(["issue", "list"]));
    assert.equal(list.code, 1, "uninitialized repo must fail closed");
    assert.match(list.error ?? "", /not initialized for Substrate/);
    assert.match(list.error ?? "", /Run `sb init`/);
    assert.ok(!list.stdout.includes("A1ALPHA-1"), "must not return another Project's Issues");

    assert.equal(env.inCwd(b, () => env.run(["issue", "ready"])).code, 1);
    assert.equal(env.inCwd(b, () => env.run(["issue", "tree"])).code, 1);
    const claim = env.inCwd(b, () => env.run(["issue", "claim", "A1ALPHA-1", "--holder", "intruder"]));
    assert.equal(claim.code, 1);
    assert.match(claim.error ?? "", /Run `sb init`/);
    const close = env.inCwd(b, () => env.run(["issue", "close", "A1ALPHA-1"]));
    assert.equal(close.code, 1);
    assert.match(close.error ?? "", /Run `sb init`/);
  });

  it("after init in B, A sees only A and B only B", () => {
    const a = env.gitRepo("a1gamma");
    assert.equal(env.inCwd(a, () => env.run(["init"])).code, 0);
    const aRef = createInRepo(env, a, "gamma work");
    const b = env.gitRepo("a1delta");
    assert.equal(env.inCwd(b, () => env.run(["init"])).code, 0);
    const bRef = createInRepo(env, b, "delta work");
    assert.equal(aRef, "A1GAMMA-1");
    assert.equal(bRef, "A1DELTA-1");
    const inA = env.inCwd(a, () => env.run(["issue", "list"]));
    assert.equal(inA.code, 0, inA.stderr || inA.stdout);
    assert.deepEqual((inA.data as Array<{ humanRef: string }>).map((i) => i.humanRef), ["A1GAMMA-1"]);
    const inB = env.inCwd(b, () => env.run(["issue", "list"]));
    assert.equal(inB.code, 0, inB.stderr || inB.stdout);
    assert.deepEqual((inB.data as Array<{ humanRef: string }>).map((i) => i.humanRef), ["A1DELTA-1"]);
  });
});

describe("A1 §86 worktree resolution", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-86-"); });
  after(() => { env.restore(); });

  it("main, linked and detached worktrees resolve one Project", () => {
    const main = env.gitRepo("a1wt", { remote: "git@github.com:acme/a1wt.git" });
    const linked = join(env.temp("sb-a1-86-l-"), "linked");
    const detached = join(env.temp("sb-a1-86-d-"), "detached");
    env.git(main, ["worktree", "add", "-q", "-b", "feature/x", linked]);
    env.git(main, ["worktree", "add", "-q", "--detach", detached]);

    const init = env.inCwd(linked, () => env.run(["init"]));
    assert.equal(init.code, 0, init.stderr || init.stdout);
    const data = init.data as { baseBranch: string | null; project: { id: string } };
    assert.equal(data.baseBranch, "main");
    assert.notEqual(data.baseBranch, "feature/x");

    for (const dir of [main, linked, detached]) {
      const list = env.inCwd(dir, () => env.run(["issue", "list"]));
      assert.equal(list.code, 0, `${dir}: ${list.stderr || list.stdout}`);
      assert.deepEqual(list.data, []);
    }
    const ref = createInRepo(env, detached, "wt work");
    assert.equal(ref, "A1WT-1");
    const fromMain = env.inCwd(main, () => env.run(["issue", "list"]));
    assert.deepEqual((fromMain.data as Array<{ humanRef: string }>).map((i) => i.humanRef), ["A1WT-1"]);
  });
});

describe("A1 §87 multi-clone identity", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-87-"); });
  after(() => { env.restore(); });

  it("two checkouts of one canonical remote share one Project", () => {
    const origin = env.gitRepo("a1origin");
    const cloneA = join(env.temp("sb-a1-87-a-"), "cloneA");
    const cloneB = join(env.temp("sb-a1-87-b-"), "cloneB");
    env.git(origin, ["clone", "-q", origin, cloneA]);
    env.git(origin, ["clone", "-q", origin, cloneB]);
    env.git(cloneA, ["remote", "set-url", "origin", "git@github.com:acme/a1shared.git"]);
    env.git(cloneB, ["remote", "set-url", "origin", "https://github.com/acme/a1shared.git"]);

    const a = env.inCwd(cloneA, () => env.run(["init"]));
    assert.equal(a.code, 0, a.stderr || a.stdout);
    assert.equal((a.data as { repository: { repositoryKey: string } }).repository.repositoryKey, "github.com/acme/a1shared");
    const ref = createInRepo(env, cloneA, "shared work");
    assert.equal(ref, "A1SHARED-1");
    const preInit = env.inCwd(cloneB, () => env.run(["issue", "list"]));
    assert.equal(preInit.code, 0, preInit.stderr || preInit.stdout);
    assert.deepEqual((preInit.data as Array<{ humanRef: string }>).map((i) => i.humanRef), ["A1SHARED-1"]);
    const b = env.inCwd(cloneB, () => env.run(["init"]));
    assert.equal(b.code, 0, b.stderr || b.stdout);
    assert.equal((b.data as { project: { id: string } }).project.id, "prj_a1shared");
  });
});

describe("A1 §88 remote normalization and credential stripping", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-88-"); });
  after(() => { env.restore(); });

  it("equivalent remote forms share one key; credentials never persist", () => {
    const secret = "ghp_A1SECRET999";
    const forms = [
      "git@github.com:acme/a1tool.git",
      "https://github.com/acme/a1tool.git",
      "ssh://git@github.com/acme/a1tool.git",
      `https://x-access-token:${secret}@github.com/acme/a1tool.git`,
    ];
    for (const remote of forms) {
      assert.equal(normalizeRemote(remote), "github.com/acme/a1tool", `form: ${remote}`);
    }
    for (const remote of forms) {
      const repo = env.gitRepo("a1tool", { remote });
      const init = env.inCwd(repo, () => env.run(["init"]));
      assert.equal(init.code, 0, `${remote}: ${init.stderr || init.stdout}`);
      assert.equal((init.data as { repository: { repositoryKey: string } }).repository.repositoryKey, "github.com/acme/a1tool");
    }
    const db = openSubstrate(env.dbPath);
    try {
      const rows = JSON.stringify(db.prepare("SELECT * FROM repository_bindings").all());
      assert.ok(!rows.includes(secret), "credential must never be persisted");
      assert.ok(!rows.includes("@"), "userinfo must not survive");
    } finally {
      db.close();
    }
  });
});

describe("A1 §89 basename-collision determinism", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-89-"); });
  after(() => { env.restore(); });

  it("org-a/service and org-b/service get different deterministic Projects", () => {
    const repoA = env.gitRepo("a1svc-a", { remote: "git@github.com:org-a/a1svc.git" });
    const repoB = env.gitRepo("a1svc-b", { remote: "git@github.com:org-b/a1svc.git" });
    const initA = env.inCwd(repoA, () => env.run(["init"]));
    const initB = env.inCwd(repoB, () => env.run(["init"]));
    assert.equal(initA.code, 0, initA.stderr || initA.stdout);
    assert.equal(initB.code, 0, initB.stderr || initB.stdout);
    const idA = (initA.data as { project: { id: string } }).project.id;
    const idB = (initB.data as { project: { id: string } }).project.id;
    assert.notEqual(idA, idB, "collision must not share a Project");
    // XTRM-252.18: the old assertion was a disjunction that passed on either leg
    // alone, so it accepted any id shape. Pin determinism on BOTH ids and prove
    // the loser of the collision is owner-qualified: ids are `prj_<slug>` with no
    // random/hex suffix, the winner keeps the basename candidate, the loser takes
    // the owner-qualified candidate.
    for (const id of [idA, idB]) {
      assert.ok(!/_[0-9a-f]{4,}$/.test(id), `deterministic, not random: ${id}`);
    }
    assert.ok(idB.includes("org"), `the collision loser is owner-qualified: ${idB}`);
    // Second init of each stays stable.
    const againA = env.inCwd(repoA, () => env.run(["init"]));
    const againB = env.inCwd(repoB, () => env.run(["init"]));
    assert.equal((againA.data as { project: { id: string } }).project.id, idA, "the winner stays stable across re-init");
    assert.equal((againB.data as { project: { id: string } }).project.id, idB, "the loser stays stable across re-init");
    const refA = createInRepo(env, repoA, "a work");
    const refB = createInRepo(env, repoB, "b work");
    assert.notEqual(refA.split("-")[0], refB.split("-")[0]);
  });
});

describe("A1 §90 existing-store adoption without renumbering", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-90-"); });
  after(() => { env.restore(); });

  it("sb init adopts the existing Project, refs and history unchanged", () => {
    const db = openSubstrate(env.dbPath);
    let journalId = "";
    try {
      const svc = new IssueService(db);
      svc.createProject({ id: "prj_a1adopt", prefix: "A1ADOPT", name: "a1adopt" });
      const issue = svc.createIssue({ projectId: "prj_a1adopt", title: "pre-existing", kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "a1" });
      assert.equal(issue.humanRef, "A1ADOPT-1");
      const journal = new JournalService(db, svc);
      const entry = journal.appendEntry(issue.id, { kind: "finding", semantic: { summary: "pre-existing finding" } });
      journalId = entry.id;
    } finally {
      db.close();
    }
    const repo = env.gitRepo("a1adopt");
    const init = env.inCwd(repo, () => env.run(["init"]));
    assert.equal(init.code, 0, init.stderr || init.stdout);
    const data = init.data as { project: { id: string }; created: boolean; adopted: boolean };
    assert.equal(data.project.id, "prj_a1adopt");
    assert.equal(data.created, false);
    assert.equal(data.adopted, true);
    const listed = env.inCwd(repo, () => env.run(["issue", "list"]));
    assert.deepEqual((listed.data as Array<{ humanRef: string }>).map((i) => i.humanRef), ["A1ADOPT-1"]);
    const db2 = openSubstrate(env.dbPath);
    try {
      const svc2 = new IssueService(db2);
      assert.equal(svc2.resolveRef("A1ADOPT-1").humanRef, "A1ADOPT-1");
      const journal2 = new JournalService(db2, svc2);
      assert.equal(journal2.getEntry(journalId).id, journalId, "Journal preserved");
    } finally {
      db2.close();
    }
  });
});

describe("A1 §91 override semantics", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-91-"); });
  after(() => { env.restore(); });

  it("SUBSTRATE_PROJECT grants access but doctor stays uninitialized; init still binds", () => {
    const a = env.gitRepo("a1ovra");
    assert.equal(env.inCwd(a, () => env.run(["init"])).code, 0);
    createInRepo(env, a, "alpha work");
    const b = env.gitRepo("a1ovrb");
    const saved = process.env["SUBSTRATE_PROJECT"];
    process.env["SUBSTRATE_PROJECT"] = "prj_a1ovra";
    let list: ReturnType<RepoEnv["run"]>;
    let doctor: ReturnType<RepoEnv["run"]>;
    try {
      list = env.inCwd(b, () => env.run(["issue", "list"]));
      doctor = env.inCwd(b, () => env.run(["doctor"]));
    } finally {
      if (saved === undefined) delete process.env["SUBSTRATE_PROJECT"];
      else process.env["SUBSTRATE_PROJECT"] = saved;
    }
    assert.equal(list!.code, 0, list!.stderr || list!.stdout);
    assert.deepEqual((list!.data as Array<{ humanRef: string }>).map((i) => i.humanRef), ["A1OVRA-1"]);
    const doc = doctor!.data as { repository: { initialized: boolean }; effectiveOverride: string | null };
    assert.equal(doc.repository.initialized, false, "override never binds the repository");
    assert.equal(doc.effectiveOverride, "prj_a1ovra");
    assert.equal(env.inCwd(b, () => env.run(["init"])).code, 0, "xt init path still initializes");
    const doc2 = env.inCwd(b, () => env.run(["doctor"]));
    assert.equal((doc2.data as typeof doc).repository.initialized, true);
  });
});

// ---------------------------------------------------------------------------
// §§92-98: Journal, provenance, closure, identity
// ---------------------------------------------------------------------------

describe("A1 §92 three-session Journal end-to-end (no chat history)", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-92-"); });
  after(() => { env.restore(); });

  it("A claims/finds/decides/milestones/checkpoints; B resumes/dispatches/results/receipts/closes; C reconstructs everything", async () => {
    const repo = env.gitRepo("a1journey", { remote: "git@github.com:acme/a1journey.git" });
    assert.equal(env.inCwd(repo, () => env.run(["init"])).code, 0);
    const ref = createInRepo(env, repo, "journey work", "research");
    attestInRepo(env, repo, ref);

    // Session A: claim (with activation so the later dispatch matches the live holder) + finding + decision + milestone + checkpoint.
    const claimA = env.inCwd(repo, () => env.run(["issue", "claim", ref, "--holder", "session-a", "--activation", "act-a1-92"]));
    assert.equal(claimA.code, 0, claimA.stderr || claimA.stdout);
    for (const [kind, text] of [["finding", "SDK loads separate CJS and ESM instances"], ["decision", "Use the official SDK server"], ["milestone", "Implementation complete; validation starting"]] as const) {
      const r = env.inCwd(repo, () => env.run(["issue", "note", ref, text, "--kind", kind]));
      assert.equal(r.code, 0, `${kind}: ${r.stderr || r.stdout}`);
    }
    const semFile = join(env.temp("sb-a1-92-"), "sem.json");
    writeFileSync(semFile, JSON.stringify({ summary: "session A checkpoint", completed: ["findings"], next: ["specialist run"] }));
    const cp = env.inCwd(repo, () => env.run(["journal", "checkpoint", ref, "--semantic", semFile]));
    assert.equal(cp.code, 0, cp.stderr || cp.stdout);

    // Session B: resume, dispatch, automatic result, receipt, close.
    const capsule = env.inCwd(repo, () => env.run(["issue", "resume", ref]));
    assert.equal(capsule.code, 0, capsule.stderr || capsule.stdout);
    const dispatch = env.inCwd(repo, () => env.run(["provenance", "dispatch", ref, "--participant", "session-a", "--activation", "act-a1-92", "--attempt", "att-1"]));
    assert.equal(dispatch.code, 0, dispatch.stderr || dispatch.stdout);
    const bindingId = (dispatch.data as { bindingId: string }).bindingId;
    assert.ok(bindingId);

    const resultFile = join(env.temp("sb-a1-92-"), "result.json");
    writeFileSync(resultFile, JSON.stringify({ summary: "specialist completed the bounded run", outcome: "completed", completed: ["analysis"], validation: ["manual review"] }));
    const result = env.inCwd(repo, () => env.run(["journal", "append", ref, "--kind", "result", "--result", resultFile]));
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const resultId = (result.data as { id: string }).id;
    assert.ok(resultId);

    // Receipt + artifact are host-owned (service), then cited at close.
    const db = openSubstrate(env.dbPath);
    let receiptId = "";
    try {
      const svc = new IssueService(db);
      const prov = new ProvenanceService(db, svc);
      const binding = prov.listBindings(svc.resolveRef(ref).id).find((x) => x.id === bindingId)!;
      assert.ok(binding);
      const receipt = prov.allocateReceipt(binding.id);
      receiptId = receipt.id;
      prov.bindCommit(receipt.id, "a".repeat(40));
      prov.attachArtifact(receipt.id, "pr", "github:acme/a1journey#7", { provider: "github" });
    } finally {
      db.close();
    }
    const close = env.inCwd(repo, () => env.run(["issue", "close", ref, "--outcome", "completed", "--reason", "Implemented and validated", "--actor", "session-b", "--result", resultId, "--receipt", receiptId]));
    assert.equal(close.code, 0, close.stderr || close.stdout);

    // Session C: reconstruct without any chat transcript.
    const shown = env.inCwd(repo, () => env.run(["issue", "show", ref]));
    assert.equal(shown.code, 0, shown.stderr || shown.stdout);
    const showData = shown.data as { title: string; revision: number; closure: { outcome: string; reason: string } };
    assert.equal(showData.closure.outcome, "completed");
    assert.equal(showData.closure.reason, "Implemented and validated");
    const entries = env.inCwd(repo, () => env.run(["journal", "show", ref]));
    const kinds = (entries.data as Array<{ kind: string }>).map((e) => e.kind);
    for (const k of ["finding", "decision", "milestone", "checkpoint", "result"]) assert.ok(kinds.includes(k), `C sees ${k}: ${kinds.join(",")}`);
    const trace = env.inCwd(repo, () => env.run(["provenance", "trace", ref]));
    assert.equal(trace.code, 0, trace.stderr || trace.stdout);
    const capsuleC = env.inCwd(repo, () => env.run(["issue", "resume", ref]));
    assert.equal(capsuleC.code, 0, capsuleC.stderr || capsuleC.stdout);
  });
});

describe("A1 §93 coordinator capsule without child-transcript duplication", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-93-"); });
  after(() => { env.restore(); });

  it("root capsule recovers children by reference, never bodies", async () => {
    const repo = env.gitRepo("a1prog", { remote: "git@github.com:acme/a1prog.git" });
    assert.equal(env.inCwd(repo, () => env.run(["init"])).code, 0);
    const c = contractFile(env, "epic.json", "programme", "programme done");
    const epicRes = env.inCwd(repo, () => env.run(["issue", "create", "--title", "programme", "--kind", "epic", "--contract", c, "--scrutiny", "LOW"]));
    assert.equal(epicRes.code, 0, epicRes.stderr || epicRes.stdout);
    const epic = (epicRes.data as { humanRef: string }).humanRef;
    const markers = ["A1-CHILD-BLUEBERRY-41", "A1-CHILD-BLUEBERRY-42"];
    for (let i = 0; i < 2; i++) {
      const cc = contractFile(env, `child${i}.json`, `child ${i}`, `child ${i} done`);
      const childRes = env.inCwd(repo, () => env.run(["issue", "create", "--title", `child ${i}`, "--kind", "task", "--contract", cc, "--parent", epic, "--scrutiny", "LOW"]));
      assert.equal(childRes.code, 0, childRes.stderr || childRes.stdout);
      const childRef = (childRes.data as { humanRef: string }).humanRef;
      const sem = join(env.temp("sb-a1-93-"), `sem${i}.json`);
      writeFileSync(sem, JSON.stringify({ summary: `child work with ${markers[i]} verbatim transcript detail` }));
      const cp = env.inCwd(repo, () => env.run(["journal", "checkpoint", childRef, "--semantic", sem]));
      assert.equal(cp.code, 0, cp.stderr || cp.stdout);
    }
    const rootSem = join(env.temp("sb-a1-93-"), "root.json");
    writeFileSync(rootSem, JSON.stringify({ summary: "root coordination state" }));
    assert.equal(env.inCwd(repo, () => env.run(["journal", "checkpoint", epic, "--semantic", rootSem])).code, 0);
    const capsule = env.inCwd(repo, () => env.run(["issue", "resume", epic]));
    assert.equal(capsule.code, 0, capsule.stderr || capsule.stdout);
    const text = JSON.stringify(capsule.data);
    assert.ok(!text.includes(markers[0]!) && !text.includes(markers[1]!), "no child transcript leaks into the root capsule");
    // XTRM-252.18: marker absence alone passes on an empty capsule. Pin the
    // positive recovery content: both children by reference, each with its
    // latest checkpoint ref, plus the root's own checkpoint.
    const caps = capsule.data as {
      children: Array<{ humanRef: string; checkpointRef: string | null }>;
      latestCheckpoint: { id: string; sequence: number } | null;
    };
    assert.equal(caps.children.length, 2, "the root capsule recovers both children by reference");
    for (const child of caps.children) {
      assert.ok(child.humanRef, "each child is carried by its durable ref");
      assert.ok(child.checkpointRef, `child ${child.humanRef} carries its latest checkpoint ref`);
    }
    assert.ok(caps.latestCheckpoint?.id, "the root capsule carries its own latest checkpoint");
  });
});

describe("A1 §94 Specialist provenance chain", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-94-"); });
  after(() => { env.restore(); });

  it("Repository -> Project -> rev/hash -> claim -> binding -> session/activation/attempt/AgentSession -> result -> receipt -> artifacts -> closure", () => {
    const repo = env.gitRepo("a1prov", { remote: "git@github.com:acme/a1prov.git" });
    const init = env.inCwd(repo, () => env.run(["init"]));
    assert.equal(init.code, 0, init.stderr || init.stdout);
    const repositoryKey = (init.data as { repository: { repositoryKey: string } }).repository.repositoryKey;
    const projectId = (init.data as { project: { id: string } }).project.id;
    const ref = createInRepo(env, repo, "provenance work");
    attestInRepo(env, repo, ref);
    assert.equal(env.inCwd(repo, () => env.run(["issue", "claim", ref, "--holder", "coord-1", "--activation", "act-a1-94"])).code, 0);

    const db = openSubstrate(env.dbPath);
    let bindingId = "", receiptId = "", resultId = "";
    let revision = 0, hash = "";
    try {
      const svc = new IssueService(db);
      const issue = svc.resolveRef(ref);
      revision = issue.currentRevision;
      hash = issue.currentContractHash;
      const journal = new JournalService(db, svc);
      const prov = new ProvenanceService(db, svc);
      const binding = prov.dispatch(issue.id, {
        workspace: repo, participantId: "coord-1", activationId: "act-a1-94", attemptId: "att-1",
        executionContext: {
          version: 1,
          participantId: "coord-1",
          xtrmSessionId: "01a0a194-8370-74c5-9081-4490653e7e94",
          coordinator: { participantId: "coord-1", sessionId: "01a0a194-8370-74c5-9081-4490653e7e94" },
          specialist: { name: "builder", activationId: "act-a1-94", attemptId: "att-1", agentSessionId: "ags-a1-94-1" },
          workspace: { repositoryKey, repoPath: repo },
        },
      });
      bindingId = binding.id;
      const result = journal.appendEntry(issue.id, {
        kind: "result",
        result: { summary: "bounded specialist outcome", outcome: "completed", completed: ["build"] },
        executionContext: { version: 1, specialist: { name: "builder", activationId: "act-a1-94", attemptId: "att-1", agentSessionId: "ags-a1-94-1" } },
      });
      resultId = result.id;
      const receipt = prov.allocateReceipt(binding.id);
      receiptId = receipt.id;
      prov.bindCommit(receipt.id, "b".repeat(40));
      prov.attachArtifact(receipt.id, "pr", "github:acme/a1prov#3", { provider: "github" });
      const closures = new ClosureService(db, svc);
      const closure = closures.closeIssue(issue.id, {
        outcome: "completed", reason: "provenance chain complete", actor: "coord-1",
        journalResultRefs: [resultId], receiptRefs: [receiptId], artifactRefs: ["github:acme/a1prov#3"],
      });
      assert.equal(closure.issueRevision, revision);
      assert.equal(closure.contractHash, hash);
    } finally {
      db.close();
    }
    const trace = env.inCwd(repo, () => env.run(["provenance", "trace", ref]));
    assert.equal(trace.code, 0, trace.stderr || trace.stdout);
    const t = trace.data as { revision: number; contractHash: string; bindings: Array<{ id: string }>; receipts: Array<{ id: string }>; commits: string[] };
    assert.equal(t.revision, revision);
    assert.equal(t.contractHash, hash);
    assert.ok(t.bindings.some((b) => b.id === bindingId));
    assert.ok(t.receipts.some((r) => r.id === receiptId));
    assert.ok(t.commits.includes("b".repeat(40)));
    assert.ok(projectId.startsWith("prj_") && repositoryKey.length > 0);
    assert.ok(resultId.length > 0 && receiptId.length > 0);
  });
});

describe("A1 §95 zero-commit Issue completeness", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-95-"); });
  after(() => { env.restore(); });

  it("research with zero commits but findings/result/evidence/closure is complete", () => {
    const repo = env.gitRepo("a1research", { remote: "git@github.com:acme/a1research.git" });
    assert.equal(env.inCwd(repo, () => env.run(["init"])).code, 0);
    const ref = createInRepo(env, repo, "research spike", "research");
    assert.equal(env.inCwd(repo, () => env.run(["issue", "note", ref, "provider does not auto-discover this plugin file", "--kind", "finding"])).code, 0);
    const rf = join(env.temp("sb-a1-95-"), "r.json");
    writeFileSync(rf, JSON.stringify({ summary: "research outcome: use official SDK server", outcome: "completed", findings: ["SDK loads separate instances"] }));
    const result = env.inCwd(repo, () => env.run(["journal", "append", ref, "--kind", "result", "--result", rf]));
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const resultId = (result.data as { id: string }).id;
    assert.ok(resultId);
    const close = env.inCwd(repo, () => env.run(["issue", "close", ref, "--outcome", "completed", "--reason", "Research concluded with evidence", "--actor", "researcher", "--result", resultId]));
    assert.equal(close.code, 0, close.stderr || close.stdout);
    const trace = env.inCwd(repo, () => env.run(["provenance", "trace", ref]));
    assert.equal(trace.code, 0);
    assert.deepEqual((trace.data as { commits: string[] }).commits, [], "zero commits, still complete");
    const shown = env.inCwd(repo, () => env.run(["issue", "show", ref]));
    assert.equal((shown.data as { closure: { outcome: string } }).closure.outcome, "completed");
  });
});

describe("A1 §96 close-reason matrix and immutability", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-96-"); });
  after(() => { env.restore(); });

  it("completed/superseded/duplicate/cancelled persist refs; history immutable", () => {
    const repo = env.gitRepo("a1close", { remote: "git@github.com:acme/a1close.git" });
    assert.equal(env.inCwd(repo, () => env.run(["init"])).code, 0);
    const savedSession = process.env["XTRM_SESSION_ID"];
    process.env["XTRM_SESSION_ID"] = "01a0a196-8370-74c5-9081-4490653e7e96";
    try {
      const cases = [
        { outcome: "completed", reason: "shipped" },
        { outcome: "superseded", reason: "replaced by A1CLOSE-9" },
        { outcome: "duplicate", reason: "same as A1CLOSE-1" },
        { outcome: "cancelled", reason: "no longer wanted" },
      ] as const;
      for (const c of cases) {
        const ref = createInRepo(env, repo, `matrix ${c.outcome}`);
        const out = env.inCwd(repo, () => env.run(["issue", "close", ref, "--outcome", c.outcome, "--reason", c.reason, "--actor", `actor-${c.outcome}`]));
        assert.equal(out.code, 0, `${c.outcome}: ${out.stderr || out.stdout}`);
        const shown = env.inCwd(repo, () => env.run(["issue", "show", ref]));
        const closure = (shown.data as { closure: Record<string, unknown> }).closure;
        assert.equal(closure["outcome"], c.outcome);
        assert.equal(closure["reason"], c.reason);
        assert.equal(closure["actor"], `actor-${c.outcome}`);
      }
      // Immutability: reopen keeps history, second read identical.
      const db = openSubstrate(env.dbPath);
      try {
        const svc = new IssueService(db);
        const closures = new ClosureService(db, svc);
        const issue = svc.resolveRef("A1CLOSE-1");
        const before = closures.getLatestClosure(issue.id)!;
        closures.reopenIssue(issue.id, { reason: "regression reproduced" });
        const afterReopen = closures.listClosures(issue.id);
        assert.ok(afterReopen.some((cl) => cl.closureId === before.closureId), "historical Closure preserved");
        assert.deepEqual(closures.getClosure(before.closureId), before, "byte-identical history");
      } finally {
        db.close();
      }
    } finally {
      if (savedSession === undefined) delete process.env["XTRM_SESSION_ID"];
      else process.env["XTRM_SESSION_ID"] = savedSession;
    }
    const outcomes = [...CLOSURE_OUTCOMES].sort();
    assert.deepEqual(outcomes, ["abandoned", "cancelled", "completed", "duplicate", "invalid", "superseded", "wont_fix"]);
  });
});

describe("A1 §97 automatic identity propagation and retry lineage", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-97-"); });
  after(() => { env.restore(); });

  it("xt session propagates; coordinator lineage preserved; retry keeps both attempts", () => {
    const savedId = process.env["XTRM_SESSION_ID"];
    const savedName = process.env["XTRM_SESSION_NAME"];
    process.env["XTRM_SESSION_ID"] = "01a0a197-8370-74c5-9081-4490653e7e97";
    process.env["XTRM_SESSION_NAME"] = "a1-97-session";
    try {
      const db = openSubstrate(env.dbPath);
      try {
        const svc = new IssueService(db);
        svc.createProject({ id: "prj_a1id", prefix: "A1ID", name: "a1id" });
        const issue = svc.createIssue({ projectId: "prj_a1id", title: "identity work", kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "a1" });
        svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
        svc.claimIssue(issue.id, "coord-holder", { activationId: "act-a1-97" });
        const journal = new JournalService(db, svc);
        const prov = new ProvenanceService(db, svc);
        const first = prov.dispatch(issue.id, {
          workspace: env.temp("sb-a1-97-"), participantId: "coord-holder", activationId: "act-a1-97", attemptId: "att-1",
          executionContext: { version: 1, xtrmSessionId: "01a0a197-8370-74c5-9081-4490653e7e97", xtrmSessionName: "a1-97-session", specialist: { name: "builder", activationId: "act-a1-97", attemptId: "att-1" } },
        });
        const second = prov.dispatch(issue.id, {
          workspace: env.temp("sb-a1-97-"), participantId: "coord-holder", activationId: "act-a1-97", attemptId: "att-2",
          executionContext: { version: 1, xtrmSessionId: "01a0a197-8370-74c5-9081-4490653e7e97", xtrmSessionName: "a1-97-session", specialist: { name: "builder", activationId: "act-a1-97", attemptId: "att-2" } },
        });
        assert.notEqual(first.id, second.id);
        const attempts = prov.listBindings(issue.id).filter((b) => b.activationId === "act-a1-97");
        assert.equal(attempts.length, 2);
        assert.deepEqual(attempts.map((b) => b.attemptId).sort(), ["att-1", "att-2"]);
        const entry = journal.appendEntry(issue.id, {
          kind: "finding", semantic: { summary: "auto-identity finding" },
          executionContext: { version: 1, xtrmSessionId: "01a0a197-8370-74c5-9081-4490653e7e97", xtrmSessionName: "a1-97-session" },
        });
        assert.equal(entry.executionContext?.xtrmSessionId, "01a0a197-8370-74c5-9081-4490653e7e97");
        assert.equal(entry.executionContext?.xtrmSessionName, "a1-97-session");
      } finally {
        db.close();
      }
    } finally {
      if (savedId === undefined) delete process.env["XTRM_SESSION_ID"];
      else process.env["XTRM_SESSION_ID"] = savedId;
      if (savedName === undefined) delete process.env["XTRM_SESSION_NAME"];
      else process.env["XTRM_SESSION_NAME"] = savedName;
    }
  });
});

describe("A1 §98 no fabricated provenance", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-98-"); });
  after(() => { env.restore(); });

  it("unknown stays absent/null, never invented", () => {
    const db = openSubstrate(env.dbPath);
    try {
      const svc = new IssueService(db);
      svc.createProject({ id: "prj_a1unknown", prefix: "A1UNKNOWN", name: "a1unknown" });
      const issue = svc.createIssue({ projectId: "prj_a1unknown", title: "unknown work", kind: "task", contract: contract(), scrutiny: "LOW", authoredBy: "a1" });
      const journal = new JournalService(db, svc);
      const entry = journal.appendEntry(issue.id, { kind: "note", semantic: { summary: "bare note, no identity supplied" } });
      assert.equal(entry.executionContext ?? null, null);
      assert.equal(entry.participantId, null);
      assert.equal(entry.sessionId, null);
      assert.equal(entry.activationId, null);
      const prov = new ProvenanceService(db, svc);
      svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
      svc.claimIssue(issue.id, "holder-98");
      const binding = prov.dispatch(issue.id, { workspace: env.temp("sb-a1-98-"), participantId: "holder-98" });
      // Known inputs persist (participant, workspace, timestamp); unknown
      // session/activation/repository identity stays absent, never invented.
      assert.equal(binding.sessionId, null);
      assert.equal(binding.activationId, null);
      assert.equal(binding.attemptId, null);
      assert.equal(binding.executionContext?.xtrmSessionId ?? null, null);
      assert.equal(binding.executionContext?.specialist?.activationId ?? null, null);
      assert.equal(binding.executionContext?.specialist?.attemptId ?? null, null);
      assert.equal(binding.executionContext?.specialist?.agentSessionId ?? null, null);
    } finally {
      db.close();
    }
  });
});

describe("A1 §102 final architectural invariant end to end", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-102-"); });
  after(() => { env.restore(); });

  it("Git repo -> init -> rev/hash -> readiness -> claim -> session -> activation/attempt -> journal -> receipt -> artifact -> validation -> closure -> reconstruct", () => {
    const savedId = process.env["XTRM_SESSION_ID"];
    process.env["XTRM_SESSION_ID"] = "01a0a102-8370-74c5-9081-4490653e7102";
    try {
      const repo = env.gitRepo("a1inv", { remote: "git@github.com:acme/a1inv.git" });
      const init = env.inCwd(repo, () => env.run(["init"]));
      assert.equal(init.code, 0, init.stderr || init.stdout);
      const ref = createInRepo(env, repo, "invariant work");
      const db = openSubstrate(env.dbPath);
      let rev = 0, hash = "";
      try {
        const svc = new IssueService(db);
        const before = svc.resolveRef(ref);
        rev = before.currentRevision;
        hash = before.currentContractHash;
        svc.attestReadiness(before.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
        svc.claimIssue(before.id, "holder-102", { activationId: "act-a1-102" });
      } finally {
        db.close();
      }
      assert.equal(env.inCwd(repo, () => env.run(["issue", "note", ref, "material finding", "--kind", "finding"])).code, 0);
      const dispatch = env.inCwd(repo, () => env.run(["provenance", "dispatch", ref, "--participant", "holder-102", "--activation", "act-a1-102", "--attempt", "att-1"]));
      assert.equal(dispatch.code, 0, dispatch.stderr || dispatch.stdout);
      const rf = join(env.temp("sb-a1-102-"), "r.json");
      writeFileSync(rf, JSON.stringify({ summary: "invariant result", outcome: "completed" }));
      const result = env.inCwd(repo, () => env.run(["journal", "append", ref, "--kind", "result", "--result", rf]));
      assert.equal(result.code, 0, result.stderr || result.stdout);
      const resultId = (result.data as { id: string }).id;
      assert.ok(resultId);
      const db2 = openSubstrate(env.dbPath);
      let receiptId = "";
      try {
        const svc2 = new IssueService(db2);
        const prov2 = new ProvenanceService(db2, svc2);
        const issue2 = svc2.resolveRef(ref);
        assert.equal(issue2.currentRevision, rev);
        assert.equal(issue2.currentContractHash, hash);
        const binding = prov2.listBindings(issue2.id)[0]!;
        const receipt = prov2.allocateReceipt(binding.id);
        receiptId = receipt.id;
        prov2.bindCommit(receipt.id, "c".repeat(40));
      } finally {
        db2.close();
      }
      const validated = env.inCwd(repo, () => env.run(["issue", "validate", ref]));
      assert.equal(validated.code, 0, validated.stderr || validated.stdout);
      const close = env.inCwd(repo, () => env.run(["issue", "close", ref, "--outcome", "completed", "--reason", "invariant satisfied", "--actor", "holder-102", "--result", resultId, "--receipt", receiptId]));
      assert.equal(close.code, 0, close.stderr || close.stdout);
      const resume = env.inCwd(repo, () => env.run(["issue", "resume", ref]));
      assert.equal(resume.code, 0, "future worker reconstructs without chat history");
      const trace = env.inCwd(repo, () => env.run(["provenance", "trace", ref]));
      assert.equal(trace.code, 0);
    } finally {
      if (savedId === undefined) delete process.env["XTRM_SESSION_ID"];
      else process.env["XTRM_SESSION_ID"] = savedId;
    }
  });
});

describe("A1 §103 definition of complete (mechanical record)", () => {
  let env: RepoEnv;
  before(() => { env = repoEnv("sb-a1-103-"); });
  after(() => { env.restore(); });

  it("one-command init; uninitialized never sees others; worktrees/clones share; durable explain; resume without transcript; help/docs teach one model", () => {
    // One-command init.
    const repo = env.gitRepo("a1doc");
    assert.equal(env.inCwd(repo, () => env.run(["init"])).code, 0);
    // Uninitialized never sees others (global cardinality is never evidence).
    const other = env.gitRepo("a1doc-other");
    createInRepo(env, repo, "doc work");
    const leaked = env.inCwd(other, () => env.run(["issue", "list"]));
    assert.equal(leaked.code, 1);
    assert.match(leaked.error ?? "", /Run `sb init`/);
    // Help teaches the same model on every surface.
    const helpInit = env.inCwd(repo, () => env.run(["init"], { json: false }));
    assert.match(helpInit.stdout, /repository/i);
    // XTRM-252.18: the close help output was discarded (`void closeHelp`), so
    // the §103 claim "help teaches one model" had no assertion behind it.
    const closeHelp = env.run(["issue", "close", "--help"] as unknown as string[]);
    assert.equal(closeHelp.code, 0, closeHelp.stderr || closeHelp.stdout);
    // env.run injects --json, so the help page arrives inside the envelope as a
    // `text` field and the raw stdout is one line of JSON that also carries the
    // Methodology paragraph. Read the usage line from the text, or a
    // usage-line regression is masked by the surrounding prose.
    const closeText = (closeHelp.data as { text?: string } | undefined)?.text ?? closeHelp.stdout;
    const closeUsage = closeText.split("\n").find((line) => line.includes("usage:")) ?? "";
    assert.match(closeUsage, /usage: sb issue close/, "close help must show the canonical command form");
    for (const outcome of CLOSURE_OUTCOMES) {
      assert.ok(closeUsage.includes(outcome), `issue close --help usage line must name outcome ${outcome}`);
    }
    // Bounded vocabularies are the documented ones.
    assert.ok((JOURNAL_KINDS as readonly string[]).includes("result"));
    assert.ok((CLOSURE_OUTCOMES as readonly string[]).includes("completed"));
    // Operator docs exist. From packages/substrate/tests/ the repo root is three
    // levels up: `../../docs/substrate` resolved to packages/docs/substrate,
    // which does not exist, and the URL was discarded, so this check was vacuous.
    const docsRoot = fileURLToPath(new URL("../../../docs/substrate/", import.meta.url));
    for (const doc of ["README", "workflow", "journal", "provenance", "repository-identity", "cli"]) {
      const docPath = join(docsRoot, `${doc}.md`);
      assert.ok(existsSync(docPath), `operator doc must exist: ${docPath}`);
      assert.ok(readFileSync(docPath, "utf8").trim().length > 0, `operator doc must not be empty: ${docPath}`);
    }
  });
});

// XTRM-252.18: the guard must be insensitive to whitespace, receivers and
// comment styles. A literal `length === 1` substring match missed
// `projects.length==1` and treated a `/* … */` comment as live code.
function cardinalityShortcuts(source: string): string[] {
  const withoutComments = (line: string): string =>
    line
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/^\s*(\/\/|\*|#|<!--).*$/, " ");
  // XTRM-967: a comparison whose two arms are string literals chooses a WORD
  // ("blocker" : "blockers"), never an element, so it infers nothing about
  // database cardinality. Exempting it keeps the guard pointed at the
  // inference it was written for instead of at English pluralisation — a rule
  // that forbids `n === 1 ? "a" : "b"` pushes authors toward worse wording, not
  // toward safer code.
  const picksAWord = (line: string): boolean => /\?\s*"[^"]*"\s*:\s*"[^"]*"/.test(line);
  return source
    .split("\n")
    .map((line) => withoutComments(line).replace(/\s+/g, " ").trim())
    .filter((line) => line !== "" && !picksAWord(line) && /\b(length|size|count)\s*===?\s*1\b/.test(line));
}

describe("A1 negative-control guard: no global-cardinality shortcut", () => {
  it("resolveProject has no live projects.length===1 inference and no source single", () => {
    const src = readFileSync(new URL("../src/service/issue-service.ts", import.meta.url), "utf8");
    assert.deepEqual(cardinalityShortcuts(src), [], "no live global-cardinality inference");
    assert.ok(src.includes("Global database cardinality is never evidence"), "the invariant stays documented");
    assert.ok(!src.match(/source\s*[:=]\s*["']single["']/), "single-project source must stay removed");
    const cliSrc = readFileSync(new URL("../cli/sb.ts", import.meta.url), "utf8");
    assert.ok(!cliSrc.match(/source\s*[:=]\s*["']single["']/), "CLI must not carry the removed single-project source");
  });

  it("the guard rejects whitespace, receiver and comment variants", () => {
    assert.equal(cardinalityShortcuts("if (projects.length === 1) return all[0];").length, 1);
    assert.equal(cardinalityShortcuts("if(projects.length==1) return all[0];").length, 1);
    assert.equal(cardinalityShortcuts("const only = rows.size == 1 ? rows[0] : null;").length, 1);
    assert.equal(cardinalityShortcuts("// projects.length === 1 is rejected (ADR §5)").length, 0);
    assert.equal(cardinalityShortcuts("/* projects.length === 1 is rejected */").length, 0);
    assert.equal(cardinalityShortcuts("const two = projects.length === 2;").length, 0);
    // A word choice is not a cardinality pick; an element pick still is.
    assert.equal(cardinalityShortcuts('const one = rows.length === 1 ? "row" : "rows";').length, 0);
    assert.equal(cardinalityShortcuts("const only = rows.size == 1 ? rows[0] : null;").length, 1);
  });
});
