import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

// Acceptance xtrm-iip.14: the matcher-free precondition entry warns on
// unset OR wrong values (equality, not emptiness), stays silent only on
// the exact v2+auto pair, and never fails the session. End-to-end through
// the real session-precondition.mjs (no imports, no service — pure env).

const ENTRY = join(import.meta.dirname, "..", "plugin", "substrate", "scripts", "session-precondition.mjs");

function runPrecondition(env: Record<string, string | undefined>): { code: number; context: string | null } {
  const out = execFileSync("node", [ENTRY], {
    input: JSON.stringify({ source: "startup" }),
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30000,
  });
  const parsed = JSON.parse(out) as { additionalContext: string | null; reason?: unknown };
  // Claude Code rejects the whole hook output when `reason` is present but not a string.
  assert.notEqual(parsed.reason, null, "reason must be omitted, never null");
  return { code: 0, context: parsed.additionalContext };
}

describe("SessionStart precondition entry (xtrm-iip.14)", () => {
  it("warns naming both vars when either is unset", () => {
    for (const env of [
      { MCP_SDK_GENERATION: undefined, MCP_PROTOCOL_NEGOTIATION: undefined },
      { MCP_SDK_GENERATION: "v2", MCP_PROTOCOL_NEGOTIATION: undefined },
      { MCP_SDK_GENERATION: undefined, MCP_PROTOCOL_NEGOTIATION: "auto" },
    ]) {
      const { code, context } = runPrecondition(env);
      assert.equal(code, 0, "warning path must never fail the session");
      assert.ok(context?.includes("MCP_SDK_GENERATION=v2"), `warning must name the generation var, got: ${context}`);
      assert.ok(context?.includes("MCP_PROTOCOL_NEGOTIATION=auto"), `warning must name the negotiation var, got: ${context}`);
    }
  });

  it("warns on wrong values (equality, not emptiness)", () => {
    for (const env of [
      { MCP_SDK_GENERATION: "v1", MCP_PROTOCOL_NEGOTIATION: "auto" },
      { MCP_SDK_GENERATION: "v2", MCP_PROTOCOL_NEGOTIATION: "manual" },
      { MCP_SDK_GENERATION: "v1", MCP_PROTOCOL_NEGOTIATION: "manual" },
    ]) {
      const { code, context } = runPrecondition(env);
      assert.equal(code, 0, "warning path must never fail the session");
      assert.ok(context?.includes("MCP_SDK_GENERATION=v2"), `wrong values must warn, got: ${context}`);
    }
  });

  it("stays silent only on the exact v2+auto pair", () => {
    const { code, context } = runPrecondition({ MCP_SDK_GENERATION: "v2", MCP_PROTOCOL_NEGOTIATION: "auto" });
    assert.equal(code, 0);
    assert.equal(context, null, "no extra context when the precondition is met");
  });
});
