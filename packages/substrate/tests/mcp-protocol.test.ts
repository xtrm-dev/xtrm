import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { contract, repoEnv, tempDir } from "./helpers.ts";
import { buildServer, SUBSTRATE_PROTOCOL_REVISION, SUBSTRATE_SERVER_NAME } from "../integrations/claude-code/mcp-server.ts";

// Acceptance xtrm-iip.3 (closeout E3): SDK v2, strict 2026-07-28,
// modern-only. In-process tests drive the real SDK stack through
// serveStdio with a linked in-memory transport; the E2E test speaks to
// the actual entry file over real stdio against a tmp DB.

const REV = SUBSTRATE_PROTOCOL_REVISION;
const meta = (caps: unknown = {}) => ({
  "io.modelcontextprotocol/protocolVersion": REV,
  "io.modelcontextprotocol/clientCapabilities": caps,
  "io.modelcontextprotocol/clientInfo": { name: "mcp-protocol-test", version: "0.0.1" },
});

interface Wire {
  send(method: string, params?: Record<string, unknown>): Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }>;
  close(): Promise<void>;
}

async function linkedServer(): Promise<Wire> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const handle = serveStdio(() => buildServer(), { legacy: "reject", transport: serverT });
  await clientT.start();
  let id = 1;
  const pending = new Map<number, (msg: { result?: unknown; error?: { code: number; message: string; data?: unknown } }) => void>();
  clientT.onmessage = (msg) => {
    const m = msg as { id?: number; result?: unknown; error?: { code: number; message: string; data?: unknown } };
    if (m.id !== undefined && (m.result !== undefined || m.error !== undefined)) {
      pending.get(m.id)?.(m);
      pending.delete(m.id);
    }
  };
  return {
    send(method, params = {}) {
      const myId = id++;
      return new Promise((resolve) => {
        pending.set(myId, resolve);
        void clientT.send({ jsonrpc: "2.0", id: myId, method, params });
      });
    },
    async close() {
      await handle.close();
    },
  };
}

function scratchDb(): { dir: string; dbPath: string; humanRef: string } {
  const dir = tempDir("sb-mcp-");
  const dbPath = join(dir, "state.db");
  const db = openSubstrate(dbPath);
  const svc = new IssueService(db);
  svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
  const issue = svc.createIssue({
    projectId: "prj_xtrm",
    title: "mcp work",
    kind: "task",
    contract: contract({ problem: "MCP problem", success: "MCP success" }),
    scrutiny: "LOW",
    authoredBy: "tester",
  });
  svc.attestReadiness(issue.id, { outcome: "ready", policy: "default", attestedBy: "tester" });
  db.close();
  return { dir, dbPath, humanRef: issue.humanRef };
}

