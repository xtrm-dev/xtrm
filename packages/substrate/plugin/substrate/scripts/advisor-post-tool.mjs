// PostToolUse advisor entry (XTRM-672): after an `sb` command or a Substrate
// MCP tool, surfaces the shared advisories for the issues it touched —
// systemMessage for the operator, additionalContext for the agent.

import { readHookInput } from "./read-hook-input.mjs";
import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: write-then-terminate drains via exitCode. The non-Substrate guard
// below is a proven zero-byte quiet path. armPipeDrain() swallows only EPIPE.
armPipeDrain();

const hook = await readHookInput();
// Fast path: most Bash calls are not sb; skip loading Substrate for them.
const command = typeof hook.tool_input?.command === "string" ? hook.tool_input.command : "";
if (hook.tool_name === "Bash" && !/(?:^|[\s;&|(])sb\s+(issue|journal|provenance)\b/.test(command)) process.exit(0);

const { resolveSubstrate } = await import("./resolve-substrate.mjs");
let mod;
try {
  mod = await resolveSubstrate("advisor.ts");
} catch {
  // fail-open: an older installed package has no advisor module
  process.exit(0);
}
const { handlePostToolAdvisor, advisorHookOutput } = mod;
const out = advisorHookOutput(
  "PostToolUse",
  handlePostToolAdvisor({ tool_name: hook.tool_name, tool_input: hook.tool_input, session_id: hook.session_id, cwd: hook.cwd ?? process.cwd() }),
);
if (out) process.stdout.write(JSON.stringify(out) + "\n");
process.exitCode = 0;
