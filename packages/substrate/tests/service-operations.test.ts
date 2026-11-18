// Every operation, both ways: the same call through a real `sb serve --stdio`
// child and through the in-process table, with the two stores in separate files.
//
// The table is the contract: an operation whose wire behaviour differs from its
// local behaviour is a bug that only shows up when a consumer moves. Each entry
// runs once with arguments of a valid shape and once with an unknown field, and
// the two outcomes must agree (ok flag, error code, result shape).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers.ts";
import { ARGS, CAPABILITIES, OPERATIONS, classifyError } from "../src/service/ops.ts";
import { MAX_FRAME_BYTES, ServiceCallError } from "../src/service/protocol.ts";
import {
  classifyTransportEnd,
  createLocalService,
  createServiceClient,
  openService,
  openSshService,
  spawnLink,
  type SubstrateService,
} from "../src/service/client.ts";
import { openSubstrate } from "../src/store/sqlite.ts";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "sb.ts");
const NODE = process.execPath;

function makeRepo(label: string): string {
  const root = tempDir(`sb-ops-${label}-`);
  const git = (args: string[]): void => {
    const done = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(done.status, 0, done.stderr);
  };
  git(["init", "-q", "."]);
  git(["remote", "add", "origin", `git@github.com:xtrm-dev/${label}.git`]);
  return root;
}

function makeStore(root: string, label: string): string {
  const db = join(tempDir(`sb-ops-db-${label}-`), "state.db");
  const done = spawnSync(NODE, [CLI, "init", "--db", db], { cwd: root, encoding: "utf8" });
  assert.equal(done.status, 0, done.stdout + done.stderr);
  return db;
}

function remoteService(db: string): SubstrateService {
  const link = spawnLink([NODE, CLI, "serve", "--stdio", "--db", db]);
  return createServiceClient(link, { timeoutMs: 10_000, remoteLabel: "ssh:test" });
}

interface Ctx {
  gitRoot: string;
  otherRoot: string;
  projectId: string;
  issueId: string;
  ref: string;
  noteEntryId: string;
  checkpointEntryId: string;
  receiptId: string;
  commitReceiptId: string;
  freshBindingId: string;
  capsule: Record<string, unknown>;
}

const CONTRACT = {
  problem: "a consumer needs the operations it already calls",
  success: "each one behaves the same over the wire as in process",
  scope: ["the operation table"],
  nonGoals: ["changing the consumers"],
  constraints: ["no SQL over the wire"],
  validation: [{ check: "the table runs both ways" }],
  output: [{ artifact: "a row" }],
};

const SHA = "0123456789abcdef0123456789abcdef01234567";

/**
 * Builds the state every fixture needs, once, identically on both paths.
 *
 * The issue is attested ready, because claim, gate and dispatch all refuse an
 * unattested Issue; a receipt exists so artifact and commit operations have one;
 * a second binding stays unallocated so receipt allocation can be exercised; and
 * two authority rows exist so one can be removed while the other is listed.
 */
async function seed(service: SubstrateService, gitRoot: string, otherRoot: string): Promise<Ctx> {
  const project = await service.call<{ projectId: string }>("issue.resolveProject", { gitRoot });
  const created = await service.call<{ id: string; humanRef: string }>("issue.create", {
    input: {
      projectId: project.projectId,
      title: "operations",
      kind: "task",
      contract: CONTRACT,
      scrutiny: "LOW",
      authoredBy: "test",
    },
  });
  await service.call("issue.attestReadiness", {
    issueId: created.id,
    outcome: "ready",
    policy: "default",
    attestedBy: "test",
  });
  const note = await service.call<{ id: string }>("journal.appendEntry", {
    issueId: created.id,
    input: { kind: "note", mechanical: { issueId: created.id, issueRevision: 1, contractHash: "0000", summary: "seed" } },
  });
  const checkpoint = await service.call<{ entry: { id: string } }>("journal.checkpoint", {
    issueId: created.id,
    input: {
      mechanical: { issueId: created.id, issueRevision: 1, contractHash: "0000", summary: "seed checkpoint" },
    },
  });
  const dispatch = async (workspace: string): Promise<string> => {
    const binding = await service.call<{ id: string }>("provenance.dispatch", {
      issueId: created.id,
      input: { workspace, participantId: "seed" },
    });
    return binding.id;
  };
  const bindingId = await dispatch(gitRoot);
  const receipt = await service.call<{ id: string }>("provenance.allocateReceipt", { bindingId });
  const commitBindingId = await dispatch(otherRoot);
  const commitReceipt = await service.call<{ id: string }>("provenance.allocateReceipt", { bindingId: commitBindingId });
  const freshBindingId = await dispatch(join(otherRoot, "fresh"));
  const capsule = await service.call<Record<string, unknown>>("resume.buildCapsule", { issueId: created.id });
  await service.call("authority.record", {
    activationId: "act_seed",
    specialist: "seed",
    state: "running",
    issueRef: created.humanRef,
    lastActivityAt: 1,
  });
  await service.call("authority.record", {
    activationId: "act_remove",
    specialist: "ops",
    state: "running",
    issueRef: created.humanRef,
    lastActivityAt: 2,
  });
  return {
    gitRoot,
    otherRoot,
    projectId: project.projectId,
    issueId: created.id,
    ref: created.humanRef,
    noteEntryId: note.id,
    checkpointEntryId: checkpoint.entry.id,
    receiptId: receipt.id,
    commitReceiptId: commitReceipt.id,
    freshBindingId,
    capsule,
  };
}

