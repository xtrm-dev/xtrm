import type {
  ArtifactRecord,
  Closure,
  IssueDetail,
  IssueLink,
  IssueSummary,
  JournalEntry,
  Lifecycle,
  ProvenanceSummary,
  SubstrateAdapter,
  SubstrateProject,
} from "../types.ts";
import { parseContract } from "./contract.ts";

// Wire shapes of the `substrate-cli/v1` envelope (sb 0.2.0). Only the fields read here.
interface Envelope<T> {
  schema: string;
  command: string;
  ok: boolean;
  data?: T;
  error?: string;
}

interface WireProject {
  id: string;
  prefix: string;
  name: string;
}
interface WireLinks {
  links: Array<{ gitRoot: string; projectId: string }>;
}
export interface WireIssue {
  id: string;
  humanRef: string;
  locator?: string;
  title: string;
  kind: string;
  lifecycleState: string;
  revision: number;
  readinessState?: string;
  dispatchable?: boolean;
}
export interface WireProjectionRow {
  id: string;
  humanRef: string;
  locator: string;
  title: string;
  kind: string;
  lifecycleState: string;
  priority: number;
  scrutiny: string;
  revision: number;
  readinessState: string;
  dispatchable: boolean;
  claimState: string;
  parentRef: string | null;
  parentLocator: string | null;
  childCount: number;
  childrenTerminal: number;
  blockedBy: string[];
  createdAt: number;
  updatedAt: number;
}
interface WireBoardPage {
  rows: WireProjectionRow[];
  nextCursor: string | null;
  hasMore: boolean;
  scanned: number;
  truncated: boolean;
}
export interface WireIssueDetail extends WireIssue {
  readinessState: string;
  dispatchable: boolean;
  reasons?: string[];
  contract?: unknown;
  claim?: { holder: string; expiresAt: number } | null;
  closure?: Record<string, unknown> | null;
  operationalContext?: { total?: number } | null;
}
interface WireResume {
  children?: Array<{ issueId: string; humanRef: string; locator?: string; title: string; lifecycleState: string }>;
  release?: { childrenDone: number; childrenTotal: number } | null;
}
// Trace and journal rows are read field by field (below), so older `sb` builds that omit
// newer fields map to explicit nulls instead of failing.
type Obj = Record<string, unknown>;
export interface WireTrace {
  attestation?: Obj | null;
  claims?: Obj[];
  bindings?: Obj[];
  receipts?: Obj[];
  checkpoints?: Obj[];
  commits?: Array<Obj | string>;
  prs?: Array<Obj | string>;
  externalBindings?: Obj[];
}
export type WireJournalEntry = Obj & { id: string; sequence: number; kind: string; issueRevision: number; createdAt: number };

export class SubstrateReadError extends Error {}

const TERMINAL = new Set(["done", "cancelled", "archived"]);

export function unwrap<T>(envelope: Envelope<T>): T {
  if (envelope.schema !== "substrate-cli/v1") throw new SubstrateReadError(`unexpected envelope schema: ${envelope.schema}`);
  if (!envelope.ok || envelope.data === undefined) throw new SubstrateReadError(envelope.error ?? `${envelope.command} failed`);
  return envelope.data;
}

export function mapProjects(projects: WireProject[], links: WireLinks): SubstrateProject[] {
  return projects.map((p) => ({
    id: p.id,
    prefix: p.prefix,
    name: p.name,
    gitRoots: links.links.filter((l) => l.projectId === p.id).map((l) => l.gitRoot),
  }));
}

/** Map board-projection rows (`sb issue query`) to Jira-style rows. Single-issue fields stay on the detail read. */
export function mapBoard(rows: WireProjectionRow[]): IssueSummary[] {
  return rows.map((i) => ({
    id: i.id,
    ref: i.humanRef,
    locator: i.locator,
    title: i.title,
    kind: i.kind,
    lifecycle: i.lifecycleState,
    revision: i.revision,
    priority: i.priority,
    scrutiny: i.scrutiny || null,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    parentRef: i.parentRef,
    parentLocator: i.parentLocator,
    childCount: i.childCount,
    childrenDone: i.childrenTerminal,
    blockedBy: i.blockedBy,
    readiness: i.readinessState as IssueSummary["readiness"],
  }));
}

