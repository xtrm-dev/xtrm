// Shared versioned ExecutionContext envelope (XTRM-252.6 / XTRM-258,
// ADR sbcloseout4 §§33-37, 57, 97-98).
//
// ONE AUTHORITY: every consumer (Journal, ExecutionBinding, WorkReceipt,
// Specialists, Pi, Claude, hooks) imports this module. Never fork the
// envelope per consumer. Unknown values remain absent and are never
// invented from model prose or display labels (§98).
//
// Pure types + validation + pure enrichment only; persistence lives in
// journal-service.ts / provenance-service.ts behind additive migration 010.

export const EXECUTION_CONTEXT_VERSION = 1;
export const KNOWN_EXECUTION_CONTEXT_VERSIONS = [1] as const;

// Canonical actor types (ADR §33). Closed: an explicit value outside this
// set fails validation rather than persisting a novel actor kind.
export const ACTOR_TYPES = [
  "human",
  "coordinator",
  "agent",
  "specialist",
  "reviewer",
  "validator",
  "hook",
  "runtime",
  "system",
] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export function isActorType(value: unknown): value is ActorType {
  return typeof value === "string" && (ACTOR_TYPES as readonly string[]).includes(value);
}

// Host/provider label (ADR §34). The ADR defines NO host vocabulary — only
// §33 actor types are bounded. host.type accepts any trusted non-empty
// label from a host-known adapter path; unknown stays absent (§98).
export type HostType = string;

export interface ActorIdentity {
  type: ActorType;
  id?: string | null;
  name?: string | null;
}

export interface ExecutionHost {
  type: HostType;
  sessionId?: string | null;
}

// Coordinator lineage leg (ADR §§34, 37): the parent/coordinator identity
// preserved alongside the current participant. `participantId` is the
// coordinator participant that dispatched this execution; `sessionId` is
// the coordinator session that performed the dispatch. Closed: unknown or
// blank fields are rejected, never stored.
export interface ExecutionCoordinator {
  participantId?: string | null;
  sessionId?: string | null;
}

export interface SpecialistIdentity {
  name?: string | null;
  activationId?: string | null;
  attemptId?: string | null;
  agentSessionId?: string | null;
}

export interface ExecutionWorkspace {
  repositoryKey?: string | null;
  repoPath?: string | null;
  worktree?: string | null;
  branch?: string | null;
  baseCommit?: string | null;
  headCommit?: string | null;
}

export interface ExecutionContext {
  version?: number;
  actor?: ActorIdentity | null;
  participantId?: string | null;
  xtrmSessionId?: string | null;
  xtrmSessionName?: string | null;
  host?: ExecutionHost | null;
  runId?: string | null;
  chainRunId?: string | null;
  coordinator?: ExecutionCoordinator | null;
  specialist?: SpecialistIdentity | null;
  workspace?: ExecutionWorkspace | null;
  timestamp?: number | null;
}

// Exact R4 contract variables (ADR §36). The ONLY environment source the
// enrichment utility may read. Never parse prose or display labels.
export const XTRM_SESSION_ID_ENV = "XTRM_SESSION_ID";
export const XTRM_SESSION_NAME_ENV = "XTRM_SESSION_NAME";

