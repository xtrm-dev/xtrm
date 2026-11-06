// Stop-gate hook entry for the packaged plugin (bead xtrm-6qu.6).
// Thin adapter: reads the Stop JSON on stdin, ensures a journal checkpoint
// exists for the live claim, emits continuity context. Never blocks exit:
// unfinished work stays open; the requirement is continuity, not completion.

import { applyServerArguments, proxyHook } from "./remote-hook.mjs";
import { resolveSubstrate } from "./resolve-substrate.mjs";
import { readHookInput } from "./read-hook-input.mjs";
import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: write-then-terminate drains via exitCode; the quiet path below
// writes nothing. armPipeDrain() swallows only EPIPE.
armPipeDrain();

async function main() {


const { handleStopGate } = await resolveSubstrate("stop-gate.ts");
const hook = await readHookInput();
const result = await handleStopGate({
  cwd: hook.cwd ?? process.cwd(),
  session_id: hook.session_id,
  issueRef: process.env["SUBSTRATE_ISSUE_REF"],
  holder: process.env["SUBSTRATE_HOLDER"],
  activationId: process.env["SUBSTRATE_ACTIVATION_ID"],
  // H1 §77 release/retain policy: default retains; opt-in release.
  releaseClaim: process.env["SUBSTRATE_STOP_RELEASE_CLAIM"] === "1",
});

if (result.continuity) {
  process.stdout.write(JSON.stringify({ additionalContext: result.continuity }) + "\n");
}
// exit code is set by main()'s caller
  return 0;
}

try {
  // XTRM-692: with a remote configured the answer comes from the store-owning
  // machine; the handler below runs only for a local deployment.
  applyServerArguments();
  const forwarded = await proxyHook("stop-gate.mjs");
  process.exitCode = forwarded === false ? await main() : forwarded;
} catch (err) {
    process.stdout.write(JSON.stringify({ degraded: true, reason: `substrate remote unavailable: ${err.code}: ${err.message}` }) + "\n");
    process.exitCode = 0;
}
