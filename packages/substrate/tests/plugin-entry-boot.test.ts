import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { JournalService } from "../src/service/journal-service.ts";
import { contract } from "./helpers.ts";

// Acceptance xtrm-iip.1 (closeout E1), third proof: the relocated plugin
// entry (scripts/substrate-mcp.mjs) boots a live modern-only server over
// real stdio. The resolve-substrate.mjs seam is driven through SUBSTRATE_HOME
// (the recorded outside-checkout path); the DB is a tmp database.

const PLUGIN_ROOT = join(import.meta.dirname, "..", "plugin", "substrate");
const SUBSTRATE_HOME = join(import.meta.dirname, "..");
const META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
};

describe("packaged plugin entry boots (xtrm-iip.1)", () => {
  let dir = "";
  let dbPath = "";
  let humanRef = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sb-plugin-boot-"));
    dbPath = join(dir, "state.db");
    const db = openSubstrate(dbPath);
    const svc = new IssueService(db);
    svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
    humanRef = svc.createIssue({
      projectId: "prj_xtrm",
      title: "plugin boot",
      kind: "task",
      contract: contract({ problem: "P", success: "S" }),
      scrutiny: "LOW",
      authoredBy: "tester",
    }).humanRef;
    db.close();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("substrate-mcp.mjs serves discover + issue_get over stdio", async () => {
    // The shipped entry, spawned exactly as .mcp.json does: a .ts here would
    // fail from an installed copy (XTRM-372.7).
    const child = spawn("node", [join(PLUGIN_ROOT, "scripts", "substrate-mcp.mjs")], {
      // Local mode pinned: the launcher would otherwise follow a remote configured
      // on the machine running the suite (XTRM-692) and this test is about the
      // local entry.
      env: { ...process.env, SUBSTRATE_HOME, SUBSTRATE_DB: dbPath, SUBSTRATE_MCP_LOCAL: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      let buf = "";
      const responses = new Map<number, { result?: unknown; error?: unknown }>();
      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line) as { id?: number };
          if (msg.id !== undefined) responses.set(msg.id, msg as { result?: unknown; error?: unknown });
        }
      });
      let id = 1;
      const send = async (method: string, params: Record<string, unknown>): Promise<{ result?: unknown; error?: unknown }> => {
        const myId = id++;
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
        for (let i = 0; i < 300 && !responses.has(myId); i++) await new Promise((r) => setTimeout(r, 10));
        assert.ok(responses.has(myId), `no response for ${method} (entry failed to boot)`);
        return responses.get(myId) as { result?: unknown; error?: unknown };
      };
      const discover = await send("server/discover", { _meta: META });
      assert.ok(!discover.error, JSON.stringify(discover.error));
      assert.deepEqual((discover.result as { supportedVersions: string[] }).supportedVersions, ["2026-07-28"]);
      const call = await send("tools/call", { name: "issue_get", arguments: { ref: humanRef }, _meta: META });
      assert.ok(!call.error, JSON.stringify(call.error));
      const text = ((call.result as { content: Array<{ text: string }> }).content[0] as { text: string }).text;
      assert.equal((JSON.parse(text) as { title: string }).title, "plugin boot");
    } finally {
      child.kill();
    }
  });

  it("records the launcher's workspace, never the server's own checkout (XTRM-692)", async () => {
    // On the store-owning machine the MCP process cwd is that machine's
    // checkout. A checkpoint must record the caller's workspace, which the
    // launcher passes as an argument and this process reads from the environment.
    const workspace = "/pc/worktree";
    const child = spawn("node", [join(PLUGIN_ROOT, "scripts", "substrate-mcp.mjs")], {
      env: {
        ...process.env,
        SUBSTRATE_HOME,
        SUBSTRATE_DB: dbPath,
        SUBSTRATE_MCP_LOCAL: "1",
        SUBSTRATE_MCP_REMOTE: "1",
        SUBSTRATE_MCP_WORKSPACE: workspace,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    try {
      let buf = "";
      const responses = new Map<number, { result?: unknown; error?: unknown }>();
      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString("utf8");
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const msg = JSON.parse(line) as { id?: number };
          if (msg.id !== undefined) responses.set(msg.id, msg as { result?: unknown; error?: unknown });
        }
      });
      let id = 1;
      const call = async (name: string, args: Record<string, unknown>) => {
        const myId = id++;
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method: "tools/call", params: { name, arguments: args, _meta: META } }) + "\n");
        for (let i = 0; i < 400 && !responses.has(myId); i++) await new Promise((r) => setTimeout(r, 10));
        assert.ok(responses.has(myId), `no response for ${name}`);
        return responses.get(myId) as { result?: unknown; error?: unknown };
      };
      const checkpoint = await call("journal_checkpoint", { ref: humanRef, project: "prj_xtrm" });
      const payload = checkpoint.result as { isError?: boolean; content?: Array<{ text: string }> } | undefined;
      assert.ok(!checkpoint.error, JSON.stringify(checkpoint.error));
      assert.ok(!payload?.isError, payload?.content?.[0]?.text ?? "tool reported an error");
    } finally {
      child.kill();
    }
    const db = openSubstrate(dbPath);
    try {
      const svc = new IssueService(db);
      const issue = svc.resolveRef(humanRef);
      const entry = new JournalService(db, svc).latestCheckpoint(issue.id);
      assert.ok(entry?.mechanical, "the checkpoint must be readable");
      assert.equal(entry.mechanical?.workspace, workspace);
    } finally {
      db.close();
    }
  });
});