const TOP_LEVEL_FIELDS = [
  "version",
  "actor",
  "participantId",
  "xtrmSessionId",
  "xtrmSessionName",
  "host",
  "runId",
  "chainRunId",
  "coordinator",
  "specialist",
  "workspace",
  "timestamp",
] as const;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// Closed validation: unknown keys rejected, unknown explicit versions and
// unknown actor types fail closed. Missing version reads as v1 (legacy rows
// predate the envelope). Absent/null/empty means unknown.
export function validateExecutionContext(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value !== "object" || Array.isArray(value)) return ["executionContext must be an object when present"];
  const problems: string[] = [];
  const c = value as Record<string, unknown>;
  for (const key of Object.keys(c)) {
    if (!(TOP_LEVEL_FIELDS as readonly string[]).includes(key)) {
      problems.push(`executionContext.${key} is not a known execution-context field`);
    }
  }
  const version = c["version"];
  if (version !== undefined && version !== null) {
    if (typeof version !== "number" || !Number.isInteger(version)) {
      problems.push(`executionContext.version ${JSON.stringify(version)} is unknown (want ${EXECUTION_CONTEXT_VERSION})`);
    } else if (!(KNOWN_EXECUTION_CONTEXT_VERSIONS as readonly number[]).includes(version)) {
      problems.push(`executionContext.version ${version} is unknown (want ${EXECUTION_CONTEXT_VERSION})`);
    }
  }
  const actor = c["actor"];
  if (actor !== undefined && actor !== null) {
    if (typeof actor !== "object" || Array.isArray(actor)) {
      problems.push("executionContext.actor must be an object when present");
    } else {
      const a = actor as Record<string, unknown>;
      for (const key of Object.keys(a)) {
        if (!["type", "id", "name"].includes(key)) problems.push(`executionContext.actor.${key} is not a known actor field`);
      }
      if (!isActorType(a["type"])) problems.push(`executionContext.actor.type ${JSON.stringify(a["type"])} is unknown (want ${ACTOR_TYPES.join("|")})`);
      for (const f of ["id", "name"] as const) {
        if (a[f] !== undefined && a[f] !== null && !nonEmpty(a[f])) {
          problems.push(`executionContext.actor.${f} must be a non-empty string when present`);
        }
      }
    }
  }
  const host = c["host"];
  if (host !== undefined && host !== null) {
    if (typeof host !== "object" || Array.isArray(host)) {
      problems.push("executionContext.host must be an object when present");
    } else {
      const h = host as Record<string, unknown>;
      for (const key of Object.keys(h)) {
        if (!["type", "sessionId"].includes(key)) problems.push(`executionContext.host.${key} is not a known host field`);
      }
      if (!nonEmpty(h["type"])) problems.push("executionContext.host.type must be a non-empty trusted label when present");
      if (h["sessionId"] !== undefined && h["sessionId"] !== null && !nonEmpty(h["sessionId"])) {
        problems.push("executionContext.host.sessionId must be a non-empty string when present");
      }
    }
  }
  const coordinator = c["coordinator"];
  if (coordinator !== undefined && coordinator !== null) {
    if (typeof coordinator !== "object" || Array.isArray(coordinator)) {
      problems.push("executionContext.coordinator must be an object when present");
    } else {
      const k = coordinator as Record<string, unknown>;
      for (const key of Object.keys(k)) {
        if (!["participantId", "sessionId"].includes(key)) {
          problems.push(`executionContext.coordinator.${key} is not a known coordinator field`);
        }
      }
      for (const f of ["participantId", "sessionId"] as const) {
        if (k[f] !== undefined && k[f] !== null && !nonEmpty(k[f])) {
          problems.push(`executionContext.coordinator.${f} must be a non-empty string when present`);
        }
      }
    }
  }
  const specialist = c["specialist"];
  if (specialist !== undefined && specialist !== null) {
    if (typeof specialist !== "object" || Array.isArray(specialist)) {
      problems.push("executionContext.specialist must be an object when present");
    } else {
      const s = specialist as Record<string, unknown>;
      for (const key of Object.keys(s)) {
        if (!["name", "activationId", "attemptId", "agentSessionId"].includes(key)) {
          problems.push(`executionContext.specialist.${key} is not a known specialist field`);
        }
      }
      for (const f of ["name", "activationId", "attemptId", "agentSessionId"] as const) {
        if (s[f] !== undefined && s[f] !== null && !nonEmpty(s[f])) {
          problems.push(`executionContext.specialist.${f} must be a non-empty string when present`);
        }
      }
    }
  }
  const workspace = c["workspace"];
  if (workspace !== undefined && workspace !== null) {
    if (typeof workspace !== "object" || Array.isArray(workspace)) {
      problems.push("executionContext.workspace must be an object when present");
    } else {
      const w = workspace as Record<string, unknown>;
      for (const key of Object.keys(w)) {
        if (!["repositoryKey", "repoPath", "worktree", "branch", "baseCommit", "headCommit"].includes(key)) {
          problems.push(`executionContext.workspace.${key} is not a known workspace field`);
        }
      }
      for (const f of ["repositoryKey", "repoPath", "worktree", "branch", "baseCommit", "headCommit"] as const) {
        if (w[f] !== undefined && w[f] !== null && !nonEmpty(w[f])) {
          problems.push(`executionContext.workspace.${f} must be a non-empty string when present`);
        }
      }
    }
  }
  for (const f of ["participantId", "xtrmSessionId", "xtrmSessionName", "runId", "chainRunId"] as const) {
    if (c[f] !== undefined && c[f] !== null && !nonEmpty(c[f])) {
      problems.push(`executionContext.${f} must be a non-empty string when present`);
    }
  }
  if (c["timestamp"] !== undefined && c["timestamp"] !== null) {
    if (typeof c["timestamp"] !== "number" || !Number.isInteger(c["timestamp"])) {
      problems.push("executionContext.timestamp must be an integer when present");
    }
  }
  return problems;
}

