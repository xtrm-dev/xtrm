// SessionStart adapter (PRD §24.2, acceptance D28): after compaction
// Claude runs SessionStart with source "compact"; this hook injects the
// current Resume Capsule as additionalContext so the new window starts
// from durable Substrate state even if the host summary omitted detail.
// Non-compact sources are a no-op.

import { discoverIssueRef, openHandles, resolveIssueId } from "./runtime.ts";
import { armPipeDrain } from "../write-and-exit.ts";

export interface SessionStartInput {
  source?: string;
  session_id?: string;
  cwd?: string;
  issueRef?: string;
  dbPath?: string;
}

export interface SessionStartResult {
  additionalContext: string | null;
  reason?: string;
}

export function handleSessionStart(input: SessionStartInput = {}): SessionStartResult {
  if ((input.source ?? "") !== "compact") return { additionalContext: null, reason: "non-compact source; no injection" };
  const cwd = input.cwd ?? process.cwd();
  const issueRef = input.issueRef ?? discoverIssueRef(cwd);
  if (!issueRef) return { additionalContext: null, reason: "no issue ref; nothing to inject" };
  let handles: ReturnType<typeof openHandles> | null = null;
  try {
    handles = openHandles(input.dbPath);
    const issueId = resolveIssueId(handles.svc, issueRef);
    const capsule = handles.resume.buildCapsule(issueId);
    return { additionalContext: handles.resume.renderCapsule(capsule) };
  } catch (err) {
    return { additionalContext: null, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      handles?.db.close();
    } catch {
      // best-effort
    }
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      data += c;
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

const invokedAsMain = process.argv[1]?.endsWith("session-start.ts") ?? false;
if (invokedAsMain) {
  armPipeDrain(); // XTRM-335: every write path drains via exitCode; EPIPE guard only.
  const raw = await readStdin();
  let input: SessionStartInput = {};
  if (raw.trim() !== "") {
    try {
      input = JSON.parse(raw) as SessionStartInput;
    } catch {
      input = {};
    }
  }
  const result = handleSessionStart(input);
  // Claude SessionStart hook contract: additionalContext is picked up from
  // hookSpecificOutput.additionalContext (top-level echoed for debuggability).
  process.stdout.write(
    JSON.stringify({
      additionalContext: result.additionalContext,
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: result.additionalContext ?? "" },
      reason: result.reason ?? null,
    }) + "\n",
  );
  // XTRM-335: write-then-terminate drains via exitCode; exit code unchanged (0).
  process.exitCode = 0;
}
