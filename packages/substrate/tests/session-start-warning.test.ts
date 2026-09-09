import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

// Acceptance xtrm-iip.11: the SessionStart hook warns when the MCP env
// precondition is unmet, stays silent when it is met, and never fails the
// session either way. End-to-end through the real .mjs entry (both
// branches); the handler input is non-compact so the only additionalContext
// source under test is the warning itself.

const ENTRY = join(import.meta.dirname, "..", "plugin", "substrate", "scripts", "session-start.mjs");

function runSessionStart(env: Record<string, string | undefined>): { code: number; context: string | null } {
  const out = execFileSync("node", [ENTRY], {
    input: JSON.stringify({ source: "startup" }),
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30000,
  });
  const parsed = JSON.parse(out) as { additionalContext: string | null };
  return { code: 0, context: parsed.additionalContext };
}

describe("SessionStart MCP precondition warning (xtrm-iip.11)", () => {
  it("warns naming both vars when either is unset", () => {
    for (const env of [
      { MCP_SDK_GENERATION: undefined, MCP_PROTOCOL_NEGOTIATION: undefined },
      { MCP_SDK_GENERATION: "v2", MCP_PROTOCOL_NEGOTIATION: undefined },
      { MCP_SDK_GENERATION: undefined, MCP_PROTOCOL_NEGOTIATION: "auto" },
    ]) {
      const { code, context } = runSessionStart(env);
      assert.equal(code, 0, "warning path must never fail the session");
      assert.ok(context?.includes("MCP_SDK_GENERATION=v2"), `warning must name the generation var, got: ${context}`);
      assert.ok(context?.includes("MCP_PROTOCOL_NEGOTIATION=auto"), `warning must name the negotiation var, got: ${context}`);
    }
  });

  it("stays silent when both vars are set", () => {
    const { code, context } = runSessionStart({ MCP_SDK_GENERATION: "v2", MCP_PROTOCOL_NEGOTIATION: "auto" });
    assert.equal(code, 0);
    assert.equal(context, null, "no extra context when the precondition is met");
  });
});