export function assertExecutionContext(value: unknown): asserts value is ExecutionContext {
  const problems = validateExecutionContext(value);
  if (problems.length > 0) throw new Error(`invalid execution context: ${problems[0]}`);
}

function cleanStr(value: unknown): string | undefined {
  return nonEmpty(value) ? (value as string) : undefined;
}

function cleanObj<T extends Record<string, unknown>>(value: unknown, keys: readonly string[]): T | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return value as T;
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = cleanStr(src[k]);
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

// Normalize to the canonical stored shape. Fail-closed FIRST: the raw
// input is validated before any cleanup, so unknown top-level/nested
// fields and present-but-blank strings are rejected rather than silently
// discarded or converted to unknown. null/undefined means absent. Missing
// version defaults to v1. Throws on unknown versions/fields/types/blanks.
export function normalizeExecutionContext(value: unknown): ExecutionContext | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid execution context: executionContext must be an object when present");
  }
  const c = value as Record<string, unknown>;
  const rawProblems = validateExecutionContext(value);
  if (rawProblems.length > 0) throw new Error(`invalid execution context: ${rawProblems[0]}`);
  const out: ExecutionContext = {};
  const version = c["version"];
  out.version = version === undefined || version === null ? EXECUTION_CONTEXT_VERSION : (version as number);
  const actor = cleanObj<Record<string, unknown>>(c["actor"], ["type", "id", "name"]);
  if (actor !== undefined) {
    const a: ActorIdentity = { type: actor["type"] as ActorType };
    const id = cleanStr(actor["id"]);
    const name = cleanStr(actor["name"]);
    if (id !== undefined) a.id = id;
    if (name !== undefined) a.name = name;
    if (a.type !== undefined) out.actor = a;
  }
  const participantId = cleanStr(c["participantId"]);
  if (participantId !== undefined) out.participantId = participantId;
  const xtrmSessionId = cleanStr(c["xtrmSessionId"]);
  if (xtrmSessionId !== undefined) out.xtrmSessionId = xtrmSessionId;
  const xtrmSessionName = cleanStr(c["xtrmSessionName"]);
  if (xtrmSessionName !== undefined) out.xtrmSessionName = xtrmSessionName;
  const host = cleanObj<Record<string, unknown>>(c["host"], ["type", "sessionId"]);
  if (host !== undefined && host["type"] !== undefined) {
    const h: ExecutionHost = { type: host["type"] as HostType };
    const sessionId = cleanStr(host["sessionId"]);
    if (sessionId !== undefined) h.sessionId = sessionId;
    out.host = h;
  }
  const runId = cleanStr(c["runId"]);
  if (runId !== undefined) out.runId = runId;
  const chainRunId = cleanStr(c["chainRunId"]);
  if (chainRunId !== undefined) out.chainRunId = chainRunId;
  const coordinator = cleanObj<Record<string, unknown>>(c["coordinator"], ["participantId", "sessionId"]);
  if (coordinator !== undefined && Object.keys(coordinator).length > 0) out.coordinator = coordinator as ExecutionCoordinator;
  const specialist = cleanObj<Record<string, unknown>>(c["specialist"], ["name", "activationId", "attemptId", "agentSessionId"]);
  if (specialist !== undefined && Object.keys(specialist).length > 0) out.specialist = specialist as SpecialistIdentity;
  const workspace = cleanObj<Record<string, unknown>>(c["workspace"], ["repositoryKey", "repoPath", "worktree", "branch", "baseCommit", "headCommit"]);
  if (workspace !== undefined && Object.keys(workspace).length > 0) out.workspace = workspace as ExecutionWorkspace;
  if (typeof c["timestamp"] === "number" && Number.isInteger(c["timestamp"])) out.timestamp = c["timestamp"] as number;
  assertExecutionContext(out);
  return out;
}

