// The ssh transport: one process execution per invocation, no listener
// (ADR-008). BatchMode keeps a missing key from turning into an interactive
// password prompt inside a hook.

import { spawnSync } from "node:child_process";

export interface RemoteRunRequest {
  host: string;
  command: string;
  stdin?: string | null;
  timeoutMs?: number;
}

export interface RemoteRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RemoteTransport {
  run(request: RemoteRunRequest): RemoteRunResult;
}

// Options that keep one forwarded command from acquiring ambient authority:
// no agent forwarding, no local forwardings from the operator's config, no
// LocalCommand hooks, and `--` so a host that looks like an option is still a
// host. A forwarded invocation gets exactly the connection it asked for.
export function sshArgv(host: string, command: string): string[] {
  return [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ForwardAgent=no",
    "-o", "ClearAllForwardings=yes",
    "-o", "PermitLocalCommand=no",
    "--",
    host,
    command,
  ];
}

// One number, exported, so a test can fail when it changes: hooks and the CLI
// both reference it instead of repeating a literal that can drift.
export const DEFAULT_TIMEOUT_MS = 120_000;

const MAX_BUFFER = 64 * 1024 * 1024;

export const sshTransport: RemoteTransport = {
  run(request: RemoteRunRequest): RemoteRunResult {
    const result = spawnSync("ssh", sshArgv(request.host, request.command), {
      input: request.stdin ?? undefined,
      encoding: "utf8",
      timeout: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.error !== undefined && result.error !== null) {
      // A timeout is not the same fact as a refused connection: the command may
      // have run to completion on the server before this side gave up, so the
      // message says so instead of implying nothing happened.
      const code = (result.error as NodeJS.ErrnoException).code;
      const timedOut = code === "ETIMEDOUT";
      const tooLong = code === "E2BIG" || code === "ENAMETOOLONG";
      const detail = timedOut
        ? `ssh ${request.host} timed out after ${request.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms; the command may have run on the server`
        : tooLong
          ? `ssh ${request.host}: the command exceeds the local argument limit (${code}); documents travel on stdin and should not reach this`
          : result.error.message;
      return { code: 255, stdout: result.stdout ?? "", stderr: detail };
    }
    return { code: result.status ?? 255, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
  },
};

export function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed;
  }
  return "";
}
