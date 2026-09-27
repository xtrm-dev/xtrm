// SessionStart hook entry for the packaged plugin (bead xtrm-iip.1).
// Claude picks up injected context from hookSpecificOutput.additionalContext;
// the top-level copy stays for debuggability. See precompact.mjs for why these
// entry scripts are .mjs.

import { resolveSubstrate } from "./resolve-substrate.mjs";
import { readHookInput } from "./read-hook-input.mjs";
import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: write-then-terminate drains via exitCode. armPipeDrain() swallows only EPIPE.
armPipeDrain();

// Handler-pure by design (bead xtrm-iip.14): the MCP precondition warning
// lives in session-precondition.mjs, wired as a matcher-free SessionStart
// entry so it fires on EVERY session including fresh starts. Keeping the
// warning here too would double-warn on compact-resume sessions.
const { handleSessionStart } = await resolveSubstrate("session-start.ts");
const result = handleSessionStart(await readHookInput());

process.stdout.write(
  JSON.stringify({
    additionalContext: result.additionalContext,
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: result.additionalContext ?? "" },
    reason: result.reason ?? undefined,
  }) + "\n",
);
process.exitCode = 0;
