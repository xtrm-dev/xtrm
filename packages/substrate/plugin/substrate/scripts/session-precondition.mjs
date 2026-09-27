// MCP precondition check for every session (bead xtrm-iip.14).
//
// Wired as a matcher-free SessionStart entry: unlike session-start.mjs
// (compact-matcher only), this fires on fresh starts too — exactly the
// sessions whose operators need the warning. Emits ONLY the precondition
// check; capsule injection stays scoped to the compact-matched entry.
//
// Equality, not emptiness: MCP_SDK_GENERATION=v1 (or any wrong value)
// leaves the tools just as absent as unset vars, so wrong values warn.
// Converts silence into an actionable message WITHOUT weakening
// legacy:reject. Never fails the session: any error degrades to no
// warning and exit 0, per hook discipline. No service, no filesystem —
// pure env read plus the local drain helper (no CLI tree, no TS loader).

import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: write-then-terminate drains via exitCode. armPipeDrain() swallows only EPIPE.
armPipeDrain();

function preconditionWarning() {
  try {
    const generation = (process.env["MCP_SDK_GENERATION"] ?? "").trim();
    const negotiation = (process.env["MCP_PROTOCOL_NEGOTIATION"] ?? "").trim();
    if (generation === "v2" && negotiation === "auto") return null;
    return (
      "Substrate MCP precondition unmet: MCP_SDK_GENERATION=v2 and " +
      "MCP_PROTOCOL_NEGOTIATION=auto are not both set to those exact values in this session, so the " +
      "Substrate MCP server rejects the legacy opening and its tools are " +
      "silently absent. Set both variables and restart the session."
    );
  } catch {
    return null;
  }
}

const context = preconditionWarning();
process.stdout.write(
  JSON.stringify({
    additionalContext: context,
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context ?? "" },
    // Claude Code validates `reason` as an optional string: null fails the whole hook output.
    reason: context ? "mcp-precondition-unmet" : undefined,
  }) + "\n",
);
process.exitCode = 0;
