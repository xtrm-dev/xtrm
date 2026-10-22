// Edit-gate hook entry for the packaged plugin (bead xtrm-6qu.6).
// Thin adapter: reads the PreToolUse JSON on stdin, calls the typed handler
// in-process, writes the block decision (or nothing when allowed), always
// exits 0 — a corrupt gate must not brick the session.
//
// .mjs, not .ts: the handler module self-invokes when
// process.argv[1].endsWith("edit-gate.ts"), so a .ts entry script here would
// run the handler twice.

import { resolveSubstrate } from "./resolve-substrate.mjs";
import { readHookInput } from "./read-hook-input.mjs";
import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: write-then-terminate drains via exitCode; the allow path writes
// nothing. armPipeDrain() swallows only EPIPE.
armPipeDrain();

const { handleEditGate, editGateHookOutput } = await resolveSubstrate("edit-gate.ts");
const hook = await readHookInput();
const result = handleEditGate({
  tool_name: hook.tool_name,
  tool_input: hook.tool_input,
  cwd: hook.cwd ?? process.cwd(),
  session_id: hook.session_id,
  issueRef: process.env["SUBSTRATE_ISSUE_REF"],
  holder: process.env["SUBSTRATE_HOLDER"],
  activationId: process.env["SUBSTRATE_ACTIVATION_ID"],
  workspace: hook.cwd ?? process.cwd(),
});

const out = editGateHookOutput(result);
if (out) process.stdout.write(JSON.stringify(out) + "\n");
process.exitCode = 0;
