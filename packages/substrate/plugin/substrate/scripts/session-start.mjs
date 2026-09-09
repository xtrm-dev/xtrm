// SessionStart hook entry for the packaged plugin (bead xtrm-iip.1).
// Claude picks up injected context from hookSpecificOutput.additionalContext;
// the top-level copy stays for debuggability. See precompact.mjs for why these
// entry scripts are .mjs.

import { resolveSubstrate } from "./resolve-substrate.mjs";
import { readHookInput } from "./read-hook-input.mjs";

// MCP precondition warning (bead xtrm-iip.11): without
// MCP_SDK_GENERATION=v2 + MCP_PROTOCOL_NEGOTIATION=auto the server
// correctly rejects under legacy:reject and the tools are silently absent.
// The warning converts silence into an actionable message WITHOUT
// weakening legacy:reject, and never fails the session (any error here
// degrades to no warning, per hook discipline).
function preconditionWarning() {
  try {
    const generation = (process.env["MCP_SDK_GENERATION"] ?? "").trim();
    const negotiation = (process.env["MCP_PROTOCOL_NEGOTIATION"] ?? "").trim();
    if (generation !== "" && negotiation !== "") return null;
    return (
      "Substrate MCP precondition unmet: MCP_SDK_GENERATION=v2 and " +
      "MCP_PROTOCOL_NEGOTIATION=auto are not both set in this session, so the " +
      "Substrate MCP server rejects the legacy opening and its tools are " +
      "silently absent. Set both variables and restart the session."
    );
  } catch {
    return null;
  }
}

const { handleSessionStart } = await resolveSubstrate("session-start.ts");
const result = handleSessionStart(await readHookInput());
const context = [preconditionWarning(), result.additionalContext].filter((part) => part !== null && part !== "").join("\n\n") || null;

process.stdout.write(
  JSON.stringify({
    additionalContext: context,
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context ?? "" },
    reason: result.reason ?? null,
  }) + "\n",
);
process.exit(0);