export interface EnrichInput {
  actor?: ActorIdentity | null;
  participantId?: string | null;
  xtrmSessionId?: string | null;
  xtrmSessionName?: string | null;
  host?: ExecutionHost | null;
  runId?: string | null;
  chainRunId?: string | null;
  coordinator?: ExecutionCoordinator | null;
  specialist?: SpecialistIdentity | null;
  workspace?: ExecutionWorkspace | null;
}

// Pure enrichment/normalization from trusted typed input plus the exact R4
// env contract only. `env` defaults to process.env at call time (injectable
// for tests). Returns null when nothing is known — the caller stores an
// absent envelope rather than a fabricated one (§98). Never parses prose
// or display labels; never mints session/activation/participant identity.
export function enrichExecutionContext(
  input: EnrichInput | null | undefined,
  env: Record<string, string | undefined> = process.env,
  opts?: { now?: number },
): ExecutionContext | null {
  const src = input ?? {};
  const xtrmSessionId = cleanStr(src.xtrmSessionId) ?? cleanStr(env[XTRM_SESSION_ID_ENV]);
  const xtrmSessionName = cleanStr(src.xtrmSessionName) ?? cleanStr(env[XTRM_SESSION_NAME_ENV]);
  const candidate: Record<string, unknown> = {
    version: EXECUTION_CONTEXT_VERSION,
    actor: src.actor ?? undefined,
    participantId: cleanStr(src.participantId),
    xtrmSessionId,
    xtrmSessionName,
    host: src.host ?? undefined,
    runId: cleanStr(src.runId),
    chainRunId: cleanStr(src.chainRunId),
    coordinator: src.coordinator ?? undefined,
    specialist: src.specialist ?? undefined,
    workspace: src.workspace ?? undefined,
  };
  const known =
    candidate["actor"] !== undefined ||
    candidate["participantId"] !== undefined ||
    candidate["xtrmSessionId"] !== undefined ||
    candidate["xtrmSessionName"] !== undefined ||
    candidate["host"] !== undefined ||
    candidate["runId"] !== undefined ||
    candidate["chainRunId"] !== undefined ||
    candidate["coordinator"] !== undefined ||
    candidate["specialist"] !== undefined ||
    candidate["workspace"] !== undefined;
  if (!known) return null;
  candidate["timestamp"] = opts?.now ?? Date.now();
  return normalizeExecutionContext(candidate);
}

// Legacy flat columns (execution_bindings / issue_journal rows written
// before migration 010) carry no version: project them to a v1 envelope.
// Returns null when every flat field is absent (§98: nothing invented).
// timestamp comes ONLY from the caller's durable row createdAt — never the
// current clock, so hydration fabricates no fresh identity or time.
export interface LegacyFlatIdentity {
  participantId?: string | null;
  activationId?: string | null;
  attemptId?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  workspace?: string | null;
  baseCommit?: string | null;
}

