// XTS dangerous-command approval flow.
//
// Contract (task xtrm-nka.5):
// - The TUI overlay (ctx.askApprove) is owned by task 6 (ui/approval.mjs).
// - This module defines the contract and the stdin fallback for non-UI
//   contexts (one-shot / non-TTY).
// - Default is deny on anything other than an explicit yes, on EOF, and on
//   timeout.

import { createInterface } from "node:readline";
import { stdin as stdinStream, stderr as stderrStream } from "node:process";

const APPROVAL_TIMEOUT_MS = 60_000;

let isTtyOverride;

// Overridable so tests can force the deny-safe non-TTY path without a TTY.
export function __setIsTtyForTests(value) {
  if (typeof value !== "boolean") {
    throw new TypeError("__setIsTtyForTests: value must be a boolean");
  }
  isTtyOverride = value;
}

export function __resetIsTtyForTests() {
  isTtyOverride = undefined;
}

export function isTty(stream) {
  return isTtyOverride ?? Boolean(stream.isTTY);
}

/**
 * Decide approval for a dangerous command.
 *
 * Pure decision: asks ctx.askApprove when present; otherwise the stdin
 * fallback (TTY prompt, or default deny when stdin is not a TTY).
 * input/output are injectable for tests; they default to process stdin and
 * stderr.
 * Returns a promise of 'approve' | 'deny'.
 */
export async function decideApproval({ command, reason, ctx = {}, input, output }) {
  if (typeof ctx.askApprove === "function") {
    const ok = await ctx.askApprove({ command, reason });
    return ok ? "approve" : "deny";
  }

  const stdin = input ?? stdinStream;

  // No UI in this context. Fall back to a stdin prompt — but only when stdin
  // is an interactive TTY. A pipe or non-interactive stdin cannot give
  // explicit consent, so the default is deny (never execute).
  if (!isTty(stdin)) return "deny";

  return promptOnStdin({ command, reason, stdin, output: output ?? stderrStream });
}

/**
 * Full gate: classify first, approve if dangerous.
 * Returns { status: 'safe' } | { status: 'approved' } | { status: 'denied', reason }.
 */
export async function runGate({ command, ctx = {}, options = {}, input, output }) {
  const { classifyCommand } = await import("./classify.mjs");
  const verdict = classifyCommand(command, options);

  if (verdict.safe) return { status: "safe" };

  const decision = await decideApproval({
    command,
    reason: verdict.reason,
    ctx,
    input,
    output,
  });

  if (decision === "approve") {
    return { status: "approved", reason: verdict.reason, pattern: verdict.pattern };
  }
  return { status: "denied", reason: verdict.reason, pattern: verdict.pattern };
}

// Interactive stdin prompt. Prints a redacted notice to stderr and asks for
// an explicit "yes". Anything else, EOF, or the timeout denies.
function promptOnStdin({ command, reason, stdin, output }) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rl.close();
      resolve(ok ? "approve" : "deny");
    };

    const rl = createInterface({ input: stdin, output });

    output.write("\n[DANGEROUS COMMAND]\n");
    output.write(`Command is classified as dangerous: ${reason}\n`);
    output.write("The command was NOT executed.\n");
    output.write("Type 'yes' to approve: ");

    const timer = setTimeout(() => {
      output.write("\nApproval timed out. Command denied.\n");
      finish(false);
    }, APPROVAL_TIMEOUT_MS);
    // Do not keep the process alive on the timer alone.
    timer.unref();

    rl.on("line", (line) => {
      finish(line.trim() === "yes");
    });
    rl.on("close", () => finish(false));
  });
}
