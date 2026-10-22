// Host-neutral advisor (XTRM-672/673): applies the shared advisory catalogue
// (src/presentation/advisories.ts) to a session start, a tool result or the
// end of a turn. Claude (claude-code/advisor.ts) and Pi (pi/advisor.ts) only
// map the returned {systemMessage, additionalContext, block} onto their own
// output channels, so both hosts show the same advisory for the same state. Fail-open
// everywhere: an unreadable DB or a bad input yields no output, never a block
// (the one deliberate block is the Stop handoff advisory, once per cooldown).

import { appendFileSync } from "node:fs";
import { discoverIssueRef, openHandles, resolveIssueId } from "./claude-code/runtime.ts";
import {
  cooldownFile,
  evaluateIssue,
  evaluateOperation,
  formatAdvisory,
  loadCooldowns,
  resolveIdentity,
  saveCooldowns,
  selectAdvisory,
  snapshotIssue,
  type Advisory,
  type Identity,
} from "../src/presentation/advisories.ts";

export interface AdvisorDeps {
  dbPath?: string;
  env?: Record<string, string | undefined>;
  now?: number;
  stateDir?: string;
}

export interface AdvisorOutput {
  systemMessage?: string;
  additionalContext?: string;
  block?: string;
}

const REF = /\b[A-Z][A-Z0-9]*-\d+(?:\.\d+)*\b/g;
const SB_COMMAND = /(?:^|[\s;&|(])sb\s+(issue|journal|provenance)\b/;
// Claude MCP tool names and Pi native tool names for the same surface.
const MCP_PREFIX = /^(?:mcp__plugin_substrate_substrate__|substrate_)/;
const CLAIM_LIST_LIMIT = 5;
// Claims that lapsed within this window still show, so "expired" is visible.
const EXPIRED_GRACE_MS = 2 * 3_600_000;

export function advisoriesDisabled(env: Record<string, string | undefined>): boolean {
  return (env["SUBSTRATE_ADVISORIES"] ?? "").toLowerCase() === "off";
}

function identityLine(id: Identity): string {
  if (id.source === "env") return `Substrate identity: ${id.holder} (SUBSTRATE_HOLDER).`;
  if (id.source === "worktree") return `Substrate identity: ${id.holder} (derived from the xt worktree name and exported as SUBSTRATE_HOLDER for Bash).`;
  return "Substrate identity: none. Journal entries will record no author and the edit gate refuses edits on claimed issues. Set `export SUBSTRATE_HOLDER=<name>`.";
}

// ── SessionStart ────────────────────────────────────────────────────────────

export interface SessionAdvisorInput {
  source?: string;
  session_id?: string;
  cwd?: string;
  envFile?: string;
}

/** Identity, the session's live claims with their latest handoff, and the top advisory per claim. */
export function handleSessionAdvisor(input: SessionAdvisorInput, deps: AdvisorDeps = {}): AdvisorOutput {
  const env = deps.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();
  const now = deps.now ?? Date.now();
  const identity = resolveIdentity(env, cwd);
  if (identity.source === "worktree" && input.envFile) {
    try {
      appendFileSync(input.envFile, `export SUBSTRATE_HOLDER='${identity.holder?.replace(/'/g, "")}'\n`);
    } catch {
      // the agent still gets the identity line and can export it itself
    }
  }
  const lines = [identityLine(identity)];
  const warnings: string[] = [];
  // Only an xt-launched session is expected to carry an identity.
  if (identity.source === "none" && env["XTRM_SESSION_ID"]) warnings.push("Substrate: no SUBSTRATE_HOLDER in this xt session; writes will be anonymous");
  let handles: ReturnType<typeof openHandles> | null = null;
  try {
    handles = openHandles(deps.dbPath);
    const claims = identity.holder ? handles.svc.listClaimsByHolder(identity.holder, { now, graceMs: EXPIRED_GRACE_MS }) : [];
    if (claims.length > 0) lines.push("", `Live claims held by ${identity.holder}:`);
    for (const claim of claims.slice(0, CLAIM_LIST_LIMIT)) {
      const issue = handles.svc.getIssue(claim.issueId);
      const mins = Math.round((claim.expiresAt - now) / 60000);
      lines.push(`- ${issue.humanRef} ${issue.title} — ${mins >= 0 ? `expires in ${mins} min` : `EXPIRED ${-mins} min ago`}`);
      const handoff = handles.journal.latest(claim.issueId, { kind: "handoff" });
      if (handoff?.semantic?.summary) lines.push(`  latest handoff seq${handoff.sequence}: ${truncate(handoff.semantic.summary, 300)}`);
      if (!advisoriesDisabled(env)) {
        const top = evaluateIssue(snapshotIssue(handles.svc, handles.journal, claim.issueId, now), identity)[0];
        if (top) {
          lines.push(`  advisory: ${formatAdvisory(top).agent}`);
          if (top.severity === "warning") warnings.push(formatAdvisory(top).user);
        }
      }
    }
    if (claims.length > CLAIM_LIST_LIMIT) lines.push(`- (${claims.length - CLAIM_LIST_LIMIT} more; sb issue list --status in_progress)`);
    if (claims.length > 0) lines.push("Resume one with `sb issue resume <ref>`.");
  } catch {
    // fail-open: identity line alone
  } finally {
    try {
      handles?.db.close();
    } catch {
      // best-effort
    }
  }
  return { additionalContext: lines.join("\n"), systemMessage: warnings.length > 0 ? warnings.join("\n") : undefined };
}

// ── PostToolUse ─────────────────────────────────────────────────────────────

export interface PostToolInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  session_id?: string;
  cwd?: string;
}

