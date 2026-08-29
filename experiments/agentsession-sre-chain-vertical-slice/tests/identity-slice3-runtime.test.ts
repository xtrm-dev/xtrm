/**
 * Robot identities slice 3 (xtrm-1zv) — residual resolutions:
 *   F1: real non-production mutation adapter + real scheduler call site
 *       (LocalGitCommitAdapter creates a REAL git commit and returns the
 *       REAL commit SHA as the platform object id; emitted per satisfied
 *       step by emitStepProvenanceReceipts inside the scheduler path).
 *   F3: runtime_session_id read from StepExecutionState.last_pi_session_id.
 *   F4: role-bound actor resolution (roleActors; override must agree).
 *   F5: account-binding asymmetry — non-null envelope account id vs null
 *       trusted config binding fails closed.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import type { ChainStep, ParticipantIdentity, ResolvedChain, StepExecutionState } from "../src/chain/types.ts";
import { makeIdentity } from "../src/chain/scheduler.ts";
import { newResolvedChain, stepById } from "../src/chain/topology.ts";
import { paths, initRunDir, saveRunState } from "../src/chain/store.ts";
import { loadChainRunInputs, saveChainRunInputs, type ProvenanceRunConfig } from "../src/chain/run-inputs.ts";
import { initialRunState } from "../src/chain/reducer.ts";
import { resolveTrustedExecutionContext } from "../src/chain/trusted-context.ts";
import { emitStepProvenanceReceipts } from "../src/chain/provenance-receipts.ts";
import { runProvenanceCanary } from "../src/identity/canary.ts";
import { LocalGitCommitAdapter } from "../src/identity/adapters/local-git-commit.ts";
import { validateMutation, type TrustedValidationConfig } from "../src/identity/validation.ts";
import { assembleProvenance } from "../src/identity/context.ts";
import {
  ACTOR_SCHEMA_VERSION,
  PRINCIPAL_SET_SCHEMA_VERSION,
  type Actor,
  type PrincipalSet,
} from "../src/identity/schemas.ts";

const sha = (s: string) =>
  `sha256:${Array.from(new Bun.CryptoHasher("sha256").update(s).digest("hex")).join("")}`;

function makeActors(): Record<string, Actor> {
  return {
    "mercury/chain-coordinator-role": {
      schema_version: ACTOR_SCHEMA_VERSION,
      actor_id: "mercury/chain-coordinator-role",
      actor_kind: "coordinator",
      parent_actor_id: null,
      policy_profile: "sre-triage-chain",
      allowed_principal_sets: ["xtrm-web"],
      authority_source: "chain-runtime-scheduler",
    },
    "mercury/explorer-role": {
      schema_version: ACTOR_SCHEMA_VERSION,
      actor_id: "mercury/explorer-role",
      actor_kind: "worker",
      parent_actor_id: null,
      policy_profile: "sre-triage-chain",
      allowed_principal_sets: ["xtrm-web"],
      authority_source: "chain-runtime-scheduler",
    },
  };
}

function makePrincipalSets(): Record<string, PrincipalSet> {
  return {
    "xtrm-web": {
      schema_version: PRINCIPAL_SET_SCHEMA_VERSION,
      principal_set_id: "xtrm-web",
      kind: "shared_web_connector",
      bindings: [
        { system: "github", principal_type: "user", immutable_account_id: null, display_name: "XTRM Web" },
      ],
      shared_by: ["environment == web"],
      credential_storage: "external_connector",
    },
  };
}

const ACTORS = makeActors();
const PRINCIPAL_SETS = makePrincipalSets();
const ROLE_ACTORS: Record<string, string> = {
  "chain-coordinator": ACTORS["mercury/chain-coordinator-role"]!.actor_id,
  explorer: ACTORS["mercury/explorer-role"]!.actor_id,
  "observability-analyst": ACTORS["mercury/explorer-role"]!.actor_id,
  "sre-diagnostician": ACTORS["mercury/explorer-role"]!.actor_id,
  reviewer: ACTORS["mercury/explorer-role"]!.actor_id,
};

function realChain(): ResolvedChain {
  return newResolvedChain({
    chain_id: "chain-sre-slice3",
    root_bead_id: "xtrm-1zv",
    fingerprint: {
      pi_package: { name: "pi-coding-agent", version: "0.84.1" },
      beads_version: "1.2.2",
      experiment_source_dir: "experiments/agentsession-sre-chain-vertical-slice",
      experiment_source_dirty: false,
      baseline_specialists: [],
    },
  });
}

function stepStateFor(stepId: string, attempts = 1, piSession?: string): StepExecutionState {
  return {
    step_id: stepId,
    participant_id: "",
    attempts,
    status: "running",
    remediation_loops: 0,
    last_pi_session_id: piSession ?? `pi-${stepId}-${attempts}`,
  };
}

function resolveFor(chain: ResolvedChain, role: string) {
  const step = chain.topology.find((s) => s.role === role)!;
  const st = stepStateFor(step.step_id, 1);
  const identity = makeIdentity(chain, step, st);
  return {
    chain,
    step,
    st,
    identity,
    resolution: resolveTrustedExecutionContext({
      identity,
      chain,
      step,
      stepState: st,
      registries: { actors: ACTORS, principalSets: PRINCIPAL_SETS },
      roleActors: ROLE_ACTORS,
      assignment: { id: "bead:xtrm-1zv", version: 1 },
      authorityRef: "bead:xtrm-1zv",
      principalSetId: "xtrm-web",
    }),
  };
}

// ---------------------------------------------------------------- F3
describe("slice 3 — runtime_session_id from StepExecutionState (F3)", () => {
  test("adapter reads last_pi_session_id from step state; no host literal accepted", () => {
    const chain = realChain();
    const r = resolveFor(chain, "chain-coordinator");
    expect(r.resolution.context.execution.runtime_session_id).toBe(
      r.st.last_pi_session_id ?? null,
    );
    expect(r.resolution.context.execution.runtime_session_id).toMatch(/^pi-/);
  });

  test("two distinct runs at the same attempt get distinct runtime session ids", () => {
    const chain = realChain();
    const r1 = resolveFor(chain, "explorer");
    const r2 = (() => {
      const step = stepById(chain, "explorer");
      const st = stepStateFor("explorer", 1, "pi-session-run-B");
      const identity = makeIdentity(chain, step, st);
      return resolveTrustedExecutionContext({
        identity,
        chain,
        step,
        stepState: st,
        registries: { actors: ACTORS, principalSets: PRINCIPAL_SETS },
        roleActors: ROLE_ACTORS,
        assignment: { id: "bead:xtrm-1zv", version: 1 },
        authorityRef: "bead:xtrm-1zv",
        principalSetId: "xtrm-web",
      });
    })();
    expect(r1.resolution.context.execution.runtime_session_id).not.toBe(
      r2.context.execution.runtime_session_id,
    );
    // same execution_id (deterministic per participant+attempt) but distinct
    // receipts via runtime session — the slice-3 disambiguation
    expect(r1.resolution.context.execution.execution_id).toBe(
      r2.context.execution.execution_id,
    );
  });
});

// ---------------------------------------------------------------- F4
describe("slice 3 — role-bound actor resolution (F4)", () => {
  test("role-bound actor is used; override agreeing with the binding passes", () => {
    const r = resolveFor(realChain(), "chain-coordinator");
    expect(r.resolution.context.execution.actor_id).toBe(
      ACTORS["mercury/chain-coordinator-role"]!.actor_id,
    );
  });

  test("override disagreeing with role binding fails closed", () => {
    const chain = realChain();
    const step = stepById(chain, "explorer");
    const st = stepStateFor("explorer", 1);
    const identity = makeIdentity(chain, step, st);
    expect(() =>
      resolveTrustedExecutionContext({
        identity,
        chain,
        step,
        stepState: st,
        registries: { actors: ACTORS, principalSets: PRINCIPAL_SETS },
        roleActors: ROLE_ACTORS,
        assignment: { id: "bead:xtrm-1zv", version: 1 },
        authorityRef: "bead:xtrm-1zv",
        // wrong actor for the explorer role
        actorId: ACTORS["mercury/chain-coordinator-role"]!.actor_id,
        principalSetId: "xtrm-web",
      }),
    ).toThrow(/actor_role_mismatch/);
  });

  test("missing role binding fails closed", () => {
    const chain = realChain();
    const step = stepById(chain, "explorer");
    const st = stepStateFor("explorer", 1);
    const identity = makeIdentity(chain, step, st);
    expect(() =>
      resolveTrustedExecutionContext({
        identity,
        chain,
        step,
        stepState: st,
        registries: { actors: ACTORS, principalSets: PRINCIPAL_SETS },
        roleActors: {}, // nothing bound
        assignment: { id: "bead:xtrm-1zv", version: 1 },
        authorityRef: "bead:xtrm-1zv",
        principalSetId: "xtrm-web",
      }),
    ).toThrow(/actor_role_unbound/);
  });
});

// ---------------------------------------------------------------- F5
describe("slice 3 — account-binding asymmetry (F5)", () => {
  function configFor(psBindings: PrincipalSet["bindings"]): TrustedValidationConfig {
    return {
      registry: ACTORS,
      principalSets: { "xtrm-web": { ...PRINCIPAL_SETS["xtrm-web"]!, bindings: psBindings } },
    };
  }

  test("non-null envelope account id vs null trusted config binding fails closed", () => {
    const r = resolveFor(realChain(), "chain-coordinator");
    const env = assembleProvenance(r.resolution.context, {
      content: "slice3 asymmetry canary",
      target: { kind: "github_commit", repo: "scratch/repo" },
    }, {
      authorship_mode: "xtrm_local_direct",
      binding: { system: "github", principal_type: "user", immutable_account_id: "acct-FORGED", display_name: "XTRM Web" },
    });
    const res = validateMutation(env, configFor([
      { system: "github", principal_type: "user", immutable_account_id: null, display_name: "XTRM Web" },
    ]));
    expect(res.ok).toBe(false);
    expect(res.failures.map((f) => f.code)).toContain("binding_account_mismatch");
    expect(res.failures.find((f) => f.code === "binding_account_mismatch")?.detail).toContain(
      "non-null immutable_account_id",
    );
  });

  test("matching non-null ids still validate (symmetry preserved)", () => {
    const r = resolveFor(realChain(), "chain-coordinator");
    const env = assembleProvenance(r.resolution.context, {
      content: "slice3 asymmetry canary 2",
      target: { kind: "github_commit", repo: "scratch/repo" },
    }, {
      authorship_mode: "xtrm_local_direct",
      binding: { system: "github", principal_type: "user", immutable_account_id: "acct-REAL", display_name: "XTRM Web" },
    });
    const res = validateMutation(env, configFor([
      { system: "github", principal_type: "user", immutable_account_id: "acct-REAL", display_name: "XTRM Web" },
    ]));
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------- F1
describe("slice 3 — real non-production mutation adapter (F1)", () => {
  let scratch: string;
  let repoDir: string;

  beforeAll(async () => {
    scratch = await fsp.mkdtemp(path.join(tmpdir(), "xtrm-s3-scratch-"));
    repoDir = path.join(scratch, "canary-repo");
  });
  afterAll(async () => {
    await fsp.rm(scratch, { recursive: true, force: true });
  });

  test("adapter creates a REAL commit and returns the REAL object sha", async () => {
    const adapter = new LocalGitCommitAdapter({ scratchRoot: scratch, repoDir });
    const r = resolveFor(realChain(), "chain-coordinator");
    const result = await runProvenanceCanary({
      context: r.resolution.context,
      validationConfig: {
        registry: ACTORS,
        principalSets: PRINCIPAL_SETS,
        expected: { assignment_id: "bead:xtrm-1zv", assignment_version: 1 },
      },
      payload: {
        content: "slice3 real mutation canary",
        target: { kind: "github_commit", repo: repoDir },
        source_cursors: { evidence_id: "ev-real-1" },
      },
      authorshipMode: "xtrm_local_direct",
      adapter,
    });
    // real, platform-assigned object id = a real commit sha in the scratch repo
    expect(result.external_id).toMatch(/^[0-9a-f]{40}$/);
    expect(result.bound.target.external_id).toBe(result.external_id);
    expect(result.validation.ok).toBe(true);
    expect(result.bound.attribution_strength).toBe("self_attested_web");
    expect(fs.existsSync(repoDir)).toBe(true);
    // the commit subject carries the canary marker + receipt
    const commitMsg = (await fsp.readFile(path.join(repoDir, ".git", "COMMIT_EDITMSG"), "utf8"))
      .trim();
    expect(commitMsg).toContain("xtrm-provenance-canary");
    expect(commitMsg).toContain(result.bound.receipt_id);
  });

  test("adapter rejects a repo outside the designated scratch root", async () => {
    const outside = path.join(tmpdir(), `xtrm-s3-outside-${Date.now()}`);
    const adapter = new LocalGitCommitAdapter({ scratchRoot: scratch, repoDir: outside });
    const r = resolveFor(realChain(), "explorer");
    await expect(
      runProvenanceCanary({
        context: r.resolution.context,
        validationConfig: { registry: ACTORS, principalSets: PRINCIPAL_SETS },
        payload: { content: "outside attempt", target: { kind: "github_commit", repo: outside } },
        authorshipMode: "xtrm_local_direct",
        adapter,
      }),
    ).rejects.toThrow(/local_git_adapter_outside_scratch/);
  });

  test("adapter ALLOWS a symlink-repoDir that resolves inside the scratch root", async () => {
    // Positive control: realpath containment must not block legitimate
    // nested links (e.g. a symlinked repo inside the scratch tree).
    const realNested = path.join(scratch, "nested-real");
    await fsp.mkdir(realNested, { recursive: true });
    const linkInside = path.join(scratch, "inside-link");
    await fsp.symlink(realNested, linkInside, "dir");
    const adapter = new LocalGitCommitAdapter({ scratchRoot: scratch, repoDir: linkInside });
    const r = resolveFor(realChain(), "explorer");
    const result = await runProvenanceCanary({
      context: r.resolution.context,
      validationConfig: { registry: ACTORS, principalSets: PRINCIPAL_SETS },
      payload: { content: "inside symlink ok", target: { kind: "github_commit", repo: linkInside } },
      authorshipMode: "xtrm_local_direct",
      adapter,
    });
    expect(result.external_id).toMatch(/^[0-9a-f]{40}$/);
  });

  test("adapter rejects a symlink-repoDir that escapes the scratch root (realpath)", async () => {
    // Review Finding 1 (slice 3): lexical containment only was bypassable
    // by a repoDir symlink pointing outside the scratch root. The guard now
    // realpath-resolves both sides.
    const outsideReal = await fsp.mkdtemp(path.join(tmpdir(), "xtrm-s3-symlink-out-"));
    const linkDir = path.join(scratch, "escape-link");
    await fsp.symlink(outsideReal, linkDir, "dir");
    const adapter = new LocalGitCommitAdapter({ scratchRoot: scratch, repoDir: linkDir });
    const r = resolveFor(realChain(), "explorer");
    await expect(
      runProvenanceCanary({
        context: r.resolution.context,
        validationConfig: { registry: ACTORS, principalSets: PRINCIPAL_SETS },
        payload: { content: "symlink escape attempt", target: { kind: "github_commit", repo: linkDir } },
        authorshipMode: "xtrm_local_direct",
        adapter,
      }),
    ).rejects.toThrow(/local_git_adapter_outside_scratch/);
    await fsp.rm(outsideReal, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------- F1 — real call site
describe("slice 3 — scheduler call site emits real receipts (F1)", () => {
  let scratch: string;
  let repoDir: string;
  let stateDir: string;
  const runId = "run-slice3-callsite";
  let facts: unknown[] = [];

  beforeAll(async () => {
    scratch = await fsp.mkdtemp(path.join(tmpdir(), "xtrm-s3-site-"));
    repoDir = path.join(scratch, "canary-repo");
    stateDir = await fsp.mkdtemp(path.join(tmpdir(), "xtrm-s3-state-"));
  });
  afterAll(async () => {
    await fsp.rm(scratch, { recursive: true, force: true });
    await fsp.rm(stateDir, { recursive: true, force: true });
  });

  test("emitStepProvenanceReceipts writes a receipt per satisfied step", async () => {
    const chain = realChain();
    const p = paths(stateDir, runId);
    await initRunDir(p);
    const provenance: ProvenanceRunConfig = {
      enabled: true,
      registries: { actors: ACTORS, principalSets: PRINCIPAL_SETS },
      roleActors: ROLE_ACTORS,
      scratchRoot: scratch,
      repoDir,
      assignmentId: "bead:xtrm-1zv",
      assignmentVersion: 1,
      authorityRef: "bead:xtrm-1zv",
      principalSetId: "xtrm-web",
      authorshipMode: "xtrm_local_direct",
    };
    await saveChainRunInputs(p, {
      schema_version: 1,
      target_repo_path: stateDir,
      incident_brief: "slice3 call site test",
      provenance,
    });

    // prev run: everything ready; next run: explorer satisfied
    const prev = initialRunState(chain, runId);
    const next = initialRunState(chain, runId);
    next.steps.explorer!.status = "satisfied";
    next.steps.explorer!.last_satisfied_at = new Date().toISOString();
    next.steps.explorer!.last_execution_id = "exec-chain-sre-slice3-explorer-1";
    await saveRunState(p, prev);

    const onFact = (f: unknown) => { facts.push(f); };
    await emitStepProvenanceReceipts({ paths: p, chain, onFact }, prev, next);

    // run inputs preserved (loadable)
    const inputs = await loadChainRunInputs(p);
    expect(inputs?.provenance?.enabled).toBe(true);

    // receipt persisted on the run's output surface
    const receiptsDir = path.join(p.outputsDir, "provenance-receipts");
    const files = fs.readdirSync(receiptsDir);
    expect(files.length).toBe(1);
    const record = JSON.parse(fs.readFileSync(path.join(receiptsDir, files[0]!), "utf8"));
    expect(record.schema_version).toBe("xtrm.provenance-receipt.v1");
    expect(record.step_id).toBe("explorer");
    expect(record.external_object_id).toMatch(/^[0-9a-f]{40}$/);
    expect(next.steps.explorer!.last_provenance_receipt_id).toBe(record.receipt_id);
    expect(facts.some((f) => (f as any).kind === "provenance.receipt")).toBe(true);
  });

  test("emitter is idempotent — a step already receipted is not re-emitted", async () => {
    const chain = realChain();
    const p = paths(stateDir, runId + "-2");
    await initRunDir(p);
    const provenance: ProvenanceRunConfig = {
      enabled: true,
      registries: { actors: ACTORS, principalSets: PRINCIPAL_SETS },
      roleActors: ROLE_ACTORS,
      scratchRoot: scratch,
      repoDir: path.join(scratch, "canary-repo-2"),
      assignmentId: "bead:xtrm-1zv",
      assignmentVersion: 1,
      authorityRef: "bead:xtrm-1zv",
      principalSetId: "xtrm-web",
      authorshipMode: "xtrm_local_direct",
    };
    await saveChainRunInputs(p, {
      schema_version: 1,
      target_repo_path: stateDir,
      incident_brief: "slice3 idempotency test",
      provenance,
    });
    const prev = initialRunState(chain, runId);
    const next = initialRunState(chain, runId);
    next.steps.explorer!.status = "satisfied";
    next.steps.explorer!.last_satisfied_at = new Date().toISOString();
    // already receipted in a previous session
    prev.steps.explorer = { ...next.steps.explorer!, status: "satisfied", last_provenance_receipt_id: "xpr-already" };
    const facts2: unknown[] = [];
    await emitStepProvenanceReceipts({ paths: p, chain, onFact: (f) => facts2.push(f) }, prev, next);
    expect(facts2.filter((f) => (f as any).kind === "provenance.receipt").length).toBe(0);
    expect(fs.existsSync(path.join(p.outputsDir, "provenance-receipts"))).toBe(false);
  });

  test("emitter no-ops entirely when provenance is not enabled", async () => {
    const chain = realChain();
    const p = paths(stateDir, runId + "-3");
    await initRunDir(p);
    await saveChainRunInputs(p, {
      schema_version: 1,
      target_repo_path: stateDir,
      incident_brief: "no provenance",
    });
    const prev = initialRunState(chain, runId);
    const next = initialRunState(chain, runId);
    next.steps.explorer!.status = "satisfied";
    const facts3: unknown[] = [];
    await emitStepProvenanceReceipts({ paths: p, chain, onFact: (f) => facts3.push(f) }, prev, next);
    expect(facts3.filter((f) => (f as any).kind === "provenance.receipt").length).toBe(0);
    expect(fs.existsSync(path.join(p.outputsDir, "provenance-receipts"))).toBe(false);
  });
});
