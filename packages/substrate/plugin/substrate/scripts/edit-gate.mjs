// Edit-gate hook entry for the packaged plugin (bead xtrm-6qu.6).
// Thin adapter: reads the PreToolUse JSON on stdin, calls the typed handler
// in-process, writes the block decision (or nothing when allowed), always
// exits 0 — a corrupt gate must not brick the session.
//
// .mjs, not .ts: the handler module self-invokes when
// process.argv[1].endsWith("edit-gate.ts"), so a .ts entry script here would
// run the handler twice.

import { applyServerArguments, proxyHook } from "./remote-hook.mjs";
import { resolveSubstrate } from "./resolve-substrate.mjs";
import { readHookInput } from "./read-hook-input.mjs";
import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: write-then-terminate drains via exitCode; the allow path writes
// nothing. armPipeDrain() swallows only EPIPE.
armPipeDrain();

async function main() {


const { handleEditGate } = await resolveSubstrate("edit-gate.ts");
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

if (!result.allow) {
  process.stdout.write(JSON.stringify({ decision: "block", reason: result.reason ?? "no live claim" }) + "\n");
}
// exit code is set by main()'s caller
  return 0;
}

try {
  // XTRM-692: with a remote configured the answer comes from the store-owning
  // machine; the handler below runs only for a local deployment.
  applyServerArguments();
  const forwarded = await proxyHook("edit-gate.mjs");
  process.exitCode = forwarded === false ? await main() : forwarded;
} catch (err) {
    // A configured remote that cannot be reached must not become "allowed":
    // the gate fails closed and names the transport code (XTRM-712).
    process.stdout.write(
      JSON.stringify({ decision: "block", reason: `substrate remote unavailable: ${err.code}: ${err.message}` }) + "\n",
    );
    process.exitCode = 0;
}