type WriteKind = "journal" | "close" | null;

/** Refs and the kind of write a tool call made, or null when it is not a Substrate call. */
export function substrateCall(toolName: string, toolInput: Record<string, unknown>): { refs: string[]; write: WriteKind; closeFlags?: { outcome: string | null; evidence: number } } | null {
  if (toolName === "Bash" || toolName === "bash") {
    const command = typeof toolInput["command"] === "string" ? (toolInput["command"] as string) : "";
    if (!SB_COMMAND.test(command)) return null;
    const refs = [...new Set(command.match(REF) ?? [])];
    const write: WriteKind = /\bsb\s+issue\s+close\b/.test(command)
      ? "close"
      : /\bsb\s+(journal\s+(append|checkpoint)|issue\s+note)\b/.test(command)
        ? "journal"
        : null;
    const closeFlags =
      write === "close"
        ? { outcome: /--outcome[\s=]+([\w-]+)/.exec(command)?.[1] ?? null, evidence: (command.match(/--(result|validation|receipt|artifact)\b/g) ?? []).length }
        : undefined;
    return { refs, write, closeFlags };
  }
  if (!MCP_PREFIX.test(toolName)) return null;
  const tool = toolName.replace(MCP_PREFIX, "");
  const ref = ["ref", "issueRef", "issue"].map((k) => toolInput[k]).find((v): v is string => typeof v === "string");
  const write: WriteKind = tool === "issue_close" ? "close" : tool === "journal_append" ? "journal" : null;
  const evidence = ["journalResultRefs", "validationRefs", "receiptRefs", "artifactRefs"].reduce(
    (n, k) => n + (Array.isArray(toolInput[k]) ? (toolInput[k] as unknown[]).length : 0),
    0,
  );
  return {
    refs: ref ? [ref] : [],
    write,
    closeFlags: write === "close" ? { outcome: typeof toolInput["outcome"] === "string" ? (toolInput["outcome"] as string) : null, evidence } : undefined,
  };
}