/** One valid argument set per operation: shapes a consumer would actually send. */
const FIXTURES: Record<string, (ctx: Ctx) => Record<string, unknown>> = {
  "issue.resolveRef": (c) => ({ ref: c.ref }),
  "issue.resolveRefInProject": (c) => ({ ref: c.ref, projectId: c.projectId }),
  "issue.get": (c) => ({ issueId: c.issueId }),
  "issue.getRevision": (c) => ({ issueId: c.issueId, revision: 1 }),
  "issue.listEvents": (c) => ({ issueId: c.issueId }),
  "issue.getReadiness": (c) => ({ issueId: c.issueId }),
  "issue.unsatisfiedBlockers": (c) => ({ issueId: c.issueId }),
  "issue.getActiveClaim": (c) => ({ issueId: c.issueId }),
  "issue.getParent": (c) => ({ issueId: c.issueId }),
  "issue.getResolvedContext": (c) => ({ issueId: c.issueId }),
  "issue.resolveProject": (c) => ({ gitRoot: c.gitRoot }),
  "issue.queryAllIssues": (c) => ({ query: { project: c.projectId } }),
  "issue.create": (c) => ({
    input: {
      projectId: c.projectId,
      title: "second",
      kind: "task",
      contract: CONTRACT,
      scrutiny: "LOW",
      authoredBy: "test",
    },
  }),
  "issue.createProject": () => ({ prefix: "SECOND", name: "second project" }),
  "issue.linkCheckout": (c) => ({ gitRoot: join(c.otherRoot, "linked"), projectId: c.projectId }),
  "issue.listLinks": () => ({}),
  "issue.updateContract": (c) => ({
    issueId: c.issueId,
    contract: { ...CONTRACT, problem: "a consumer needs a revised contract" },
    authoredBy: "test",
    opts: { expectedRevision: 1 },
  }),
  "issue.setTitle": (c) => ({ issueId: c.issueId, title: "renamed" }),
  "issue.setPriority": (c) => ({ issueId: c.issueId, priority: 2 }),
  "issue.setScrutiny": (c) => ({ issueId: c.issueId, scrutiny: "MEDIUM", authoredBy: "test" }),
  "issue.claimIssue": (c) => ({ issueId: c.issueId, holder: "holder-a", ttlMs: 60_000 }),
  "issue.claimReady": (c) => ({
    issueId: c.issueId,
    holder: "holder-b",
    attestation: { outcome: "ready", policy: "default", attestedBy: "test" },
  }),
  "issue.renewClaim": (c) => ({ issueId: c.issueId, holder: "holder-a", ttlMs: 120_000 }),
  "issue.releaseClaim": (c) => ({ issueId: c.issueId, holder: "holder-a" }),
  "issue.latestAttestation": (c) => ({ issueId: c.issueId }),
  "issue.attestReadiness": (c) => ({
    issueId: c.issueId,
    outcome: "ready",
    policy: "default",
    attestedBy: "test",
  }),
  "issue.appendEvent": (c) => ({
    issueId: c.issueId,
    type: "journal.checkpoint_degraded",
    payload: { entry: c.noteEntryId, sequence: 2, reason: "no summarizer" },
  }),
  "gate.check": (c) => ({ request: { ref: c.ref, specialist: "worker", holder: "holder-a", workspace: c.gitRoot } }),
  "gate.dispatch": (c) => ({ request: { ref: c.ref, specialist: "worker", holder: "holder-a", workspace: c.gitRoot } }),
  "store.get": (c) => ({ ref: c.ref }),
  "store.addJournal": (c) => ({ ref: c.ref, kind: "note", semantic: { summary: "the same journal write on both paths" } }),
  "journal.appendEntry": (c) => ({
    issueId: c.issueId,
    input: { kind: "finding", mechanical: { issueId: c.issueId, issueRevision: 1, contractHash: "0000", summary: "second" } },
  }),
  "journal.listEntries": (c) => ({ issueId: c.issueId, limit: 5 }),
  "journal.latest": (c) => ({ issueId: c.issueId, kind: "note" }),
  "journal.latestCheckpoint": (c) => ({ issueId: c.issueId }),
  "journal.since": (c) => ({ issueId: c.issueId, cursor: 1 }),
  "journal.checkpoint": (c) => ({
    issueId: c.issueId,
    input: { mechanical: { issueId: c.issueId, issueRevision: 1, contractHash: "0000", summary: "checkpoint" } },
  }),
  "journal.compactionCheckpoint": (c) => ({
    issueId: c.issueId,
    input: { mechanical: { issueId: c.issueId, issueRevision: 1, contractHash: "0000", summary: "compaction" } },
  }),
  "journal.collectMechanical": (c) => ({ issueId: c.issueId, input: {} }),
  "journal.renderCheckpoint": (c) => ({ entry: { sequence: 1, kind: "note", createdAt: 1, issueRevision: 1 } }),
  "journal.getEntry": (c) => ({ entryId: c.noteEntryId }),
  "journal.timeline": (c) => ({ issueId: c.issueId, limit: 5 }),
  "journal.enrichEntry": (c) => ({ entryId: c.checkpointEntryId, semantic: { summary: "enriched" } }),
  "provenance.dispatch": (c) => ({ issueId: c.issueId, input: { workspace: join(c.otherRoot, "third"), participantId: "test" } }),
  "provenance.allocateReceipt": (c) => ({ bindingId: c.freshBindingId }),
  "provenance.attachArtifact": (c) => ({ receiptId: c.receiptId, kind: "validation", value: "npx tsc --noEmit: clean" }),
  "provenance.bindCommit": (c) => ({ receiptId: c.commitReceiptId, sha: SHA }),
  "provenance.listReceipts": (c) => ({ issueId: c.issueId }),
  "provenance.listBindings": (c) => ({ issueId: c.issueId }),
  "provenance.trace": (c) => ({ issueId: c.issueId }),
  "provenance.findByCommit": () => ({ sha: SHA }),
  "provenance.findByPr": () => ({ ref: "https://github.com/xtrm-dev/ops/pull/1" }),
  "provenance.listArtifacts": (c) => ({ receiptId: c.receiptId, liveOnly: true }),
  "provenance.sessionDetail": () => ({ sessionId: "session-x" }),
  "provenance.dispatchGraph": (c) => ({ projectId: c.projectId }),
  "provenance.activationDetail": () => ({ activationId: "act-x" }),
  "resume.buildCapsule": (c) => ({ issueId: c.issueId }),
  "resume.renderCapsule": (c) => ({ capsule: c.capsule }),
  "authority.record": (c) => ({
    activationId: "act_ops",
    specialist: "ops",
    state: "running",
    issueRef: c.ref,
    lastActivityAt: 2,
  }),
  "authority.remove": () => ({ activationId: "act_remove", specialist: "ops" }),
  "authority.list": () => ({ activeOnly: true, limit: 5 }),
};

/**
 * Preconditions for operations that need a state the seed does not leave behind.
 * Run on the store under test before the fixture, so both paths start alike.
 */
const PREPARE: Record<string, (service: SubstrateService, ctx: Ctx) => Promise<unknown>> = {
  "issue.renewClaim": (service, ctx) =>
    service.call("issue.claimIssue", { issueId: ctx.issueId, holder: "holder-a", ttlMs: 60_000 }),
  "issue.releaseClaim": (service, ctx) =>
    service.call("issue.claimIssue", { issueId: ctx.issueId, holder: "holder-a", ttlMs: 60_000 }),
  // Dispatch needs the work claimable: the gate refuses an unclaimed Issue.
  "gate.dispatch": (service, ctx) =>
    service.call("issue.claimIssue", { issueId: ctx.issueId, holder: "holder-a", ttlMs: 60_000 }),
};

/** Operations that change the store: each runs on its own copy of the seed. */
const MUTATING = new Set([
  "issue.create",
  "issue.createProject",
  "issue.linkCheckout",
  "issue.updateContract",
  "issue.setTitle",
  "issue.setPriority",
  "issue.setScrutiny",
  "issue.claimIssue",
  "issue.claimReady",
  "issue.renewClaim",
  "issue.releaseClaim",
  "issue.attestReadiness",
  "issue.appendEvent",
  "gate.dispatch",
  "store.addJournal",
  "journal.appendEntry",
  "journal.checkpoint",
  "journal.compactionCheckpoint",
  "journal.enrichEntry",
  "provenance.dispatch",
  "provenance.allocateReceipt",
  "provenance.attachArtifact",
  "provenance.bindCommit",
  "authority.record",
  "authority.remove",
]);

/** Key shape of a result, so two stores can be compared without their ids. */
function shape(value: unknown, depth = 0): unknown {
  if (depth > 3) return typeof value;
  if (Array.isArray(value)) return value.length === 0 ? [] : [shape(value[0], depth + 1)];
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = shape((value as Record<string, unknown>)[key], depth + 1);
    }
    return out;
  }
  return typeof value;
}

/** Values a consumer compares, with the wall-clock fields masked. */
// Anything that differs only because the two paths ran milliseconds apart, plus
// generated identifiers: what must match is the content a consumer reads.
const VOLATILE = /^(?:[a-z]+Id|[a-z]+At|timestamp|cursor|nextCursor|contractHash|hash|sequence|id|ref|humanRef|path|workspace|version)$/;

