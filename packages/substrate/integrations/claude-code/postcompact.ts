// PostCompact adapter (PRD §24.1): records the actual Claude compact
// summary as an audit reference on the Issue journal. Best-effort only:
// PostCompact must never fail the session. The durable checkpoint already
// exists from PreCompact; this only names the host summary beside it.

import { createHash } from "node:crypto";
import { enrichExecutionContext } from "../../src/domain/execution-context.ts";
import { clipWithMarker, SEMANTIC_SUMMARY_MAX } from "../../src/domain/journal.ts";
import { discoverIssueRef, openHandles, resolveIssueId } from "./runtime.ts";
import { armPipeDrain } from "../write-and-exit.ts";

export interface PostCompactInput {
  session_id?: string;
  // Claude Code sends the summary as compact_summary
  // (code.claude.com/docs/en/hooks#postcompact); summary is kept for direct callers.
  compact_summary?: string;
  summary?: string;
  cwd?: string;
  issueRef?: string;
  dbPath?: string;
}

export interface PostCompactResult {
  ok: boolean;
  entryId: string | null;
  reason?: string;
}

function hashSummary(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 16);
}

export function handlePostCompact(input: PostCompactInput = {}): PostCompactResult {
  const cwd = input.cwd ?? process.cwd();
  const issueRef = input.issueRef ?? discoverIssueRef(cwd);
  const summary = (input.compact_summary ?? input.summary ?? "").trim();
  if (!issueRef) return { ok: true, entryId: null, reason: "no issue ref; audit skipped" };
  if (!summary) return { ok: true, entryId: null, reason: "no compact summary provided; audit skipped" };
  let handles: ReturnType<typeof openHandles> | null = null;
  try {
    handles = openHandles(input.dbPath);
    const issueId = resolveIssueId(handles.svc, issueRef);
    const entry = handles.journal.appendEntry(issueId, {
      kind: "finding",
      // Provider session, not participant identity (§98); see precompact.ts.
      sessionId: input.session_id,
      semantic: { summary: clipWithMarker(summary, SEMANTIC_SUMMARY_MAX, "compact_summary") },
      refs: [{ kind: "claude-compact-summary", key: hashSummary(summary) }],
      executionContext: enrichExecutionContext({
        host: input.session_id ? { type: "claude", sessionId: input.session_id } : null,
        // An explicit envelope disables the service's ambient fallback, so
        // carry the holder here or the entry records no participant.
        participantId: process.env["SUBSTRATE_HOLDER"] || null,
      }),
    });
    return { ok: true, entryId: entry.id };
  } catch (err) {
    return { ok: true, entryId: null, reason: err instanceof Error ? err.message : String(err) };
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

const invokedAsMain = (process.argv[1]?.endsWith("postcompact.ts") || process.argv[1]?.endsWith("postcompact.js")) ?? false;
if (invokedAsMain) {
  armPipeDrain(); // XTRM-335: every write path drains via exitCode; EPIPE guard only.
  const raw = await readStdin();
  let input: PostCompactInput = {};
  if (raw.trim() !== "") {
    try {
      input = JSON.parse(raw) as PostCompactInput;
    } catch {
      input = {};
    }
  }
  const result = handlePostCompact(input);
  process.stdout.write(JSON.stringify({ ok: true, entryId: result.entryId, reason: result.reason ?? null }) + "\n");
  // XTRM-335: write-then-terminate drains via exitCode; exit code unchanged (0).
  process.exitCode = 0;
}
