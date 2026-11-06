// The extension holds one connection for the session (XTRM-711), proved through
// the registered tools rather than through the class alone: two tool executions
// must open the store once, and the session_shutdown handler must close it.

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSubstrate } from "../src/store/sqlite.ts";
import { IssueService } from "../src/service/issue-service.ts";
import registerSubstrate from "../integrations/pi/extension.ts";
import { openBacking, type Backing } from "../integrations/pi/backing.ts";
import { contract } from "./helpers.ts";

interface Tool {
  name: string;
  execute: (...args: any[]) => Promise<any>;
}

function harness() {
  const tools: Tool[] = [];
  const handlers = new Map<string, any[]>();
  const pi: any = {
    registerTool: (t: Tool) => tools.push(t),
    registerCommand: () => {},
    on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  };
  return { pi, tools, handlers, tool: (name: string) => tools.find((t) => t.name === name) as Tool };
}

const ctx = (): any => ({ cwd: process.cwd(), sessionManager: { getSessionId: () => "11111111-1111-4111-8111-111111111111" }, ui: { notify: () => {} } });

describe("one connection per Pi session", () => {
  let dir = "";
  let dbPath = "";
  let ref = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sb-pi-session-"));
    dbPath = join(dir, "state.db");
    const db = openSubstrate(dbPath);
    const svc = new IssueService(db);
    svc.createProject({ id: "prj_xtrm", prefix: "XTRM", name: "t" });
    ref = svc.createIssue({
      projectId: "prj_xtrm",
      title: "session connection",
      kind: "task",
      contract: contract({ problem: "P", success: "S" }),
      scrutiny: "LOW",
      authoredBy: "tester",
    }).humanRef;
    db.close();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("opens the store once for two tool calls and closes it at shutdown", async () => {
    const opened: Backing[] = [];
    const closed: boolean[] = [];
    const { pi, tool, handlers } = harness();
    registerSubstrate(pi, {
      openBacking: () => {
        const backing = openBacking({ env: { ...process.env, SUBSTRATE_DB: dbPath } });
        opened.push(backing);
        const close = backing.close.bind(backing);
        backing.close = async () => {
          closed.push(true);
          await close();
        };
        return backing;
      },
    });

    const first = await tool("substrate_issue_get").execute("1", { ref }, undefined, undefined, ctx());
    const second = await tool("substrate_issue_get").execute("2", { ref }, undefined, undefined, ctx());
    assert.ok(first && second);
    assert.equal(opened.length, 1, "two tool calls must not open two connections");

    const shutdown = handlers.get("session_shutdown") ?? [];
    assert.equal(shutdown.length, 1, "the extension must close the connection when the session ends");
    await shutdown[0]({}, ctx());
    assert.deepEqual(closed, [true]);
  });
});