function normalise(value: unknown, depth = 0): unknown {
  if (depth > 6) return typeof value;
  if (Array.isArray(value)) return value.map((entry) => normalise(entry, depth + 1));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = VOLATILE.test(key) ? "<masked>" : normalise((value as Record<string, unknown>)[key], depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * What a consumer would notice after an operation: issue rows, journal entries,
 * receipts, bindings and the live authority rows. Two stores that answer alike but
 * differ here took different actions.
 */
async function fingerprint(service: SubstrateService, ctx: Ctx): Promise<Record<string, unknown>> {
  const issues = await service.call<Array<{ title: string; lifecycleState: string; currentRevision: number }>>(
    "issue.queryAllIssues",
    { query: { project: ctx.projectId } },
  );
  const entries = await service.call<Array<{ kind: string; sequence: number; participantId: string | null }>>(
    "journal.listEntries",
    { issueId: ctx.issueId, limit: 100 },
  );
  const receipts = await service.call<unknown[]>("provenance.listReceipts", { issueId: ctx.issueId });
  const bindings = await service.call<unknown[]>("provenance.listBindings", { issueId: ctx.issueId });
  const authority = await service.call<{ rows: Array<{ activationId: string; state: string; specialist: string }> }>(
    "authority.list",
    { limit: 100 },
  );
  return {
    issues: issues.map((issue) => [issue.title, issue.lifecycleState, issue.currentRevision]),
    entries: entries.map((entry) => [entry.kind, entry.sequence, entry.participantId]),
    receipts: receipts.length,
    bindings: bindings.length,
    authority: authority.rows.map((row) => [row.activationId, row.state, row.specialist]),
  };
}

function copyStore(from: string, label: string): string {
  const dir = tempDir(`sb-ops-${label}-`);
  const to = join(dir, "state.db");
  // The WAL is checkpointed by closing the seeder, so the main file is the state.
  copyFileSync(from, to);
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(from + suffix)) copyFileSync(from + suffix, to + suffix);
  }
  return to;
}

interface Outcome {
  ok: boolean;
  code?: string;
  value?: unknown;
}

async function attempt(service: SubstrateService, op: string, args: Record<string, unknown>): Promise<Outcome> {
  try {
    const result = await service.call(op, args);
    return { ok: true, value: result };
  } catch (error) {
    assert.ok(error instanceof ServiceCallError, `a call failure must be a ServiceCallError, got ${String(error)}`);
    return { ok: false, code: error.code };
  }
}

