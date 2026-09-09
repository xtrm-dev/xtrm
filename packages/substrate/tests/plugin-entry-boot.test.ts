import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import { contract } from "./helpers.ts";

// Acceptance xtrm-iip.1 (closeout E1), third proof: the relocated plugin
// entry (scripts/substrate-mcp.ts) boots a live modern-only server over
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

  it("substrate-mcp.ts serves discover + issue_get over stdio", async () => {
    const child = spawn("node", [join(PLUGIN_ROOT, "scripts", "substrate-mcp.ts")], {
      env: { ...process.env, SUBSTRATE_HOME, SUBSTRATE_DB: dbPath },
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
});