describe("MCP 2026-07-28 protocol (xtrm-iip.3)", () => {
  let s: ReturnType<typeof scratchDb>;
  let wire: Wire;
  beforeEach(async () => {
    s = scratchDb();
    wire = await linkedServer();
  });
  afterEach(async () => {
    await wire.close();
    rmSync(s.dir, { recursive: true, force: true });
  });

  it("journal_append fills unstated participant/activation from the process ambient (XTRM-435)", async () => {
    // A Claude host holding ambient identity must not lose it because the
    // model-supplied args state only a session id: the stated-wins ambient
    // fill in journalIdentity mirrors the service fallback (XTRM-417).
    const prior = {
      session: process.env["XTRM_SESSION_ID"],
      holder: process.env["SUBSTRATE_HOLDER"],
      activation: process.env["SUBSTRATE_ACTIVATION_ID"],
    };
    delete process.env["XTRM_SESSION_ID"];
    process.env["SUBSTRATE_HOLDER"] = "specialist::probe";
    process.env["SUBSTRATE_ACTIVATION_ID"] = "act:23b2212a-c44";
    try {
      const res = await wire.send("tools/call", {
        name: "journal_append",
        arguments: { dbPath: s.dbPath, project: "prj_xtrm", ref: s.humanRef, kind: "finding", sessionId: "claude-session", summary: "ambient carry" },
        _meta: meta(),
      });
      assert.ok(!res.error, JSON.stringify(res.error));
      const db = openSubstrate(s.dbPath);
      try {
        const raw = db
          .prepare("SELECT participant_id AS p, session_id AS sess, activation_id AS a FROM issue_journal ORDER BY sequence")
          .all() as Array<{ p: string | null; sess: string | null; a: string | null }>;
        const row = raw.at(-1);
        assert.equal(row?.p, "specialist::probe", "ambient holder carried on the raw row");
        assert.equal(row?.a, "act:23b2212a-c44", "ambient activation carried on the raw row");
      } finally {
        db.close();
      }
      // Absence leg: with the ambient scrubbed, the same call records nulls.
      delete process.env["SUBSTRATE_HOLDER"];
      delete process.env["SUBSTRATE_ACTIVATION_ID"];
      const res2 = await wire.send("tools/call", {
        name: "journal_append",
        arguments: { dbPath: s.dbPath, project: "prj_xtrm", ref: s.humanRef, kind: "finding", sessionId: "claude-session", summary: "ambient absent" },
        _meta: meta(),
      });
      assert.ok(!res2.error, JSON.stringify(res2.error));
      const db2 = openSubstrate(s.dbPath);
      try {
        const rows = db2
          .prepare("SELECT participant_id AS p, activation_id AS a FROM issue_journal ORDER BY sequence")
          .all() as Array<{ p: string | null; a: string | null }>;
        const last = rows.at(-1);
        assert.equal(last?.p, null, "scrubbed ambient leaves participant explicitly absent");
        assert.equal(last?.a, null, "scrubbed ambient leaves activation explicitly absent");
      } finally {
        db2.close();
      }
    } finally {
      if (prior.session === undefined) delete process.env["XTRM_SESSION_ID"];
      else process.env["XTRM_SESSION_ID"] = prior.session;
      if (prior.holder === undefined) delete process.env["SUBSTRATE_HOLDER"];
      else process.env["SUBSTRATE_HOLDER"] = prior.holder;
      if (prior.activation === undefined) delete process.env["SUBSTRATE_ACTIVATION_ID"];
      else process.env["SUBSTRATE_ACTIVATION_ID"] = prior.activation;
    }
  });

  it("server/discover advertises exactly 2026-07-28 plus the tools capability", async () => {
    const res = await wire.send("server/discover", { _meta: meta() });
    assert.ok(!res.error, JSON.stringify(res.error));
    const result = res.result as { supportedVersions: string[]; capabilities: { tools: object }; resultType: string; _meta: Record<string, { name: string }> };
    assert.deepEqual(result.supportedVersions, ["2026-07-28"]);
    assert.ok(result.capabilities.tools, "tools capability advertised");
    assert.equal(result.resultType, "complete");
    assert.equal(result._meta["io.modelcontextprotocol/serverInfo"].name, SUBSTRATE_SERVER_NAME);
  });

  it("legacy initialize is rejected with UnsupportedProtocolVersion -32022", async () => {
    const res = await wire.send("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "x", version: "1" } });
    assert.ok(res.error, "initialize must not succeed on the modern-only server");
    assert.equal(res.error.code, -32022);
    assert.deepEqual((res.error.data as { supported: string[] }).supported, ["2026-07-28"]);
  });

  it("missing _meta envelope fails closed (-32602 on the modern path)", async () => {
    // Era pinning: server/discover is a discarded probe and does NOT pin;
    // the first enveloped non-discover request pins modern. A claim-less
    // request before pinning is -32022 (no version named); after pinning
    // the missing envelope is -32602.
    const list = await wire.send("tools/list", { _meta: meta() });
    assert.ok(!list.error);
    const res = await wire.send("tools/call", { name: "issue_get", arguments: { ref: s.humanRef, dbPath: s.dbPath } });
    assert.ok(res.error, "claim-less request must fail");
    assert.equal(res.error.code, -32602);
  });

  it("tools/list is deterministic, modern-shaped, and advertises no subscriptions", async () => {
    const first = await wire.send("tools/list", { _meta: meta() });
    const second = await wire.send("tools/list", { _meta: meta() });
    assert.ok(!first.error && !second.error);
    assert.deepEqual(first.result, second.result);
    const result = first.result as { tools: Array<{ name: string }>; resultType: string; ttlMs: number; cacheScope: string };
    assert.deepEqual(result.tools.map((t) => t.name), [
      "issue_get",
      "issue_list",
      "issue_ready",
      "issue_claim",
      "issue_update",
      "issue_note",
      "issue_close",
      "journal_append",
      "journal_checkpoint",
      "journal_show",
      "journal_query",
      "provenance_trace",
      "provenance_session",
      "provenance_activation",
      "resume_capsule",
    ]);
    assert.equal(result.resultType, "complete");
    assert.equal(typeof result.ttlMs, "number");
    assert.ok(["public", "private"].includes(result.cacheScope));
  });

  it("sequential requests with different capability metadata are honored independently (stateless)", async () => {
    const call = (caps: unknown) =>
      wire.send("tools/call", { name: "issue_get", arguments: { ref: s.humanRef, dbPath: s.dbPath }, _meta: meta(caps) });
    const a = await call({ sampling: {} });
    const b = await call({ roots: { listChanged: true } });
    assert.ok(!a.error && !b.error, `${JSON.stringify(a.error)} ${JSON.stringify(b.error)}`);
    // Same durable row through both capability regimes: neither request
    // contaminated the other with remembered connection state.
    const titleOf = (res: { result?: unknown }) =>
      JSON.parse(((res.result as { content: Array<{ text: string }> }).content[0] as { text: string }).text) as { title: string };
    assert.equal(titleOf(a).title, "mcp work");
    assert.deepEqual(titleOf(a), titleOf(b));
  });

  it("mutation results carry the shared feedback envelope while reads stay unwrapped", async () => {
    // The Claude surface shares OperationFeedback with the CLI and Pi. This
    // pins the wiring in mcp-server.ts: reads must pass through untouched and
    // a no-op mutation must not be reported as success.
    const call = async (name: string, extra: Record<string, unknown>) => {
      const res = await wire.send("tools/call", {
        name,
        arguments: { dbPath: s.dbPath, project: "prj_xtrm", ...extra },
        _meta: meta(),
      });
      assert.ok(!res.error, `${name}: ${JSON.stringify(res.error)}`);
      return JSON.parse(
        ((res.result as { content: Array<{ text: string }> }).content[0] as { text: string }).text,
      ) as Record<string, unknown>;
    };

    const read = await call("issue_get", { ref: s.humanRef });
    assert.equal("feedback" in read, false, "a read payload must not grow a feedback key");

    // issue_get does not return the contract; scratchDb seeded it with exactly this one.
    const noop = await call("issue_update", {
      ref: s.humanRef,
      contract: contract({ problem: "MCP problem", success: "MCP success" }),
    });
    assert.equal(noop["revisionCreated"], false, "an identical contract must not create a revision");
    const noopFeedback = noop["feedback"] as Record<string, unknown>;
    assert.equal(noopFeedback["level"], "noop");
    assert.equal(noopFeedback["code"], "issue_unchanged");

    const appended = await call("journal_append", { ref: s.humanRef, kind: "finding", summary: "feedback wiring" });
    const appendFeedback = appended["feedback"] as Record<string, unknown>;
    assert.equal(appendFeedback["level"], "success");
    assert.equal(appendFeedback["code"], "journal_written");
  });

  it("unknown tool fails closed without touching the filesystem (xtrm-7wc.8.1 wire form)", async () => {
    const emptyHome = tempDir("sb-mcp-nohome-");
    const priorHome = process.env["HOME"];
    process.env["HOME"] = emptyHome;
    try {
      const res = await wire.send("tools/call", {
        name: "nope",
        arguments: { dbPath: join(s.dir, "no-such-dir", "state.db") },
        _meta: meta(),
      });
      assert.ok(res.error, "unknown tool must fail");
      assert.equal(readdirSync(emptyHome).length, 0, "unknown tool must not touch the filesystem");
    } finally {
      if (priorHome === undefined) delete process.env["HOME"];
      else process.env["HOME"] = priorHome;
      rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  it("every tool executes against a tmp DB through the server (xtrm-iip.4)", async () => {
    const args = { dbPath: s.dbPath };
    const call = async (name: string, extra: Record<string, unknown>) => {
      const res = await wire.send("tools/call", { name, arguments: { ...args, ...extra }, _meta: meta() });
      assert.ok(!res.error, `${name}: ${JSON.stringify(res.error)}`);
      return JSON.parse(
        ((res.result as { content: Array<{ text: string }> }).content[0] as { text: string }).text,
      ) as unknown;
    };
    const listed = (await call("issue_list", { project: "prj_xtrm" })) as unknown[];
    assert.ok(Array.isArray(listed) && listed.length === 1);
    const ready = (await call("issue_ready", { project: "prj_xtrm" })) as unknown[];
    assert.ok(Array.isArray(ready));
    const appended = (await call("journal_append", { ref: s.humanRef, kind: "finding", summary: "e4 finding", project: "prj_xtrm" })) as Record<string, unknown>;
    assert.ok(appended["entryId"]);
    const shown = (await call("journal_show", { ref: s.humanRef })) as Array<{ semantic: { summary: string } }>;
    assert.ok(shown.some((e) => e.semantic?.summary === "e4 finding"));
    const noted = (await call("issue_note", { ref: s.humanRef, kind: "milestone", summary: "e4 milestone", project: "prj_xtrm" })) as Record<string, unknown>;
    assert.ok(noted["entryId"]);
    const checkpointed = (await call("journal_checkpoint", { ref: s.humanRef, summary: "e4 checkpoint", project: "prj_xtrm" })) as Record<string, unknown>;
    assert.ok(checkpointed["entryId"]);
    assert.equal(checkpointed["degraded"], false);
    const since = (await call("journal_query", { op: "since", ref: s.humanRef, cursor: 0 })) as { entries: unknown[]; nextCursor: number };
    assert.ok(since.entries.length >= 3);
    const latest = (await call("journal_query", { op: "latest", ref: s.humanRef, kind: "checkpoint" })) as { kind: string };
    assert.equal(latest["kind"], "checkpoint");
    const timeline = (await call("journal_query", { op: "timeline", ref: s.humanRef, limit: 2 })) as unknown[];
    assert.equal(timeline.length, 2);
    const updated = (await call("issue_update", { ref: s.humanRef, title: "mcp work renamed", project: "prj_xtrm" })) as Record<string, unknown>;
    assert.equal(updated["revisionCreated"], false);
    const claimed = (await call("issue_claim", { op: "claim", ref: s.humanRef, holder: "mcp-tester", project: "prj_xtrm" })) as Record<string, unknown>;
    assert.equal((claimed["claim"] as { holder: string }).holder, "mcp-tester");
    const released = (await call("issue_claim", { op: "release", ref: s.humanRef, holder: "mcp-tester", project: "prj_xtrm" })) as Record<string, unknown>;
    assert.equal(released["op"], "release");
    const capsule = (await call("resume_capsule", { ref: s.humanRef })) as Record<string, unknown>;
    assert.ok(capsule["capsule"] && typeof capsule["rendered"] === "string");
    const trace = (await call("provenance_trace", { ref: s.humanRef })) as Record<string, unknown>;
    assert.equal(trace["humanRef"], s.humanRef);
    assert.ok(Array.isArray(trace["receipts"]));
    const sess = (await call("provenance_session", { sessionId: "no-such-session" })) as Record<string, unknown>;
    assert.deepEqual(sess["issueIds"], []);
    const act = (await call("provenance_activation", { activationId: "no-such-activation" })) as Record<string, unknown>;
    assert.deepEqual(act["issueIds"], []);
    const closed = (await call("issue_close", { ref: s.humanRef, outcome: "completed", reason: "mcp e2e done", actor: "mcp-tester", project: "prj_xtrm" })) as Record<string, unknown>;
    assert.equal(closed["outcome"], "completed");
    assert.equal(closed["terminalState"], "done");
  });

  it("tool call over real stdio reads the same row sb wrote (tmp DB)", async () => {
    const entry = join(import.meta.dirname, "..", "integrations", "claude-code", "mcp-server.ts");
    const child = spawn("node", [entry], { env: { ...process.env, SUBSTRATE_DB: s.dbPath }, stdio: ["pipe", "pipe", "pipe"] });
    try {
      let buf = "";
      const responses = new Map<number, unknown>();
      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line) as { id?: number };
          if (msg.id !== undefined) responses.set(msg.id, msg);
        }
      });
      let id = 1;
      const send = async (method: string, params: Record<string, unknown>): Promise<{ result?: unknown; error?: unknown }> => {
        const myId = id++;
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
        for (let i = 0; i < 200 && !responses.has(myId); i++) await new Promise((r) => setTimeout(r, 10));
        assert.ok(responses.has(myId), `no response for ${method}`);
        return responses.get(myId) as { result?: unknown; error?: unknown };
      };
      const discover = await send("server/discover", { _meta: meta() });
      assert.ok(!discover.error, JSON.stringify(discover.error));
      assert.deepEqual((discover.result as { supportedVersions: string[] }).supportedVersions, ["2026-07-28"]);
      const call = await send("tools/call", { name: "issue_get", arguments: { ref: s.humanRef }, _meta: meta() });
      assert.ok(!call.error, JSON.stringify(call.error));
      const text = ((call.result as { content: Array<{ text: string }> }).content[0] as { text: string }).text;
      const row = JSON.parse(text) as { humanRef: string; title: string };
      assert.equal(row.humanRef, s.humanRef);
      assert.equal(row.title, "mcp work");
    } finally {
      child.kill();
    }
  });

  it("issue_list derives identity from the process cwd repository and fails closed otherwise (ADR §5)", async () => {
    const env = repoEnv("sb-mcp-repo-");
    const prev = process.cwd();
    try {
      const repo = env.gitRepo("mcp-repo");
      assert.equal(env.inCwd(repo, () => env.run(["init"])).code, 0, "init the cwd repository");
      const contractFile = join(env.temp("sb-mcp-c-"), "c.json");
      writeFileSync(contractFile, JSON.stringify(contract({ problem: "mcp repo", success: "mcp repo" })));
      assert.equal(
        env.inCwd(repo, () => env.run(["issue", "create", "--title", "repo work", "--kind", "task", "--contract", contractFile, "--scrutiny", "LOW"])).code,
        0,
      );

      // No `project` argument: the repository binding from cwd resolves it.
      process.chdir(repo);
      try {
        const res = await wire.send("tools/call", { name: "issue_list", arguments: { dbPath: env.dbPath }, _meta: meta() });
        assert.ok(!res.error, JSON.stringify(res.error));
        const text = ((res.result as { content: Array<{ text: string }> }).content[0] as { text: string }).text;
        const listed = JSON.parse(text) as Array<{ humanRef: string }>;
        assert.deepEqual(listed.map((i) => i.humanRef), ["MCPREPO-1"]);
      } finally {
        process.chdir(prev);
      }

      // An uninitialized sibling repository fails closed instead of falling
      // back to the single Project in the database.
      const other = env.gitRepo("mcp-other");
      process.chdir(other);
      try {
        const res = await wire.send("tools/call", { name: "issue_list", arguments: { dbPath: env.dbPath }, _meta: meta() });
        const failure = res.error !== undefined ? JSON.stringify(res.error) : JSON.stringify(res.result);
        assert.match(failure, /Run `sb init`/, "uninitialized repository must fail closed");
      } finally {
        process.chdir(prev);
      }
    } finally {
      process.chdir(prev);
      env.restore();
    }
  });

  it("journal_append is project-scoped: it fails closed and refuses a foreign ref (ADR §5)", async () => {
    const env = repoEnv("sb-mcp-w-");
    const prev = process.cwd();
    try {
      const a = env.gitRepo("mcp-wa");
      assert.equal(env.inCwd(a, () => env.run(["init"])).code, 0, "init repo A");
      const contractFile = join(env.temp("sb-mcp-wc-"), "c.json");
      writeFileSync(contractFile, JSON.stringify(contract({ problem: "mcp wa", success: "mcp wa" })));
      assert.equal(
        env.inCwd(a, () => env.run(["issue", "create", "--title", "wa work", "--kind", "task", "--contract", contractFile, "--scrutiny", "LOW"])).code,
        0,
      );
      const b = env.gitRepo("mcp-wb");
      assert.equal(env.inCwd(b, () => env.run(["init"])).code, 0, "init repo B");
      assert.equal(
        env.inCwd(b, () => env.run(["issue", "create", "--title", "wb work", "--kind", "task", "--contract", contractFile, "--scrutiny", "LOW"])).code,
        0,
      );

      const append = (args: Record<string, unknown>) =>
        wire.send("tools/call", { name: "journal_append", arguments: { kind: "finding", summary: "mcp scoped", ...args, dbPath: env.dbPath }, _meta: meta() });

      // An uninitialized repository cannot write anywhere.
      const orphan = env.gitRepo("mcp-wc");
      process.chdir(orphan);
      try {
        const res = await append({ ref: "MCPWA-1" });
        const failure = res.error !== undefined ? JSON.stringify(res.error) : JSON.stringify(res.result);
        assert.match(failure, /Run `sb init`/, "an uninitialized repository must not append to another Project's Issue");
      } finally {
        process.chdir(prev);
      }

      // From B, writing into A requires the deliberate override (ADR §16).
      process.chdir(b);
      try {
        const refused = await append({ ref: "MCPWA-1" });
        const failure = refused.error !== undefined ? JSON.stringify(refused.error) : JSON.stringify(refused.result);
        assert.match(failure, /belongs to project prj_mcp_wa, not the effective project prj_mcp_wb/);
        assert.match(failure, /pass --project prj_mcp_wa/);
        const deliberate = await append({ ref: "MCPWA-1", project: "prj_mcp_wa" });
        assert.ok(!deliberate.error, JSON.stringify(deliberate.error));
        const entryId = (JSON.parse(((deliberate.result as { content: Array<{ text: string }> }).content[0] as { text: string }).text) as { entryId: string }).entryId;
        assert.ok(entryId);
      } finally {
        process.chdir(prev);
      }
    } finally {
      process.chdir(prev);
      env.restore();
    }
  });
});