const link = (row: IssueSummary): IssueLink => ({ id: row.id, ref: row.ref, locator: row.locator, title: row.title, lifecycle: row.lifecycle, kind: row.kind });

const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj).filter((x): x is Obj => !!x) : []);
const refText = (v: unknown): string => {
  if (typeof v === "string") return v;
  const o = obj(v);
  if (!o) return v == null ? "" : String(v);
  return String(o.value ?? o.key ?? o.sha ?? o.ref ?? o.url ?? o.number ?? JSON.stringify(o));
};
const artifact = (o: Obj): ArtifactRecord => ({ kind: String(o.kind ?? "artifact"), value: refText(o.value), provider: strOrNull(o.provider), superseded: o.supersededAt != null });

export function mapJournalEntry(j: WireJournalEntry): JournalEntry {
  const semantic = obj(j.semantic);
  const result = obj(j.result);
  const { summary: semanticSummary, ...semanticRest } = semantic ?? {};
  return {
    id: j.id,
    sequence: j.sequence,
    kind: j.kind,
    revision: j.issueRevision,
    createdAt: j.createdAt,
    summary: strOrNull(semanticSummary) ?? strOrNull(result?.summary) ?? "",
    identity: { participantId: strOrNull(j.participantId), sessionId: strOrNull(j.sessionId), activationId: strOrNull(j.activationId), runId: strOrNull(j.runId) },
    semantic: semantic && Object.keys(semanticRest).length ? semanticRest : null,
    result,
    mechanical: obj(j.mechanical),
    executionContext: obj(j.executionContext),
  };
}

export function mapTrace(t: WireTrace | null, journal: JournalEntry[]): ProvenanceSummary {
  const att = obj(t?.attestation);
  const checkpoints = list(t?.checkpoints).map((c) => ({
    entryId: String(c.entryId ?? ""),
    sequence: numOrNull(c.sequence) ?? 0,
    kind: String(c.kind ?? "checkpoint"),
    revision: numOrNull(c.issueRevision),
    summary: strOrNull(c.summary),
  }));
  const seqOf = new Map<string, number>([...journal.map((e) => [e.id, e.sequence] as const), ...checkpoints.map((c) => [c.entryId, c.sequence] as const)]);
  return {
    attestation: att
      ? {
          outcome: String(att.outcome ?? ""),
          policy: String(att.policy ?? ""),
          attestedBy: String(att.attestedBy ?? ""),
          createdAt: numOrNull(att.createdAt) ?? 0,
          revision: numOrNull(att.issueRevision),
          contractHash: strOrNull(att.contractHash),
          evidenceRefs: (Array.isArray(att.evidenceRefs) ? att.evidenceRefs : []).map(refText).filter(Boolean),
          blockingGaps: (Array.isArray(att.blockingGaps) ? att.blockingGaps : []).map(refText).filter(Boolean),
        }
      : null,
    claims: list(t?.claims).map((c) => ({
      holder: String(c.holder ?? ""),
      activationId: strOrNull(c.activationId),
      acquiredAt: numOrNull(c.acquiredAt),
      expiresAt: numOrNull(c.expiresAt),
      releasedAt: numOrNull(c.releasedAt),
      generation: numOrNull(c.generation),
      revision: numOrNull(c.issueRevision),
    })),
    bindings: list(t?.bindings).map((b) => ({
      id: String(b.id ?? ""),
      participantId: strOrNull(b.participantId),
      activationId: strOrNull(b.activationId),
      attemptId: strOrNull(b.attemptId),
      sessionId: strOrNull(b.sessionId),
      workspace: strOrNull(b.workspace),
      baseCommit: strOrNull(b.baseCommit),
      revision: numOrNull(b.issueRevision),
      createdAt: numOrNull(b.createdAt),
    })),
    receipts: list(t?.receipts).map((r) => {
      const checkpointId = strOrNull(r.journalCheckpointId);
      return {
        id: String(r.id ?? ""),
        bindingId: strOrNull(r.executionBindingId),
        revision: numOrNull(r.issueRevision),
        commitSha: strOrNull(r.commitSha),
        checkpointId,
        checkpointSequence: checkpointId ? (seqOf.get(checkpointId) ?? null) : null,
        validationRefs: list(r.validationRefs).map(artifact),
        artifacts: list(r.artifacts).map(artifact),
        createdAt: numOrNull(r.createdAt),
        finalizedAt: numOrNull(r.finalizedAt),
      };
    }),
    checkpoints,
    commits: (t?.commits ?? []).map(refText).filter(Boolean),
    prs: (t?.prs ?? []).map(refText).filter(Boolean),
    externalBindings: list(t?.externalBindings).map((e) => ({ provider: String(e.provider ?? ""), scope: String(e.scope ?? ""), remoteId: String(e.remoteId ?? ""), url: strOrNull(e.url) })),
  };
}

