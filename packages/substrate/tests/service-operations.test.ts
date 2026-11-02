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
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ARGS, CAPABILITIES, OPERATIONS } from "../src/service/ops.ts";
import { ServiceCallError } from "../src/service/protocol.ts";
import {
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
  const root = mkdtempSync(join(tmpdir(), `sb-ops-${label}-`));
  const git = (args: string[]): void => {
    const done = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(done.status, 0, done.stderr);
  };
  git(["init", "-q", "."]);
  git(["remote", "add", "origin", `git@github.com:xtrm-dev/${label}.git`]);
  return root;
}

function makeStore(root: string, label: string): string {
  const db = join(mkdtempSync(join(tmpdir(), `sb-ops-db-${label}-`)), "state.db");
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
  projectId: string;
  issueId: string;
  ref: string;
  entryId: string;
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

async function seed(service: SubstrateService, gitRoot: string): Promise<Ctx> {
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
  await service.call("journal.appendEntry", {
    issueId: created.id,
    input: { kind: "note", mechanical: { issueId: created.id, issueRevision: 1, contractHash: "0000", summary: "seed" } },
  });
  const entries = await service.call<Array<{ id: string }>>("journal.listEntries", { issueId: created.id });
  await service.call("authority.record", {
    activationId: "act_seed",
    specialist: "seed",
    state: "running",
    issueRef: created.humanRef,
    lastActivityAt: 1,
  });
  return {
    gitRoot,
    projectId: project.projectId,
    issueId: created.id,
    ref: created.humanRef,
    entryId: entries[0]!.id,
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
  "issue.queryAllIssues": () => ({ query: {} }),
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
  "issue.updateContract": (c) => ({
    issueId: c.issueId,
    contract: CONTRACT,
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
  "issue.renewClaim": (c) => ({ issueId: c.issueId, holder: "holder-b" }),
  "issue.releaseClaim": (c) => ({ issueId: c.issueId, holder: "holder-b" }),
  "issue.latestAttestation": (c) => ({ issueId: c.issueId }),
  "issue.appendEvent": (c) => ({ issueId: c.issueId, type: "test.event", payload: { a: 1 } }),
  "gate.check": (c) => ({ request: { issueRef: c.ref, specialist: "worker" } }),
  "gate.dispatch": (c) => ({ request: { issueRef: c.ref, specialist: "worker" } }),
  "store.get": (c) => ({ ref: c.ref }),
  "store.addJournal": (c) => ({ ref: c.ref, kind: "note" }),
  "journal.appendEntry": (c) => ({
    issueId: c.issueId,
    input: { kind: "finding", mechanical: { issueId: c.issueId, issueRevision: 1, contractHash: "0000", summary: "second" } },
  }),
  "journal.listEntries": (c) => ({ issueId: c.issueId, limit: 5 }),
  "journal.latest": (c) => ({ issueId: c.issueId }),
  "journal.latestCheckpoint": (c) => ({ issueId: c.issueId }),
  "journal.since": (c) => ({ issueId: c.issueId, cursor: 0 }),
  "journal.checkpoint": (c) => ({
    issueId: c.issueId,
    input: { mechanical: { issueId: c.issueId, issueRevision: 1, contractHash: "0000", summary: "checkpoint" } },
  }),
  "journal.compactionCheckpoint": (c) => ({
    issueId: c.issueId,
    input: { mechanical: { issueId: c.issueId, issueRevision: 1, contractHash: "0000", summary: "compaction" } },
  }),
  "journal.collectMechanical": (c) => ({ issueId: c.issueId, input: {} }),
  "journal.renderCheckpoint": () => ({ entry: { sequence: 1, kind: "note", createdAt: 1 } }),
  "journal.getEntry": (c) => ({ entryId: c.entryId }),
  "journal.timeline": (c) => ({ issueId: c.issueId, limit: 5 }),
  "journal.enrichEntry": (c) => ({ entryId: c.entryId, semantic: { summary: "enriched" } }),
  "provenance.dispatch": (c) => ({ issueId: c.issueId, input: {} }),
  "provenance.allocateReceipt": () => ({ bindingId: "wr_ops" }),
  "provenance.attachArtifact": () => ({ receiptId: "wr_ops", kind: "note", value: "v" }),
  "provenance.bindCommit": () => ({ receiptId: "wr_ops", sha: "0123456" }),
  "provenance.listReceipts": (c) => ({ issueId: c.issueId }),
  "provenance.listBindings": (c) => ({ issueId: c.issueId }),
  "provenance.trace": (c) => ({ issueId: c.issueId }),
  "provenance.findByCommit": () => ({ sha: "0123456" }),
  "provenance.sessionDetail": () => ({ sessionId: "session-x" }),
  "provenance.activationDetail": () => ({ activationId: "act-x" }),
  "resume.buildCapsule": (c) => ({ issueId: c.issueId }),
  "resume.renderCapsule": () => ({ capsule: { issue: null, checkpoint: null, entries: [] } }),
  "authority.record": (c) => ({
    activationId: "act_ops",
    specialist: "ops",
    state: "running",
    issueRef: c.ref,
    lastActivityAt: 2,
  }),
  "authority.remove": () => ({ activationId: "act_ops" }),
  "authority.list": () => ({ activeOnly: true, limit: 5 }),
};

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

interface Outcome {
  ok: boolean;
  code?: string;
  shape?: unknown;
}

async function attempt(service: SubstrateService, op: string, args: Record<string, unknown>): Promise<Outcome> {
  try {
    const result = await service.call(op, args);
    return { ok: true, shape: shape(result) };
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
    const localDb = makeStore(root, "local");
    const remoteDb = makeStore(root, "remote");
    const local = createLocalService(localDb, "test");
    const remote = remoteService(remoteDb);
    try {
      const localCtx = await seed(local, root);
      const remoteCtx = await seed(remote, root);
      const divergences: string[] = [];
      for (const op of Object.keys(OPERATIONS).sort()) {
        const build = FIXTURES[op]!;
        const viaWire = await attempt(remote, op, build(remoteCtx));
        const inProcess = await attempt(local, op, build(localCtx));
        if (viaWire.ok !== inProcess.ok || viaWire.code !== inProcess.code) {
          divergences.push(
            `${op}: wire ${viaWire.ok ? "ok" : viaWire.code} vs local ${inProcess.ok ? "ok" : inProcess.code}`,
          );
          continue;
        }
        if (viaWire.ok) {
          assert.deepEqual(
            shape(viaWire.shape),
            shape(inProcess.shape),
            `${op} answers a different result shape over the wire`,
          );
        }
      }
      assert.deepEqual(divergences, [], "every operation must answer alike on both paths");
    } finally {
      await remote.close();
      await local.close();
    }
  }

  it("refuses an argument name no operation reads", async () => {
    const root = makeRepo("unknown-args");
    const db = makeStore(root, "one");
    const service = createLocalService(db, "test");
    try {
      const ctx = await seed(service, root);
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
      const ctx = await seed(service, root);
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
    const config = join(mkdtempSync(join(tmpdir(), "sb-ops-config-")), "substrate.json");
    writeFileSync(config, JSON.stringify({ remote: "ssh:server", remoteSb: null, serverVersion: null, checkouts: {} }));
    assert.throws(
      () => openService({ env: { ...process.env, SUBSTRATE_REMOTE_CONFIG: config, SUBSTRATE_DB: undefined } }),
      /no absolute server sb path is recorded for ssh:server/,
    );
  });
});

describe("openSshService", () => {
  it("runs ssh with the options, host and command it documents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sb-ops-ssh-"));
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
  it("lists live rows the way the SessionStart reader does", async () => {
    const db = makeStore(makeRepo("authority-parity"), "one");
    const service = createLocalService(db, "test");
    try {
      const rows: Array<[string, string, number]> = [
        ["act_old", "running", 10],
        ["act_new", "waiting", 30],
        ["act_mid", "blocked", 20],
        ["act_done", "settled", 40],
        ["act_stopped", "disposed", 50],
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
      assert.deepEqual(
        answer.rows.map((row) => row.activationId),
        ["act_new", "act_mid"],
        "live rows only, newest first, limited",
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
        state: "pending",
        issueRef: "",
        lastActivityAt: 0,
      });
      const listed = await service.call<{ rows: Array<{ activationId: string; issueRef: string | null }> }>(
        "authority.list",
        { activationId: "act_untouched" },
      );
      assert.equal(listed.rows[0]?.issueRef, null, "an empty issue ref is no issue ref");

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
