// Commit-check hook entry for the packaged plugin (bead xtrm-6qu.6).
// Thin adapter: reads the PreToolUse (Bash) JSON on stdin, validates the
// provenance context in-process, emits a nudge when the session commits
// with a live claim but no dispatch/receipt. Never blocks: the post-commit
// hook binds the SHA after the commit, so blocking would invert the flow.

import { resolveSubstrate } from "./resolve-substrate.mjs";
import { readHookInput } from "./read-hook-input.mjs";
import { armPipeDrain } from "./write-and-exit.mjs";

// XTRM-335: write-then-terminate drains via exitCode. The non-Bash guard is
// a proven zero-byte quiet path (no write precedes it). armPipeDrain()
// swallows only EPIPE.
armPipeDrain();

const { handleCommitCheck, commitCheckHookOutput } = await resolveSubstrate("commit-check.ts");
const hook = await readHookInput();
if (hook.tool_name !== "Bash") process.exit(0);
const result = handleCommitCheck({
  command: hook.tool_input?.command ?? "",
  cwd: hook.cwd ?? process.cwd(),
  session_id: hook.session_id,
  issueRef: process.env["SUBSTRATE_ISSUE_REF"],
});

const out = commitCheckHookOutput(result);
if (out) process.stdout.write(JSON.stringify(out) + "\n");
process.exitCode = 0;