describe("the operation table, both ways", () => {
  it("has an argument list for every operation and a fixture for every operation", () => {
    const ops = Object.keys(OPERATIONS).sort();
    assert.deepEqual(ops, [...CAPABILITIES].sort());
    const missingArgs = ops.filter((op) => ARGS[op] === undefined);
    assert.deepEqual(missingArgs, [], "an operation without an ARGS entry cannot refuse unknown fields");
    const missingFixture = ops.filter((op) => FIXTURES[op] === undefined);
    assert.deepEqual(missingFixture, [], "every operation needs a valid argument set in this test");
    // And the other way: a fixture or an argument list for an operation that does
    // not exist means the table lost an operation a consumer calls.
    const ghosts = [...Object.keys(FIXTURES), ...Object.keys(ARGS)].filter((op) => !ops.includes(op));
    assert.deepEqual([...new Set(ghosts)].sort(), [], "the table must contain every operation consumers call");
  });

  it("answers every operation the same way over the wire as in process", async () => {
    // The wire never carries the client process's ambient identity (the server strips
    // it), so the in-process mode is compared with the same identity absent. Otherwise
    // this test would compare two different actors rather than two paths.
    const ambient = [
      "XTRM_SESSION_NAME",
      "XTRM_SESSION_ID",
      "SUBSTRATE_HOLDER",
      "SUBSTRATE_ISSUE_REF",
      "SUBSTRATE_ISSUE",
      "SUBSTRATE_ACTIVATION_ID",
      "SUBSTRATE_SPECIALIST",
    ];
    const saved = ambient.map((key) => [key, process.env[key]] as const);
    for (const key of ambient) delete process.env[key];
    try {
      await compareEveryOperation();
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  async function compareEveryOperation(): Promise<void> {
    const root = makeRepo("operations");
    const otherRoot = makeRepo("operations-other");
    // One seeded store, then a copy per operation: a mutating fixture would
    // otherwise change the state the next operation sees, and identical starting
    // states are what make a value comparison meaningful.
    const seedDb = makeStore(root, "seed");
    const seeder = createLocalService(seedDb, "test");
    let ctx: Ctx;
    try {
      ctx = await seed(seeder, root, otherRoot);
    } finally {
      await seeder.close();
    }
    const divergences: string[] = [];
    for (const op of Object.keys(OPERATIONS).sort()) {
      const wireDb = copyStore(seedDb, "wire");
      const localDb = copyStore(seedDb, "local");
      const wire = remoteService(wireDb);
      const local = createLocalService(localDb, "test");
      try {
        try {
          if (PREPARE[op]) await PREPARE[op]!(wire, ctx);
          if (PREPARE[op]) await PREPARE[op]!(local, ctx);
        } catch (error) {
          divergences.push(`${op} prepare: ${(error as Error).message}`);
          await wire.close();
          await local.close();
          continue;
        }
        const args = FIXTURES[op]!(ctx);
        const viaWire = await attempt(wire, op, args);
        const inProcess = await attempt(local, op, args);
        if (viaWire.ok !== inProcess.ok || viaWire.code !== inProcess.code) {
          divergences.push(`${op}: wire ${viaWire.ok ? "ok" : viaWire.code} vs local ${inProcess.ok ? "ok" : inProcess.code}`);
          continue;
        }
        // Same answer, not merely the same shape: the values are what a consumer
        // reads, and a fixture that fails on both sides proves nothing.
        try {
          assert.deepEqual(normalise(viaWire.value), normalise(inProcess.value), `${op} answers differently over the wire`);
        } catch (error) {
          divergences.push(`${op}: ${(error as Error).message.split("\n")[0]}`);
          if (process.env["SB_OPS_DEBUG"]) {
            console.error(op, "WIRE", JSON.stringify(normalise(viaWire.value)).slice(0, 900));
            console.error(op, "LOCAL", JSON.stringify(normalise(inProcess.value)).slice(0, 900));
          }
          continue;
        }
        if (!viaWire.ok) divergences.push(`${op}: fixture fails on both paths (${viaWire.code}) — it proves nothing`);
        if (MUTATING.has(op)) {
          const afterWire = await fingerprint(wire, ctx);
          const afterLocal = await fingerprint(local, ctx);
          try {
            assert.deepEqual(afterWire, afterLocal, `${op} left a different store behind`);
          } catch (error) {
            divergences.push(`${op} side effects: ${(error as Error).message.split("\n")[0]}`);
          }
        }
      } catch (error) {
        divergences.push(`${op} threw: ${(error as Error).message}`);
      } finally {
        await wire.close();
        await local.close();
      }
    }
    assert.deepEqual(divergences, [], "every operation must answer, and change the store, alike on both paths");
  }

  it("refuses an argument name no operation reads", async () => {
    const root = makeRepo("unknown-args");
    const db = makeStore(root, "one");
    const service = createLocalService(db, "test");
    try {
      const ctx = await seed(service, root, makeRepo("other"));
      const refusals: string[] = [];
      for (const op of Object.keys(OPERATIONS).sort()) {
        const args = { ...FIXTURES[op]!(ctx), notAnArgument: 1 };
        const outcome = await attempt(service, op, args);
        if (outcome.ok || outcome.code !== "bad_request") refusals.push(`${op}: ${outcome.ok ? "accepted" : outcome.code}`);
      }
      assert.deepEqual(refusals, [], "a misspelt argument must be refused, not silently ignored");
    } finally {
      await service.close();
    }
  });

  it("refuses each invalid argument class with bad_request", async () => {
    const root = makeRepo("invalid");
    const db = makeStore(root, "one");
    const service = createLocalService(db, "test");
    try {
      const ctx = await seed(service, root, makeRepo("other"));
      const cases: Array<[string, Record<string, unknown>]> = [
        ["issue.get", { issueId: "" }],
        ["issue.getRevision", { issueId: ctx.issueId, revision: 1.5 }],
        ["issue.getRevision", { issueId: ctx.issueId, revision: 1e300 }],
        ["issue.queryAllIssues", { query: [] }],
        ["journal.getEntry", { entryId: 7 }],
        ["authority.record", { activationId: "act_x", specialist: "ops", state: "running", lastActivityAt: "soon" }],
        ["authority.record", { activationId: "act x", specialist: "ops", state: "running", lastActivityAt: 1 }],
        ["authority.record", { activationId: "act_x", specialist: "ops", state: "invented", lastActivityAt: 1 }],
        ["provenance.attachArtifact", { receiptId: "wr_x", kind: "invented", value: "v" }],
        ["issue.claimIssue", { issueId: ctx.issueId, holder: "h", ttlMs: 0 }],
        ["journal.since", { issueId: ctx.issueId, cursor: 5_000_000_000 }],
      ];
      for (const [op, args] of cases) {
        const outcome = await attempt(service, op, args);
        assert.equal(outcome.ok, false, `${op} accepted ${JSON.stringify(args)}`);
        assert.equal(outcome.code, "bad_request", `${op} answered ${outcome.code} for ${JSON.stringify(args)}`);
      }
    } finally {
      await service.close();
    }
  });
});

describe("the transport fails closed and by name", () => {
  it("survives a child that closes its stdin after the handshake (EPIPE)", async () => {
    const script = [
      'const fs = require("node:fs");',
      'let buffer = "";',
      'process.stdin.on("data", (chunk) => {',
      "  buffer += chunk.toString('utf8');",
      "  let index;",
      "  while ((index = buffer.indexOf('\\n')) >= 0) {",
      "    const line = buffer.slice(0, index);",
      "    buffer = buffer.slice(index + 1);",
      "    const request = JSON.parse(line);",
      "    if (request.op === 'hello') {",
      "      process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: { protocol: 1, substrate: 'fake', dbPath: '', capabilities: [] } }) + '\\n');",
      "      fs.closeSync(0);",
      "    }",
      "  }",
      "});",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const service = createServiceClient(spawnLink([NODE, "-e", script]), {
      timeoutMs: 4000,
      remoteLabel: "ssh:fake",
    });
    await service.ready();
    await assert.rejects(
      async () => service.call("issue.get", { issueId: "iss_x" }),
      (error: unknown) => {
        assert.ok(error instanceof ServiceCallError);
        assert.equal(error.code, "connection_lost", `expected connection_lost, got ${error.code}: ${error.message}`);
        return true;
      },
    );
    await service.close();
  });

  it("names an sb without the verb as not_installed, not as a dropped connection", async () => {
    const script = 'process.stderr.write("sb: serve: usage: sb serve --stdio\\n"); process.exit(1);';
    const service = createServiceClient(spawnLink([NODE, "-e", script]), { timeoutMs: 4000, remoteLabel: "ssh:old" });
    await assert.rejects(
      async () => service.ready(),
      (error: unknown) => {
        assert.ok(error instanceof ServiceCallError);
        assert.equal(error.code, "not_installed");
        assert.match(error.message, /no `sb serve --stdio`/);
        assert.match(error.message, /ssh:old/);
        return true;
      },
    );
    await service.close();
  });

  it("names stdout noise for what it is", async () => {
    const script = 'process.stdout.write("Welcome to Ubuntu 24.04 LTS\\n"); setInterval(() => {}, 1000);';
    const service = createServiceClient(spawnLink([NODE, "-e", script]), { timeoutMs: 3000, remoteLabel: "ssh:banner" });
    try {
      await assert.rejects(
        async () => service.ready(),
        (error: unknown) => {
          assert.ok(error instanceof ServiceCallError);
          assert.equal(error.code, "peer_noise");
          assert.match(error.message, /Welcome to Ubuntu/);
          return true;
        },
      );
    } finally {
      await Promise.race([service.close(), new Promise<void>((resolve) => setTimeout(resolve, 4000))]);
    }
  });

  it("names a protocol mismatch separately from a broken peer", async () => {
    const script = [
      "process.stdin.on('data', (chunk) => {",
      "  for (const line of chunk.toString('utf8').split('\\n').filter(Boolean)) {",
      "    const request = JSON.parse(line);",
      "    process.stdout.write(JSON.stringify({ id: request.id, ok: false, error: { code: 'unsupported', message: 'protocol 9 is not supported by this server (it speaks 1)' } }) + '\\n');",
      "  }",
      "});",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const service = createServiceClient(spawnLink([NODE, "-e", script]), { timeoutMs: 3000, remoteLabel: "ssh:skew" });
    await assert.rejects(
      async () => service.ready(),
      (error: unknown) => {
        assert.ok(error instanceof ServiceCallError);
        assert.equal(error.code, "protocol_mismatch");
        assert.match(error.message, /ssh:skew/);
        return true;
      },
    );
    await service.close();
  });

  it("names a program that cannot start as spawn_failed", async () => {
    const service = createServiceClient(spawnLink(["/nonexistent/service-program"]), { timeoutMs: 3000 });
    await assert.rejects(
      async () => service.ready(),
      (error: unknown) => {
        assert.ok(error instanceof ServiceCallError);
        assert.equal(error.code, "spawn_failed");
        return true;
      },
    );
    await service.close();
  });

  it("times out with its own bound, so a mutant that removes the timer fails here", async () => {
    const script = [
      "process.stdin.on('data', (chunk) => {",
      "  for (const line of chunk.toString('utf8').split('\\n').filter(Boolean)) {",
      "    const request = JSON.parse(line);",
      "    if (request.op === 'hello') {",
      "      process.stdout.write(JSON.stringify({ id: request.id, ok: true, result: { protocol: 1, substrate: 'fake', dbPath: '', capabilities: [] } }) + '\\n');",
      "    }",
      "  }",
      "});",
      "setInterval(() => {}, 1000);",
    ].join("\n");
    const service = createServiceClient(spawnLink([NODE, "-e", script]), { timeoutMs: 150, remoteLabel: "ssh:silent" });
    try {
    await service.ready();
    // The race is the point: if the call never settles, this fails in two seconds
    // instead of hanging the suite, so a missing timer is a failed test, not a stall.
    const outcome = await Promise.race([
      service.call("issue.get", { issueId: "iss_x" }).then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      ),
      new Promise<{ kind: "hung" }>((resolve) => setTimeout(() => resolve({ kind: "hung" }), 2000)),
    ]);
    assert.equal(outcome.kind, "rejected", "the call settled although the server never answered");
    const error = (outcome as { error: unknown }).error;
    assert.ok(error instanceof ServiceCallError);
    assert.equal(error.code, "timeout");
    assert.match(error.message, /not cancelled/);
    } finally {
      // Closed even when an assertion above failed: a live child would keep the
      // runner's event loop busy and turn a failed test into a stalled suite.
      await Promise.race([service.close(), new Promise<void>((resolve) => setTimeout(resolve, 4000))]);
    }
  });

  it("fails closed when the remote is configured but unusable", () => {
    const config = join(tempDir("sb-ops-config-"), "substrate.json");
    writeFileSync(config, JSON.stringify({ remote: "ssh:server", remoteSb: null, serverVersion: null, checkouts: {} }));
    assert.throws(
      () => openService({ env: { ...process.env, SUBSTRATE_REMOTE_CONFIG: config, SUBSTRATE_DB: undefined } }),
      /no absolute server sb path is recorded for ssh:server/,
    );
  });
});

describe("openSshService", () => {
  it("runs ssh with the options, host and command it documents", async () => {
    const dir = tempDir("sb-ops-ssh-");
    const log = join(dir, "argv.json");
    const shim = join(dir, "ssh");
    writeFileSync(
      shim,
      '#!/bin/sh\nprintf \'%s\\n\' "$@" > "$SSH_SHIM_LOG"\nfor a in "$@"; do last="$a"; done\nexec sh -c "$last"\n',
    );
    chmodSync(shim, 0o755);
    const { service, link } = openSshService({
      host: "fake-host",
      sbPath: "/nonexistent/sb",
      root: "/srv/repo",
      env: { ...process.env, PATH: `${dir}:${process.env["PATH"] ?? ""}`, SSH_SHIM_LOG: log },
    });
    await assert.rejects(async () => service.ready());
    const argv = readFileSync(log, "utf8").split("\n").filter((line) => line !== "");
    assert.equal(argv[0], "-T", "no pseudo-terminal: the frames are binary-safe lines");
    assert.ok(argv.includes("BatchMode=yes"));
    assert.ok(argv.includes("ForwardAgent=no"));
    assert.ok(argv.includes("ClearAllForwardings=yes"));
    assert.equal(argv[argv.length - 2], "fake-host");
    assert.equal(argv[argv.length - 1], "cd '/srv/repo' && '/nonexistent/sb' serve --stdio");
    await link.close();
  });
});

describe("activation authority", () => {
  it("lists the rows the SessionStart reader lists", async () => {
    const db = makeStore(makeRepo("authority-parity"), "one");
    const service = createLocalService(db, "test");
    try {
      const rows: Array<[string, string, number]> = [
        ["act_old", "running", 10],
        ["act_new", "waiting", 30],
        ["act_mid", "needs_reply", 20],
        ["act_done", "settled", 40],
        ["act_stopped", "stopped", 50],
      ];
      for (const [activationId, state, lastActivityAt] of rows) {
        await service.call("authority.record", {
          activationId,
          specialist: "parity",
          state,
          issueRef: null,
          lastActivityAt,
        });
      }
      const answer = await service.call<{ rows: Array<{ activationId: string; state: string }> }>("authority.list", {
        activeOnly: true,
        limit: 2,
      });
      // "Live" is the reader's own definition: everything except the two states it
      // filters. A stopped row therefore still lists until its host forgets it,
      // which is what the host's stop() does.
      assert.deepEqual(
        answer.rows.map((row) => row.activationId),
        ["act_stopped", "act_new"],
        "the reader's rows only, newest first, limited",
      );
      // The same query the specialists SessionStart reader runs, against the file.
      const store = openSubstrate(db);
      try {
        const direct = store
          .prepare(
            `SELECT activation_id FROM activations WHERE state NOT IN ('settled', 'disposed')
               ORDER BY last_activity_at DESC LIMIT ?`,
          )
          .all(2) as Array<{ activation_id: string }>;
        assert.deepEqual(answer.rows.map((row) => row.activationId), direct.map((row) => row.activation_id));
      } finally {
        store.close();
      }
    } finally {
      await service.close();
    }
  });

  it("accepts what the specialists writer accepts, and refuses what would poison a listing", async () => {
    const db = makeStore(makeRepo("authority-writer"), "one");
    const service = createLocalService(db, "test");
    try {
      // The writer stores whatever its host passes: an empty issue ref for an
      // activation without one, and 0 for a row not touched yet.
      await service.call("authority.record", {
        activationId: "act_untouched",
        specialist: "writer",
        state: "starting",
        issueRef: "",
        lastActivityAt: 0,
      });
      const listed = await service.call<{ rows: Array<{ activationId: string; issueRef: string | null }> }>(
        "authority.list",
        { activationId: "act_untouched" },
      );
      assert.equal(listed.rows[0]?.issueRef, null, "an empty issue ref is no issue ref");

      // The host woken turn writes settled -> running; the authority follows it.
      await service.call("authority.record", {
        activationId: "act_untouched",
        specialist: "writer",
        state: "settled",
        issueRef: null,
        lastActivityAt: 10,
      });
      await service.call("authority.record", {
        activationId: "act_untouched",
        specialist: "writer",
        state: "running",
        issueRef: null,
        lastActivityAt: 20,
      });
      // Its stop() forgets a row it last saved as running, by id and specialist.
      const removal = await service.call<{ removed: boolean }>("authority.remove", {
        activationId: "act_untouched",
        specialist: "writer",
      });
      assert.equal(removal.removed, true, "a stopped activation can be forgotten by its own specialist");
      // A different specialist may not touch the row at all.
      await service.call("authority.record", {
        activationId: "act_owned",
        specialist: "owner",
        state: "running",
        issueRef: null,
        lastActivityAt: 30,
      });
      await assert.rejects(
        async () =>
          service.call("authority.remove", { activationId: "act_owned", specialist: "intruder" }),
        (error: unknown) => {
          assert.ok(error instanceof ServiceCallError);
          assert.equal(error.code, "conflict");
          return true;
        },
      );

      // Ownership is required, not optional (XTRM-700): an unnamed removal used to
      // delete any row by id alone, including another specialist's live one.
      await assert.rejects(
        async () => service.call("authority.remove", { activationId: "act_owned" }),
        (error: unknown) => {
          assert.ok(error instanceof ServiceCallError);
          assert.equal(error.code, "bad_request");
          assert.match(error.message, /specialist/);
          return true;
        },
      );
      // The refused call must leave the row exactly where it was.
      const stillThere = await service.call<{ rows: Array<{ activationId: string }> }>("authority.list", {
        activationId: "act_owned",
        limit: 5,
      });
      assert.deepEqual(
        stillThere.rows.map((r) => r.activationId),
        ["act_owned"],
        "an unnamed removal must not delete a row it did not name an owner for",
      );
      // Naming the owner of a row that is already gone is an idempotent stop, not
      // an error: the host forgets activations it has just stopped.
      const gone = await service.call<{ removed: boolean }>("authority.remove", {
        activationId: "act_never_recorded",
        specialist: "writer",
      });
      assert.equal(gone.removed, false);

      await assert.rejects(
        async () =>
          service.call("authority.record", {
            activationId: "act_future",
            specialist: "writer",
            state: "running",
            issueRef: null,
            lastActivityAt: Date.now() + 10 * 365 * 24 * 3600 * 1000,
          }),
        (error: unknown) => {
          assert.ok(error instanceof ServiceCallError);
          assert.equal(error.code, "bad_request");
          return true;
        },
      );
    } finally {
      await service.close();
    }
  });
});

describe("identity, refusals and the transport's own edges", () => {
  it("stores the same participant and execution context local and remote (MEDIUM identity)", async () => {
    const repo = makeRepo("identity-parity");
    const db = makeStore(repo, "one");
    const well = createLocalService(db, "test");
    const ctx = await seed(well, repo, makeRepo("identity-other"));
    await well.close();

    const saved = Object.fromEntries(
      ["SUBSTRATE_HOLDER", "XTRM_SESSION_ID", "SUBSTRATE_ACTIVATION_ID"].map((key) => [key, process.env[key]]),
    );
    process.env["SUBSTRATE_HOLDER"] = "identity-holder";
    process.env["XTRM_SESSION_ID"] = "0f7b9e34-6a1e-4b8e-9d95-0d1e6f2f0a11";
    process.env["SUBSTRATE_ACTIVATION_ID"] = "identity-activation";
    try {
      const wireDb = copyStore(db, "identity-wire");
      const localDb = copyStore(db, "identity-local");
      const wire = createServiceClient(spawnLink([NODE, CLI, "serve", "--stdio", "--db", wireDb]));
      const local = createLocalService(localDb, "test");
      try {
        const args = {
          issueId: ctx.issueId,
          input: { kind: "note", semantic: { summary: "identity probe runs the same on both paths" } },
        };
        const sent = await attempt(wire, "journal.appendEntry", args);
        assert.deepEqual(sent, { ok: true, value: sent.ok ? sent.value : undefined }, JSON.stringify(sent));
        const stored = await attempt(local, "journal.appendEntry", args);
        assert.deepEqual(stored, { ok: true, value: stored.ok ? stored.value : undefined }, JSON.stringify(stored));

        const read = (path: string): Array<Record<string, unknown>> => {
          const store = openSubstrate(path);
          try {
            return store
              .prepare(
                "SELECT participant_id, activation_id, session_id FROM issue_journal WHERE issue_id = ? ORDER BY sequence DESC LIMIT 1",
              )
              .all(ctx.issueId) as unknown as Array<Record<string, unknown>>;
          } finally {
            store.close();
          }
        };
        const remoteRow = read(wireDb);
        assert.deepEqual(remoteRow, read(localDb), "the same call must store the same actor on both paths");
        assert.equal(remoteRow[0]?.["participant_id"], "identity-holder");
        assert.equal(remoteRow[0]?.["activation_id"], "identity-activation");
        assert.equal(remoteRow[0]?.["session_id"], "0f7b9e34-6a1e-4b8e-9d95-0d1e6f2f0a11");
      } finally {
        await wire.close();
        await local.close();
      }
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("refuses to enrich anything but a checkpoint with a null semantic layer (HIGH enrichEntry)", async () => {
    const repo = makeRepo("enrich-guard");
    const db = makeStore(repo, "one");
    const service = createLocalService(db, "test");
    try {
      const ctx = await seed(service, repo, makeRepo("enrich-other"));
      const refused = await attempt(service, "journal.enrichEntry", {
        entryId: ctx.noteEntryId,
        semantic: { summary: "x" },
      });
      assert.equal(refused.ok, false);
      assert.equal(refused.code, "conflict", "a note is not a checkpoint");

      const fresh = await attempt(service, "journal.enrichEntry", {
        entryId: ctx.checkpointEntryId,
        semantic: { summary: "first" },
      });
      assert.equal(fresh.ok, true, "a fresh checkpoint may be enriched once");

      const again = await attempt(service, "journal.enrichEntry", {
        entryId: ctx.checkpointEntryId,
        semantic: { summary: "second" },
      });
      assert.equal(again.ok, false, "an enriched checkpoint is not overwritten");
      assert.equal(again.code, "conflict");

      const stored = await service.call<Record<string, Record<string, unknown>>>("journal.getEntry", {
        entryId: ctx.checkpointEntryId,
      });
      assert.deepEqual(stored["semantic"], { summary: "first" }, "the first value survives");
    } finally {
      await service.close();
    }
  });

  it("refuses event types a remote caller could use to forge a closure (appendEvent)", async () => {
    const repo = makeRepo("append-guard");
    const db = makeStore(repo, "one");
    const service = createLocalService(db, "test");
    try {
      const ctx = await seed(service, repo, makeRepo("append-other"));
      const forged = await attempt(service, "issue.appendEvent", {
        issueId: ctx.issueId,
        type: "issue.closed",
        payload: { at: 1 },
      });
      assert.equal(forged.ok, false);
      assert.equal(forged.code, "bad_request");

      const journaled = await attempt(service, "issue.appendEvent", {
        issueId: ctx.issueId,
        type: "journal.checkpoint_degraded",
        payload: { reason: "storage" },
      });
      assert.equal(journaled.ok, true, "the event the MCP server raises must pass");
    } finally {
      await service.close();
    }
  });

  it("returns the values the operations are for, not just a success", async () => {
    const repo = makeRepo("values");
    const db = makeStore(repo, "one");
    const service = createLocalService(db, "test");
    try {
      const ctx = await seed(service, repo, makeRepo("values-other"));
      await service.call("issue.setTitle", { issueId: ctx.issueId, title: "service title" });
      const issue = await service.call<{ title: string }>("issue.get", { issueId: ctx.issueId });
      assert.equal(issue.title, "service title", "setTitle must store the title it was given");

      const note = await service.call<{ id: string; kind: string }>("journal.latest", {
        issueId: ctx.issueId,
        kind: "note",
      });
      assert.equal(note.kind, "note", "journal.latest must honour the kind it was asked for");
      assert.equal(note.id, ctx.noteEntryId);

      const checkpoint = await service.call<{ kind: string }>("journal.latestCheckpoint", { issueId: ctx.issueId });
      assert.equal(checkpoint.kind, "checkpoint");
    } finally {
      await service.close();
    }
  });

  it("gives a domain refusal a stable code instead of internal", async () => {
    const cases: Array<[string, string]> = [
      ["issue ABC-1 is not-claimable while a claim is active", "conflict"],
      ["session ABC-1 cannot be claimed in this state", "conflict"],
      ["unknown journal kind: mechanical", "bad_request"],
      ["invalid sessionId \"nope\": session identity must be a canonical lowercase UUID", "bad_request"],
      ["store is locked", "internal"],
    ];
    for (const [message, code] of cases) {
      assert.equal(classifyError(new Error(message)).code, code, message);
    }
    const leaky = classifyError(new Error("cannot open /home/dawid/.xtrm/state.db (code: 5)"));
    assert.equal(leaky.code, "internal");
    assert.doesNotMatch(leaky.message, /\/home\/dawid/, "a refusal must not carry the store's path");
  });

  it("answers a malformed gate request as a client error, not as an internal one", async () => {
    const repo = makeRepo("gate-guard");
    const db = makeStore(repo, "one");
    const service = createLocalService(db, "test");
    try {
      await seed(service, repo, makeRepo("gate-other"));
      const answer = await attempt(service, "gate.check", { request: {} });
      assert.equal(answer.ok, false);
      assert.equal(answer.code, "bad_request");
    } finally {
      await service.close();
    }
  });

  it("kills a child that ignores SIGTERM", async () => {
    const link = spawnLink([
      NODE,
      "-e",
      "process.on('SIGTERM',()=>{}); process.stdin.resume(); setInterval(()=>{}, 1000);",
    ]);
    const pid = link.pid;
    if (pid === null) throw new Error("no child to signal");
    try {
      const closed = await Promise.race([
        link.close().then(() => true),
        new Promise<boolean>((resolve) => {
          setTimeout(() => resolve(false), 10_000).unref();
        }),
      ]);
      assert.equal(closed, true, "close must return once the escalation has fired");
      assert.throws(
        () => process.kill(pid, 0),
        "the child must be gone when close() returns, not merely signalled",
      );
    } finally {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone: that is the point of the test
      }
    }
  });

  it("reports the end once, even when it happens before a listener is attached", async () => {
    const link = spawnLink([NODE, "-e", "process.exit(3);"]);
    const events: Array<{ code: number | null; kind?: string }> = [];
    try {
      // The child is gone before anyone listens; the report must wait for the listener.
      await new Promise((resolve) => setTimeout(resolve, 200));
      link.onExit((code, _signal, _reason, kind) => events.push({ code, kind }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(events.length, 1, "one report per link");
      assert.equal(events[0]?.kind, "exit");
      assert.equal(events[0]?.code, 3);
    } finally {
      if (link.pid !== null) {
        try {
          process.kill(link.pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    }
  });

  it("drops a line that never ends instead of buffering it (MEDIUM line cap)", async () => {
    const link = spawnLink([
      NODE,
      "-e",
      `process.stdin.resume(); process.stdout.write('x'.repeat(${MAX_FRAME_BYTES + 4096}));`,
    ]);
    try {
      const refused = await Promise.race([
        new Promise<string>((resolve) => {
          link.onExit((_code, _signal, reason) => resolve(reason ?? "no reason"));
        }),
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("nothing was reported"), 5000).unref();
        }),
      ]);
      assert.match(refused, /exceeds|exceeded/);
    } finally {
      if (link.pid !== null) {
        try {
          process.kill(link.pid, "SIGKILL");
        } catch {
          // already gone: that is the point of the test
        }
      }
    }
  });
});

describe("blockers the security pass found", () => {
  it("delivers a response larger than the pipe buffer, newline included", async () => {
    const repo = makeRepo("big-response");
    const db = makeStore(repo, "big");
    const service = remoteService(db);
    try {
      const ctx = await seed(service, repo, makeRepo("big-other"));
      // ~1 MB: far past the 64 KiB pipe buffer, where a single writeSync takes only
      // the part that fits and drops the rest together with its newline.
      const big = "T".repeat(1_000_000);
      await service.call("issue.setTitle", { issueId: ctx.issueId, title: big });
      const read = await service.call<Record<string, unknown>>("issue.get", { issueId: ctx.issueId });
      assert.equal(read["title"], big, "the whole title arrives; a short write truncates it");
      await service.call("issue.listLinks", {});
    } finally {
      await service.close();
    }
  });

  it("lets exactly one of two processes enrich a checkpoint (atomic precondition)", async () => {
    const repo = makeRepo("enrich-race");
    const db = makeStore(repo, "race");
    const first = remoteService(db);
    const second = remoteService(db);
    try {
      const ctx = await seed(first, repo, makeRepo("race-other"));
      const issue = await first.call<{ currentRevision: number; currentContractHash: string }>("issue.get", {
        issueId: ctx.issueId,
      });
      for (const trial of [0, 1, 2, 3, 4]) {
        const appended = await first.call<{ id: string }>("journal.appendEntry", {
          issueId: ctx.issueId,
          input: {
            kind: "checkpoint",
            mechanical: {
              issueId: ctx.issueId,
              issueRevision: issue.currentRevision,
              contractHash: issue.currentContractHash,
            },
          },
        });
        const outcomes = await Promise.allSettled([
          first.call("journal.enrichEntry", { entryId: appended.id, semantic: { summary: `A-${trial}` } }),
          second.call("journal.enrichEntry", { entryId: appended.id, semantic: { summary: `B-${trial}` } }),
        ]);
        const accepted = outcomes.filter((o) => o.status === "fulfilled");
        assert.equal(accepted.length, 1, `trial ${trial}: exactly one writer may win, got ${accepted.length}`);
        const stored = await first.call<Record<string, unknown>>("journal.getEntry", { entryId: appended.id });
        const winner = accepted[0] as PromiseFulfilledResult<Record<string, unknown>>;
        assert.deepEqual(stored["semantic"], winner.value["semantic"], `trial ${trial}: the winner's summary is the one stored`);
      }
    } finally {
      await first.close();
      await second.close();
    }
  });
});

describe("round four: identity where it is listed, values that are not masked", () => {
  it("adds identity only to the operations whose argument table names it (HIGH identity)", async () => {
    const repo = makeRepo("identity-args");
    const db = makeStore(repo, "one");
    const saved = {
      holder: process.env["SUBSTRATE_HOLDER"],
      session: process.env["XTRM_SESSION_ID"],
      activation: process.env["SUBSTRATE_ACTIVATION_ID"],
    };
    process.env["SUBSTRATE_HOLDER"] = "identity-holder";
    process.env["XTRM_SESSION_ID"] = "0f7b9e34-6a1e-4b8e-9d95-0d1e6f2f0a11";
    process.env["SUBSTRATE_ACTIVATION_ID"] = "identity-activation";
    const wire = remoteService(db);
    try {
      const ctx = await seed(wire, repo, makeRepo("identity-args-other"));
      // Each of these was refused before: applyIdentity merged participantId into
      // operations whose ARGS never listed it, and every harness session sets it.
      const claim = await attempt(wire, "issue.claimIssue", {
        issueId: ctx.issueId,
        holder: "identity-holder",
        ttlMs: 60_000,
      });
      assert.equal(claim.ok, true, `claim must accept the identity it lists: ${claim.code ?? "ok"}`);

      const renew = await attempt(wire, "issue.renewClaim", {
        issueId: ctx.issueId,
        holder: "identity-holder",
        ttlMs: 60_000,
      });
      assert.equal(renew.ok, true, `renew must accept the identity it lists: ${renew.code ?? "ok"}`);

      const addJournal = await attempt(wire, "store.addJournal", { ref: ctx.ref, kind: "note", semantic: { summary: "addJournal accepts the identity it lists" } });
      assert.equal(addJournal.ok, true, `addJournal must accept the identity it lists: ${addJournal.code ?? "ok"}`);

      const release = await attempt(wire, "issue.releaseClaim", { issueId: ctx.issueId, holder: "identity-holder" });
      assert.equal(release.ok, true, `release must accept the identity it lists: ${release.code ?? "ok"}`);

      // The identity the table does list is stored, not merely accepted.
      const store = openSubstrate(db);
      try {
        const row = store
          .prepare("SELECT participant_id FROM issue_journal ORDER BY sequence DESC LIMIT 1")
          .get() as { participant_id: string | null } | undefined;
        assert.equal(row?.participant_id, "identity-holder", "addJournal records the caller's holder");
      } finally {
        store.close();
      }
    } finally {
      await wire.close();
      for (const [key, value] of [
        ["SUBSTRATE_HOLDER", saved.holder],
        ["XTRM_SESSION_ID", saved.session],
        ["SUBSTRATE_ACTIVATION_ID", saved.activation],
      ] as Array<[string, string | undefined]>) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("opens a remote service while the harness identity is set (HIGH openService)", async () => {
    const dir = tempDir("sb-open-");
    const configPath = join(dir, "substrate.json");
    writeFileSync(
      configPath,
      JSON.stringify({ remote: "ssh:nowhere.invalid", remoteSb: "/nonexistent/sb", serverVersion: "0.2.4", checkouts: {} }),
    );
    const opened = openService({
      version: "test",
      env: {
        ...process.env,
        SUBSTRATE_REMOTE_CONFIG: configPath,
        SUBSTRATE_HOLDER: "identity-holder",
        XTRM_SESSION_ID: "0f7b9e34-6a1e-4b8e-9d95-0d1e6f2f0a11",
        SUBSTRATE_ACTIVATION_ID: "identity-activation",
        SUBSTRATE_REMOTE: undefined,
        SUBSTRATE_DB: undefined,
      },
    });
    try {
      assert.equal(opened.endpoint.kind, "remote");
      assert.ok(opened.link !== undefined, "the link travels with the service so ssh stderr is reachable");
      // The old default forwarded identity variables that its own allowlist refuses,
      // so merely opening this connection threw before ssh ran.
      const failure = await attempt(opened.service, "issue.listLinks", {});
      assert.equal(failure.ok, false, "nothing listens on nowhere.invalid");
      assert.notEqual(
        failure.code,
        "not_installed",
        "a host that does not resolve is not an sb without the verb: the old pattern matched 'serve' inside 'server'",
      );
    } finally {
      await opened.service.close();
    }
  });

  it("stores the priority it was given, and keeps bindings distinct from receipts (MEDIUM values)", async () => {
    const repo = makeRepo("values-two");
    const db = makeStore(repo, "one");
    const service = createLocalService(db, "test");
    try {
      const ctx = await seed(service, repo, makeRepo("values-two-other"));
      await service.call("issue.setPriority", { issueId: ctx.issueId, priority: 3 });
      const issue = await service.call<{ priority: number }>("issue.get", { issueId: ctx.issueId });
      assert.equal(issue.priority, 3, "setPriority must store the number it was given, not a derivation of it");

      const bindings = await service.call<Array<Record<string, unknown>>>("provenance.listBindings", {
        issueId: ctx.issueId,
      });
      const receipts = await service.call<Array<Record<string, unknown>>>("provenance.listReceipts", {
        issueId: ctx.issueId,
      });
      assert.ok(bindings.length > 0, "the seed binds at least one workspace");
      assert.ok(Array.isArray(receipts), "listReceipts answers a list");
      assert.notDeepEqual(
        bindings.map((binding) => Object.keys(binding).sort()),
        receipts.map((receipt) => Object.keys(receipt).sort()),
        "bindings and receipts are different records, so one must not answer for the other",
      );
    } finally {
      await service.close();
    }
  });

it("refuses an answer past the frame cap with a typed error, and keeps the session", async () => {
    const repo = makeRepo("big-answer");
    const db = makeStore(repo, "one");
    const local = createLocalService(db, "test");
    const wire = remoteService(db);
    try {
      const ctx = await seed(local, repo, makeRepo("big-answer-other"));
      // Written in process: a frame carrying this would itself be past the request cap.
      await local.call("issue.setTitle", { issueId: ctx.issueId, title: "T".repeat(9 * 1024 * 1024) });
      const failure = await wire.call("issue.get", { issueId: ctx.issueId }).then(
        () => null,
        (error: ServiceCallError) => error,
      );
      assert.ok(failure !== null, "an oversized answer must not be written half-way");
      assert.equal(failure.code, "bad_request");
      // A response frame carries no `op`, so the server has to be told which one it
      // is answering: the refusal must name it, not say "the operation".
      assert.match(failure.message, /the answer to "issue\.get" is larger than/);
      await wire.call("issue.listLinks", {});
    } finally {
      await wire.close();
      await local.close();
    }
  });

it("does not read a host called server as an sb without the verb (MEDIUM code)", async () => {
    // The old test for "no sb serve --stdio there" matched the bare word "serve",
    // so a host named `server` that did not resolve was reported as not_installed.
    const dir = tempDir("sb-serve-host-");
    const shim = join(dir, "ssh");
    writeFileSync(shim, '#!/bin/sh\nprintf "ssh: Could not resolve hostname server: Name or service not known\\n" >&2\nexit 255\n');
    chmodSync(shim, 0o755);
    const savedPath = process.env["PATH"];
    process.env["PATH"] = `${dir}:${savedPath ?? ""}`;
    const opened = openSshService({ host: "server", sbPath: "/nonexistent/sb", env: process.env });
    try {
      const failure = await attempt(opened.service, "issue.listLinks", {});
      assert.equal(failure.ok, false);
      assert.notEqual(failure.code, "not_installed", "an unresolvable host is a transport failure, not a missing verb");
    } finally {
      await opened.service.close();
      if (savedPath === undefined) delete process.env["PATH"];
      else process.env["PATH"] = savedPath;
    }
  });

  it("validates activeOnly and bounds an authority listing (MEDIUM list)", async () => {
    const repo = makeRepo("authority-list");
    const db = makeStore(repo, "one");
    const service = createLocalService(db, "test");
    try {
      assert.equal((await attempt(service, "authority.list", { activeOnly: "yes" })).code, "bad_request");
      for (let index = 0; index < 6; index += 1) {
        await service.call("authority.record", {
          activationId: `act_${index}`,
          specialist: "ops",
          state: "running",
          issueRef: null,
          lastActivityAt: 100 + index,
        });
      }
      const bounded = await service.call<{ rows: unknown[] }>("authority.list", { limit: 3 });
      assert.equal(bounded.rows.length, 3, "an unbounded listing would answer past the client's line cap");
    } finally {
      await service.close();
    }
  });
});

describe("gate.dispatch carries the dispatcher identity end to end (XTRM-891)", () => {
  const SESSION = "0f7b9e34-6a1e-4b8e-9d95-0d1e6f2f0a11";

  /** Dispatches once through the given service and returns the stored binding row's dispatcher columns. */
  async function dispatchVia(
    service: SubstrateService,
    ctx: Ctx,
    extra: Record<string, unknown>,
  ): Promise<{ participant: string | null; session: string | null }> {
    const { binding } = await service.call<{ binding: { id: string } }>("gate.dispatch", {
      request: { ref: ctx.ref, specialist: "worker", holder: "holder-a", workspace: ctx.gitRoot, ...extra },
    });
    const rows = await service.call<Array<{ id: string; dispatcherParticipantId: string | null; dispatcherSessionId: string | null }>>(
      "provenance.listBindings",
      { issueId: ctx.issueId },
    );
    const stored = rows.find((row) => row.id === binding.id);
    assert.ok(stored, "the new binding is listed");
    return { participant: stored.dispatcherParticipantId, session: stored.dispatcherSessionId };
  }

  async function prepared(label: string): Promise<{ db: string; ctx: Ctx }> {
    const repo = makeRepo(label);
    const db = makeStore(repo, label);
    const seeder = createLocalService(db, "test");
    try {
      const ctx = await seed(seeder, repo, makeRepo(`${label}-other`));
      await seeder.call("issue.claimIssue", { issueId: ctx.issueId, holder: "holder-a", ttlMs: 60_000 });
      return { db, ctx };
    } finally {
      await seeder.close();
    }
  }

  it("stores both fields through the wire exactly as in process", async () => {
    const { db, ctx } = await prepared("dispatcher-parity");
    const wireDb = copyStore(db, "dispatcher-wire");
    const localDb = copyStore(db, "dispatcher-local");
    const wire = remoteService(wireDb);
    const local = createLocalService(localDb, "test");
    try {
      const fields = { dispatcherParticipantId: "lead-g04z", dispatcherSessionId: SESSION };
      const sent = await dispatchVia(wire, ctx, fields);
      const stored = await dispatchVia(local, ctx, fields);
      assert.deepEqual(sent, { participant: "lead-g04z", session: SESSION });
      assert.deepEqual(sent, stored, "the wire and the in-process path record the same dispatcher");
    } finally {
      await wire.close();
      await local.close();
    }
  });

  it("keeps absent fields null on the wire and refuses malformed ones with the same error code", async () => {
    const { db, ctx } = await prepared("dispatcher-refusal");
    const wireDb = copyStore(db, "dispatcher-refusal-wire");
    const localDb = copyStore(db, "dispatcher-refusal-local");
    const wire = remoteService(wireDb);
    const local = createLocalService(localDb, "test");
    const saved = { holder: process.env["SUBSTRATE_HOLDER"], session: process.env["XTRM_SESSION_ID"] };
    try {
      process.env["SUBSTRATE_HOLDER"] = "env-holder";
      process.env["XTRM_SESSION_ID"] = SESSION;
      assert.deepEqual(await dispatchVia(wire, ctx, {}), { participant: null, session: null });

      for (const bad of [
        { dispatcherSessionId: "not-a-session" },
        { dispatcherParticipantId: "lead;rm -rf /" },
        { dispatcherParticipantId: "x".repeat(129) },
      ]) {
        const request = { ref: ctx.ref, specialist: "worker", holder: "holder-a", workspace: ctx.gitRoot, ...bad };
        const remote = await attempt(wire, "gate.dispatch", { request });
        const inProcess = await attempt(local, "gate.dispatch", { request });
        assert.equal(remote.ok, false, `${JSON.stringify(bad)} must be refused over the wire`);
        assert.deepEqual(remote, inProcess, "the wire refuses with the same outcome as in process");
        const direct = await attempt(wire, "provenance.dispatch", {
          issueId: ctx.issueId,
          input: { workspace: ctx.gitRoot, participantId: "holder-a", ...bad },
        });
        assert.equal(direct.ok, false);
        assert.equal(remote.code, direct.code, "the gate refuses with the code provenance.dispatch gives the same value");
      }
    } finally {
      for (const [key, value] of [["SUBSTRATE_HOLDER", saved.holder], ["XTRM_SESSION_ID", saved.session]] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await wire.close();
      await local.close();
    }
  });
});