export function handlePostToolAdvisor(input: PostToolInput, deps: AdvisorDeps = {}): AdvisorOutput | null {
  const env = deps.env ?? process.env;
  if (advisoriesDisabled(env)) return null;
  const call = substrateCall(input.tool_name ?? "", input.tool_input ?? {});
  if (!call || call.refs.length === 0) return null;
  const now = deps.now ?? Date.now();
  const identity = resolveIdentity(env, input.cwd ?? process.cwd());
  const picked: Advisory[] = [];
  let handles: ReturnType<typeof openHandles> | null = null;
  try {
    handles = openHandles(deps.dbPath);
    const file = input.session_id ? cooldownFile(input.session_id, deps.stateDir) : null;
    const cooldowns = file ? loadCooldowns(file) : {};
    for (const ref of call.refs.slice(0, 3)) {
      let issueId: string;
      try {
        issueId = resolveIssueId(handles.svc, ref);
      } catch {
        continue;
      }
      // Operation facts come from what was persisted, not from parsing tool output.
      if (call.write === "journal") {
        const latest = handles.journal.listEntries(issueId).reduce<{ sequence: number; createdAt: number; participantId: string | null; kind: string } | null>(
          (a, e) => (a === null || e.sequence > a.sequence ? e : a),
          null,
        );
        if (latest && now - latest.createdAt < 120_000) {
          picked.push(...evaluateOperation({ op: "journal_append", issueRef: ref, kind: latest.kind, participantId: latest.participantId }));
        }
      } else if (call.write === "close" && call.closeFlags) {
        picked.push(
          ...evaluateOperation({
            op: "issue_close",
            issueRef: ref,
            outcome: call.closeFlags.outcome,
            resultRefs: 0,
            evidenceRefs: call.closeFlags.evidence,
            participantId: identity.holder,
          }),
        );
      }
      const top = selectAdvisory(evaluateIssue(snapshotIssue(handles.svc, handles.journal, issueId, now), identity), cooldowns, now);
      if (top) picked.push(top);
    }
    if (file) saveCooldowns(file, cooldowns);
  } catch {
    return null;
  } finally {
    try {
      handles?.db.close();
    } catch {
      // best-effort
    }
  }
  return render(picked);
}

// ── Stop ────────────────────────────────────────────────────────────────────

export interface StopAdvisorInput {
  session_id?: string;
  cwd?: string;
  stop_hook_active?: boolean;
}

/** End-of-turn rules over the bound issue, else the issues this identity holds. */
export function handleStopAdvisor(input: StopAdvisorInput, deps: AdvisorDeps = {}): AdvisorOutput | null {
  const env = deps.env ?? process.env;
  if (advisoriesDisabled(env)) return null;
  const cwd = input.cwd ?? process.cwd();
  const now = deps.now ?? Date.now();
  const identity = resolveIdentity(env, cwd);
  let handles: ReturnType<typeof openHandles> | null = null;
  try {
    handles = openHandles(deps.dbPath);
    const bound = discoverIssueRef(cwd);
    const issueIds = bound
      ? [resolveIssueId(handles.svc, bound)]
      : identity.holder
        ? handles.svc.listClaimsByHolder(identity.holder, { now, graceMs: EXPIRED_GRACE_MS }).map((c) => c.issueId)
        : [];
    const file = input.session_id ? cooldownFile(input.session_id, deps.stateDir) : null;
    const cooldowns = file ? loadCooldowns(file) : {};
    const picked: Advisory[] = [];
    for (const id of issueIds.slice(0, CLAIM_LIST_LIMIT)) {
      const top = selectAdvisory(evaluateIssue(snapshotIssue(handles.svc, handles.journal, id, now), identity, { phase: "stop" }), cooldowns, now);
      if (top) picked.push(top);
    }
    if (file) saveCooldowns(file, cooldowns);
    const out = render(picked);
    // A missing handoff is the one advisory worth a single continuation: the
    // next session depends on it. stop_hook_active prevents a loop.
    const handoff = picked.find((a) => a.code === "handoff_due");
    if (out && handoff && !input.stop_hook_active) out.block = formatAdvisory(handoff).agent;
    return out;
  } catch {
    return null;
  } finally {
    try {
      handles?.db.close();
    } catch {
      // best-effort
    }
  }
}

function render(picked: Advisory[]): AdvisorOutput | null {
  if (picked.length === 0) return null;
  const texts = picked.map(formatAdvisory);
  return { systemMessage: texts.map((t) => t.user).join("\n"), additionalContext: texts.map((t) => t.agent).join("\n") };
}

function truncate(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
