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

export function sshArgv(host: string, command: string): string[] {
  return ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=10", host, command];
}

const MAX_BUFFER = 64 * 1024 * 1024;

export const sshTransport: RemoteTransport = {
  run(request: RemoteRunRequest): RemoteRunResult {
    const result = spawnSync("ssh", sshArgv(request.host, request.command), {
      input: request.stdin ?? undefined,
      encoding: "utf8",
      timeout: request.timeoutMs ?? 120_000,
      maxBuffer: MAX_BUFFER,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.error !== undefined && result.error !== null) {
      // A timeout is not the same fact as a refused connection: the command may
      // have run to completion on the server before this side gave up, so the
      // message says so instead of implying nothing happened.
      const timedOut = (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
      const detail = timedOut
        ? `ssh ${request.host} timed out after ${request.timeoutMs ?? 120_000} ms; the command may have run on the server`
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
