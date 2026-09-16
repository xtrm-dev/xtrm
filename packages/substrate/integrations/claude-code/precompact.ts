// PreCompact adapter (PRD §24.1, acceptance D27): Claude about to compact
// → native MCP-tool/command adapter → Substrate mechanical checkpoint →
// bounded semantic summarizer → allow Claude compaction.
//
// Claude PreCompact supports command/HTTP/MCP-tool hooks; direct
// type:"agent" hooks are NOT supported there — this adapter is a plain
// command process (see hooks.json) and never depends on agent-hook
// semantics. It never blocks overflow-recovery compaction: every failure
// path returns { continue: true } with a degraded reason.

import { collectGitContext } from "./git-provenance.ts";
import { createSemanticSummarizer, readTranscriptTail } from "./semantic-service.ts";
import { enrichExecutionContext, type ActorType } from "../../src/domain/execution-context.ts";
import { discoverIssueRef, openHandles, resolveIssueId } from "./runtime.ts";
import { armPipeDrain } from "../write-and-exit.ts";

export interface PreCompactInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  issueRef?: string;
  dbPath?: string;
  // H1 (§76): the checkpoint carries actor + session identity. Actor is
  // caller-supplied typed input (never parsed from prose, §98); the
  // participant falls back to the trusted SUBSTRATE_HOLDER env; the XTRM
  // session id/name enrich automatically from the exact R4 env contract
  // inside enrichExecutionContext. Unknown stays absent.
  actor?: { type: ActorType; id?: string; name?: string } | null;
  participantId?: string | null;
  holder?: string | null;
}

export interface PreCompactResult {
  continue: boolean;
  entryId: string | null;
  sequence: number | null;
  degraded: boolean;
  reason?: string;
}

export async function handlePreCompact(input: PreCompactInput = {}): Promise<PreCompactResult> {
  const cwd = input.cwd ?? process.cwd();
  const issueRef = input.issueRef ?? discoverIssueRef(cwd);
  if (!issueRef) return { continue: true, entryId: null, sequence: null, degraded: true, reason: "no issue ref (set SUBSTRATE_ISSUE_REF or .substrate-issue); compaction proceeds" };
  let handles: ReturnType<typeof openHandles> | null = null;
  try {
    handles = openHandles(input.dbPath);
    const issueId = resolveIssueId(handles.svc, issueRef);
    const git = collectGitContext(cwd);
    const transcriptTail = readTranscriptTail(input.transcript_path ?? null);
    const result = await handles.journal.compactionCheckpoint(issueId, {
      kind: "compaction",
      // A provider session id is NOT a participant id (§98): the session is
      // recorded as a session (flat sessionId + typed host.sessionId), and
      // participant identity stays absent until a trusted path knows it.
      sessionId: input.session_id,
      participantId: input.participantId ?? input.holder ?? process.env["SUBSTRATE_HOLDER"] ?? undefined,
      workspace: git.workspace ?? undefined,
      branch: git.branch ?? undefined,
      headCommit: git.headCommit ?? undefined,
      changedFiles: git.changedFiles,
      summarizer: createSemanticSummarizer({ transcriptTail }),
      // Trusted Claude path (X1, ADR §97): host-known Claude session id +
      // R4 env session propagate automatically; nothing parsed from prose.
      // H1: explicit typed actor (when the caller knows it) travels in the
      // same envelope so the checkpoint carries actor + session identity.
      executionContext: enrichExecutionContext({
        actor: input.actor ?? null,
        participantId: input.participantId ?? input.holder ?? process.env["SUBSTRATE_HOLDER"] ?? null,
        host: input.session_id ? { type: "claude", sessionId: input.session_id } : null,
      }),
    });
    if (!result.entry) {
      return { continue: true, entryId: null, sequence: null, degraded: true, reason: result.reason ?? "checkpoint write failed; host default compaction proceeds" };
    }
    return {
      continue: true,
      entryId: result.entry.id,
      sequence: result.entry.sequence,
      degraded: result.degraded,
      reason: result.reason,
    };
  } catch (err) {
    return { continue: true, entryId: null, sequence: null, degraded: true, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      handles?.db.close();
    } catch {
      // best-effort close; compaction must proceed regardless
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

const invokedAsMain = (process.argv[1]?.endsWith("precompact.ts") || process.argv[1]?.endsWith("precompact.js")) ?? false;
if (invokedAsMain) {
  armPipeDrain(); // XTRM-335: every write path drains via exitCode; EPIPE guard only.
  const raw = await readStdin();
  let input: PreCompactInput = {};
  if (raw.trim() !== "") {
    try {
      input = JSON.parse(raw) as PreCompactInput;
    } catch {
      input = {};
    }
  }
  const result = await handlePreCompact(input);
  // Command-hook contract: exit 0 always; JSON on stdout is advisory.
  // XTRM-335: write-then-terminate drains via exitCode; exit code unchanged (0).
  process.stdout.write(JSON.stringify({ continue: result.continue, entryId: result.entryId, sequence: result.sequence, degraded: result.degraded, reason: result.reason ?? null }) + "\n");
  process.exitCode = 0;
}