export function mapClosure(c: Obj | null | undefined): Closure {
  return {
    closed: c?.closed === true,
    closedAt: numOrNull(c?.closedAt),
    reason: strOrNull(c?.reason),
    closureId: strOrNull(c?.closureId),
    outcome: strOrNull(c?.outcome),
    actor: strOrNull(c?.actor),
    session: strOrNull(c?.session),
    revision: numOrNull(c?.revision),
    contractHash: strOrNull(c?.contractHash),
  };
}

export function mapIssueDetail(
  d: WireIssueDetail,
  ctx: { projectId: string | null; board: IssueSummary[]; resume: WireResume | null; trace: WireTrace | null; journal: WireJournalEntry[] },
): IssueDetail {
  const row = ctx.board.find((r) => r.id === d.id);
  const byRef = new Map(ctx.board.map((r) => [r.ref, r]));
  const byId = new Map(ctx.board.map((r) => [r.id, r]));
  const parentRow = row?.parentRef ? byRef.get(row.parentRef) : undefined;
  const children: IssueLink[] = ctx.resume?.children?.length
    ? ctx.resume.children.map((c) => ({ id: c.issueId, ref: c.humanRef, locator: c.locator ?? byId.get(c.issueId)?.locator, title: c.title, lifecycle: c.lifecycleState }))
    : ctx.board.filter((r) => r.parentRef === d.humanRef).map(link);
  const journal = ctx.journal.map(mapJournalEntry).sort((a, b) => b.sequence - a.sequence);
  return {
    id: d.id,
    ref: d.humanRef,
    locator: d.locator ?? row?.locator ?? d.humanRef,
    title: d.title,
    kind: d.kind,
    lifecycle: d.lifecycleState,
    revision: d.revision,
    priority: row?.priority ?? null,
    scrutiny: row?.scrutiny ?? null,
    createdAt: row?.createdAt ?? null,
    updatedAt: row?.updatedAt ?? null,
    parentRef: row?.parentRef ?? null,
    parentLocator: row?.parentLocator ?? null,
    childCount: children.length,
    childrenDone: children.filter((c) => TERMINAL.has(c.lifecycle)).length,
    blockedBy: row?.blockedBy ?? [],
    readiness: d.dispatchable ? "ready" : "not_ready",
    projectId: ctx.projectId,
    readinessState: d.readinessState,
    dispatchable: d.dispatchable,
    reasons: d.reasons ?? [],
    contract: parseContract(d.contract),
    claim: d.claim ? { holder: d.claim.holder, expiresAt: d.claim.expiresAt } : null,
    closure: mapClosure(d.closure),
    parent: parentRow ? link(parentRow) : null,
    children,
    blockers: (row?.blockedBy ?? []).map((ref) => byRef.get(ref)).filter((r): r is IssueSummary => !!r).map(link),
    release: ctx.resume?.release ? { childrenDone: ctx.resume.release.childrenDone, childrenTotal: ctx.resume.release.childrenTotal } : null,
    journal,
    journalTotal: Math.max(journal.length, d.operationalContext?.total ?? 0),
    provenance: mapTrace(ctx.trace, journal),
  };
}

