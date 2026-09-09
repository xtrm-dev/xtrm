// SessionStart hook entry for the packaged plugin (bead xtrm-iip.1).
// Claude picks up injected context from hookSpecificOutput.additionalContext;
// the top-level copy stays for debuggability. See precompact.mjs for why these
// entry scripts are .mjs.

import { resolveSubstrate } from "./resolve-substrate.mjs";
import { readHookInput } from "./read-hook-input.mjs";

const { handleSessionStart } = await resolveSubstrate("session-start.ts");
const result = handleSessionStart(await readHookInput());

process.stdout.write(
  JSON.stringify({
    additionalContext: result.additionalContext,
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: result.additionalContext ?? "" },
    reason: result.reason ?? null,
  }) + "\n",
);
process.exit(0);
