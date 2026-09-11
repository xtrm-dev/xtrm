// Stop-gate hook entry for the packaged plugin (bead xtrm-6qu.6).
// Thin adapter: reads the Stop JSON on stdin, ensures a journal checkpoint
// exists for the live claim, emits continuity context. Never blocks exit:
// unfinished work stays open; the requirement is continuity, not completion.

import { resolveSubstrate } from "./resolve-substrate.mjs";
import { readHookInput } from "./read-hook-input.mjs";

const { handleStopGate } = await resolveSubstrate("stop-gate.ts");
const hook = await readHookInput();
const result = await handleStopGate({
  cwd: hook.cwd ?? process.cwd(),
  session_id: hook.session_id,
  issueRef: process.env["SUBSTRATE_ISSUE_REF"],
});

if (result.continuity) {
  process.stdout.write(JSON.stringify({ additionalContext: result.continuity }) + "\n");
}
process.exit(0);
