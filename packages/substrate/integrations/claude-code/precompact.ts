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
import { discoverIssueRef, openHandles, resolveIssueId } from "./runtime.ts";

export interface PreCompactInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  issueRef?: string;
  dbPath?: string;
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
      sessionId: input.session_id,
      participantId: input.session_id,
      workspace: git.workspace ?? undefined,
      branch: git.branch ?? undefined,
      headCommit: git.headCommit ?? undefined,
      changedFiles: git.changedFiles,
      summarizer: createSemanticSummarizer({ transcriptTail }),
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

const invokedAsMain = process.argv[1]?.endsWith("precompact.ts") ?? false;
if (invokedAsMain) {
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
  process.stdout.write(JSON.stringify({ continue: result.continue, entryId: result.entryId, sequence: result.sequence, degraded: result.degraded, reason: result.reason ?? null }) + "\n");
  process.exit(0);
}
