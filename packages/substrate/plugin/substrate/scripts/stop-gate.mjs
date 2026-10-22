// Stop-gate hook entry for the packaged plugin (bead xtrm-6qu.6).
// Thin adapter: reads the Stop JSON on stdin, ensures a journal checkpoint
// exists for the live claim, emits continuity context. Never blocks exit:
// unfinished work stays open; the requirement is continuity, not completion.

import { resolveSubstrate } from "./resolve-substrate.mjs";
import { readHookInput } from "./read-hook-input.mjs";
import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: write-then-terminate drains via exitCode; the quiet path below
// writes nothing. armPipeDrain() swallows only EPIPE.
armPipeDrain();

const { handleStopGate, stopGateHookOutput } = await resolveSubstrate("stop-gate.ts");
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

// XTRM-672: the shared advisories ride the same Stop output. An older
// installed package has no advisor module; the gate notice must still go out.
let out = stopGateHookOutput(result, { sessionId: hook.session_id });
try {
  const { handleStopAdvisor, advisorHookOutput, combineStopOutputs } = await resolveSubstrate("advisor.ts");
  const advisor = advisorHookOutput(
    "Stop",
    handleStopAdvisor({ session_id: hook.session_id, cwd: hook.cwd ?? process.cwd(), stop_hook_active: hook.stop_hook_active === true }),
  );
  out = combineStopOutputs(out, advisor);
} catch {
  // fail-open: gate notice only
}
if (out) process.stdout.write(JSON.stringify(out) + "\n");
process.exitCode = 0;
