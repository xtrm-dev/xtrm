// SessionStart advisor entry (XTRM-672): resolves the session identity,
// exports a worktree-derived SUBSTRATE_HOLDER through CLAUDE_ENV_FILE, and
// injects the session's live claims with their latest handoff and top
// advisory. Fires on every source (startup, resume, clear, compact, fork).

import { resolveSubstrate } from "./resolve-substrate.mjs";
import { readHookInput } from "./read-hook-input.mjs";
import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: write-then-terminate drains via exitCode. armPipeDrain() swallows only EPIPE.
armPipeDrain();

let mod;
try {
  mod = await resolveSubstrate("advisor.ts");
} catch {
  // fail-open: an older installed package has no advisor module
  process.exit(0);
}
const { handleSessionAdvisor, advisorHookOutput } = mod;
const hook = await readHookInput();
const result = handleSessionAdvisor({
  source: hook.source,
  session_id: hook.session_id,
  cwd: hook.cwd ?? process.cwd(),
  envFile: process.env["CLAUDE_ENV_FILE"],
});
const out = advisorHookOutput("SessionStart", result);
if (out) process.stdout.write(JSON.stringify(out) + "\n");
process.exitCode = 0;