export function executionContextFromLegacy(flat: LegacyFlatIdentity, opts?: { timestamp?: number }): ExecutionContext | null {
  const participantId = cleanStr(flat.participantId);
  const activationId = cleanStr(flat.activationId);
  const attemptId = cleanStr(flat.attemptId);
  const sessionId = cleanStr(flat.sessionId);
  const runId = cleanStr(flat.runId);
  const workspace = cleanStr(flat.workspace);
  const baseCommit = cleanStr(flat.baseCommit);
  if (
    participantId === undefined &&
    activationId === undefined &&
    attemptId === undefined &&
    sessionId === undefined &&
    runId === undefined &&
    workspace === undefined &&
    baseCommit === undefined
  ) {
    return null;
  }
  const out: ExecutionContext = { version: EXECUTION_CONTEXT_VERSION };
  if (opts?.timestamp !== undefined && Number.isInteger(opts.timestamp)) out.timestamp = opts.timestamp;
  if (participantId !== undefined) out.participantId = participantId;
  if (runId !== undefined) out.runId = runId;
  const specialist: SpecialistIdentity = {};
  if (activationId !== undefined) specialist.activationId = activationId;
  if (attemptId !== undefined) specialist.attemptId = attemptId;
  if (Object.keys(specialist).length > 0) out.specialist = specialist;
  // The flat workspace string names the checkout the execution runs in,
  // which is worktree semantics; repoPath requires repository identity
  // (R1) that legacy rows cannot supply. Provider-unknown legacy session
  // ids stay flat-only below: no host.type is invented for them (§98).
  const ws: ExecutionWorkspace = {};
  if (workspace !== undefined) ws.worktree = workspace;
  if (baseCommit !== undefined) ws.baseCommit = baseCommit;
  if (Object.keys(ws).length > 0) out.workspace = ws;
  void sessionId;
  return out;
}

export interface FlatIdentityProjection {
  participantId: string | null;
  activationId: string | null;
  attemptId: string | null;
  sessionId: string | null;
  runId: string | null;
  workspace: string | null;
  baseCommit: string | null;
}

// CENTRAL PROJECTION (single authority) with fail-closed conflicts.
// Envelope and legacy/manual scalars claim the SAME facts, so when both
// supply a non-empty value for one field they must agree exactly —
// disagreement throws before any write. Equal values are allowed; a legacy
// scalar fills only an envelope-absent compatibility field.
//
// Output precedence: session reads xtrmSessionId first (so existing session
// queries follow the automatic R4 session), then host.sessionId, then the
// legacy scalar. Workspace reads worktree first (the flat workspace column
// names the execution checkout), then repoPath, then legacy.
//
// Narrow flat-only exception (§98): a provider-unknown legacy session id
// has no envelope representation — no host.type is invented — so it stays
// queryable on the flat session column only. Everything else the envelope
// represents must agree with the flat columns; there is no second semantic.
export function projectFlatIdentity(
  ctx: ExecutionContext | null | undefined,
  legacy?: LegacyFlatIdentity,
): FlatIdentityProjection {
  // Exact-counterpart conflict check: the legacy scalar and the envelope
  // field describe the same fact. Both non-empty and different fails
  // closed; equal values pass through. xtrmSessionId is a DIFFERENT field
  // from the provider session and never conflicts with it; workspace
  // location is compared against either envelope path label.
  const compat = (fromCtx: string | undefined, fromLegacy: string | null | undefined, label: string): string | null => {
    const c = cleanStr(fromCtx);
    const l = cleanStr(fromLegacy);
    if (c !== undefined && l !== undefined && c !== l) {
      throw new Error(`execution identity conflict on ${label}: envelope and legacy scalar disagree (repair and retry)`);
    }
    return c ?? l ?? null;
  };
  const sessionCompat = compat(ctx?.host?.sessionId ?? undefined, legacy?.sessionId, "sessionId");
  const workspaceCompat = compat(
    ctx?.workspace?.worktree ?? ctx?.workspace?.repoPath ?? undefined,
    legacy?.workspace,
    "workspace",
  );
  return {
    participantId: compat(ctx?.participantId ?? undefined, legacy?.participantId, "participantId"),
    activationId: compat(ctx?.specialist?.activationId ?? undefined, legacy?.activationId, "activationId"),
    attemptId: compat(ctx?.specialist?.attemptId ?? undefined, legacy?.attemptId, "attemptId"),
    sessionId: cleanStr(ctx?.xtrmSessionId) ?? sessionCompat,
    runId: compat(ctx?.runId ?? undefined, legacy?.runId, "runId"),
    workspace: workspaceCompat,
    baseCommit: compat(ctx?.workspace?.baseCommit ?? undefined, legacy?.baseCommit, "baseCommit"),
  };
}