async function read<T>(path: string): Promise<T> {
  const res = await fetch(`/xtrm-api/substrate${path}`);
  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new SubstrateReadError(`substrate bridge returned ${res.status}`);
  }
  if (!("schema" in body)) throw new SubstrateReadError((body as { error?: string }).error ?? `substrate bridge returned ${res.status}`);
  return unwrap(body);
}

async function write(path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`/xtrm-api/substrate${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as Envelope<unknown> | { ok: false; error: string } | null;
  if (!json) throw new SubstrateReadError(`substrate bridge returned ${res.status}`);
  if ("schema" in json) return unwrap(json);
  throw new SubstrateReadError(json.error);
}

// ponytail: one bounded read of full bodies; `sb journal show` has no offset. Page server-side if journals outgrow it.
export const JOURNAL_READ_LIMIT = 2000;
// Page size for the board projection walk (`sb issue query`, MAX_PAGE_LIMIT 500).
export const BOARD_PAGE_LIMIT = 500;

const projectOf = (ref: string) => ref.split("-")[0]?.toUpperCase();

export const liveSubstrate: SubstrateAdapter = {
  source: "live",
  async canWrite() {
    const res = await fetch("/xtrm-api/substrate/capabilities");
    return res.ok ? ((await res.json()) as { writes: boolean }).writes : false;
  },
  async listProjects() {
    const [projects, links] = await Promise.all([read<WireProject[]>("/projects"), read<WireLinks>("/links")]);
    return mapProjects(projects, links);
  },
  async listIssues(projectId) {
    // One projection read per project, walked to exhaustion so the board stays
    // complete (XTRM-393). Readiness is read from the row, never reconstructed.
    const rows: WireProjectionRow[] = [];
    let cursor: string | null = null;
    for (;;) {
      const path: string = cursor
        ? `/query?project=${encodeURIComponent(projectId)}&limit=${BOARD_PAGE_LIMIT}&cursor=${encodeURIComponent(cursor)}`
        : `/query?project=${encodeURIComponent(projectId)}&limit=${BOARD_PAGE_LIMIT}`;
      const page: WireBoardPage = await read<WireBoardPage>(path);
      rows.push(...page.rows);
      if (!page.hasMore || !page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return mapBoard(rows);
  },
  async getIssue(ref, projectId) {
    const r = `?ref=${encodeURIComponent(ref)}`;
    const resolvedProject = projectId ?? (await this.listProjects()).find((p) => p.prefix === projectOf(ref))?.id ?? null;
    const [detail, resume, trace, journal, board] = await Promise.all([
      read<WireIssueDetail>(`/issue${r}`),
      read<WireResume>(`/resume${r}`).catch(() => null),
      read<WireTrace>(`/trace${r}`).catch(() => null),
      read<WireJournalEntry[]>(`/journal${r}&limit=${JOURNAL_READ_LIMIT}`).catch(() => []),
      resolvedProject ? this.listIssues(resolvedProject).catch(() => []) : Promise.resolve([]),
    ]);
    return mapIssueDetail(detail, { projectId: resolvedProject, board, resume, trace, journal });
  },
  async editIssue(projectId, ref, expectedRevision, edit) {
    await write("/edit", { project: projectId, ref, expectedRevision, ...edit });
  },
  async setLifecycle(projectId, ref, state: Lifecycle) {
    await write("/state", { project: projectId, ref, state });
  },
  async addNote(projectId, ref, text, kind) {
    await write("/note", { project: projectId, ref, text, kind });
  },
  async createIssue(projectId, input) {
    const created = (await write("/create", { project: projectId, ...input })) as { humanRef?: string; issue?: { humanRef?: string } } | null;
    return created?.humanRef ?? created?.issue?.humanRef ?? "";
  },
};
