// The Pi gate must not fail open when the store lives on another machine and is
// unreachable (XTRM-712).
//
// Two directions, because they are different situations. A local failure keeps
// today's fail-open — a corrupt gate must not brick Pi. A configured remote that
// cannot be reached means enforcement is unavailable, and allowing the edit would
// be no claim check at all while the tools in the same session fail closed.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerSubstrate from "../integrations/pi/extension.ts";
import type { Backing } from "../integrations/pi/backing.ts";

const ctx = (): any => ({ cwd: "/pc/worktree", sessionManager: { getSessionId: () => "11111111-1111-4111-8111-111111111111" }, ui: { notify: () => {} } });
const edit = (): any => ({ type: "tool_call", toolCallId: "t1", toolName: "edit", input: { path: "a.ts", edits: [] } });
const write = (): any => ({ type: "tool_call", toolCallId: "t2", toolName: "write", input: { path: "a.ts", content: "x" } });
const read = (): any => ({ type: "tool_call", toolCallId: "t3", toolName: "read", input: { path: "a.ts" } });

async function gateWith(error: unknown, failOn: "resolveRef" | "claim" = "claim"): Promise<(event: any) => Promise<any>> {
  const handlers = new Map<string, any[]>();
  const pi: any = {
    registerTool: () => {},
    registerCommand: () => {},
    on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  };
  const backing: Backing = {
    kind: "remote",
    where: "ssh:server",
    async call<T>(op: string): Promise<T> {
      if (failOn === "resolveRef" && op === "issue.resolveRef") throw error;
      if (op === "issue.resolveRef") return { id: "iss_test" } as T;
      if (op === "issue.getActiveClaim") throw error;
      throw error;
    },
    async close() {},
  };
  registerSubstrate(pi, { openBacking: () => backing });
  const handlersFor = handlers.get("tool_call") ?? [];
  assert.equal(handlersFor.length, 1);
  return (event: any) => handlersFor[0](event, ctx());
}

function coded(code: string, message = `injected ${code}`): Error {
  return Object.assign(new Error(message), { code });
}

// The session is bound through the env contract, which is what a real session
// falls back to; without a bound ref the gate has nothing to enforce and allows.
process.env["SUBSTRATE_ISSUE_REF"] = "XTRM-712";
process.env["SUBSTRATE_HOLDER"] = "core-xt-pi-6vnw";

describe("the gate when the store is unreachable", () => {
  for (const code of ["connection_lost", "not_installed", "protocol_mismatch", "peer_noise", "spawn_failed"]) {
    it(`blocks an edit and names ${code}`, async () => {
      const gate = await gateWith(coded(code));
      const decision = await gate(edit());
      assert.equal(decision?.block, true, `${code} must block, not allow`);
      assert.match(decision.reason, new RegExp(code));
    });
  }

  it("blocks a write too, not only an edit", async () => {
    const gate = await gateWith(coded("connection_lost"));
    assert.equal((await gate(write()))?.block, true);
  });

  it("blocks when the ref lookup itself cannot reach the store", async () => {
    const gate = await gateWith(coded("connection_lost"), "resolveRef");
    const decision = await gate(edit());
    assert.equal(decision?.block, true);
    assert.match(decision.reason, /connection_lost/);
  });

  it("keeps fail-open for a local failure", async () => {
    const gate = await gateWith(coded("bad_request", "argument issueId is required"));
    assert.equal(await gate(edit()), undefined, "a local failure must not start blocking edits");
  });

  it("keeps fail-open for a plain error with no code", async () => {
    const gate = await gateWith(new Error("sqlite: disk I/O error"));
    assert.equal(await gate(edit()), undefined);
  });

  it("still ignores tools that are not edits or writes", async () => {
    const gate = await gateWith(coded("connection_lost"));
    assert.equal(await gate(read()), undefined);
  });
});
