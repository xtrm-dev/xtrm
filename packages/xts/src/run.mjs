// `xts run` execution path.
//
// Seam note: task xtrm-nka.7 wires the model-interpretation part (PRD §7.4 —
// "the assistant receives the result and may explain failures"). This module
// keeps the gate+exec responsibility; task 7 may extend executeGuarded with
// an onResult hook without moving the gate.

import { spawn } from "node:child_process";

/**
 * Run a command through the full safety gate, then execute it.
 *
 * Returns { status, exitCode?, output?, reason? }:
 * - status 'safe' | 'approved' (executed): exitCode + output present
 * - status 'denied': reason present, nothing executed
 * stdout is passed through, stderr goes to stderr. Output is also captured
 * for the model-interpretation seam (truncated to keep memory bounded).
 */
export async function executeGuarded(command, { ctx = {}, options = {}, cwd = process.cwd() } = {}) {
  const { runGate } = await import("./safety/approve.mjs");
  const gate = await runGate({ command, ctx, options });

  if (gate.status === "denied") {
    return { status: "denied", reason: gate.reason };
  }

  const { exitCode, output } = await spawnShell(command, { cwd });
  return { status: gate.status, exitCode, output };
}

function spawnShell(command, { cwd }) {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, stdio: ["ignore", "pipe", "inherit"] });

    let stdout = "";
    child.stdout.on("data", (chunk) => {
      process.stdout.write(chunk);
      // ponytail: cap captured output at 64 KiB; full capture if the
      // model-interpretation seam ever needs it.
      if (stdout.length < 64 * 1024) {
        stdout = (stdout + chunk.toString("utf8")).slice(0, 64 * 1024);
      }
    });

    child.on("error", (error) => {
      resolve({ exitCode: 1, output: `spawn error: ${error.message}\n` });
    });

    child.on("close", (code, signal) => {
      const exitCode = code ?? (signal ? 128 + signalNumber(signal) : 1);
      resolve({ exitCode, output: stdout });
    });
  });
}

function signalNumber(signal) {
  const signals = {
    SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15,
  };
  return signals[signal] ?? 1;
}
