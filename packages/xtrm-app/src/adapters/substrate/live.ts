import type {
  ArtifactRecord,
  BoardConnection,
  Closure,
  IssueDetail,
  IssueLink,
  IssueSummary,
  JournalEntry,
  JournalFeedEntryWire,
  JournalPaging,
  Lifecycle,
  ProvenanceSummary,
  Readiness,
  SubstrateAdapter,
  SubstrateProject,
} from "../types.ts";
import { parseContract } from "./contract.ts";
import { parseDispatchGraph } from "./graph.ts";

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
  /** XTRM-730 additive field; absent on older `sb` builds. */
  primaryPr?: unknown;
  // Absent from `sb` builds older than the journal aggregates.
  journalCount?: number;
  pointerCount?: number;
  lastActivityAt?: number;
  attestationState?: "none" | "current" | "stale" | "rejected";
  structurallyValid?: boolean;
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
export type WireJournalEntry = Obj & { id: string; sequence: number; kind: string; issueRevision: number; createdAt: number; unreadable?: string | null };

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
    lastActivityAt: i.lastActivityAt ?? i.updatedAt,
    eventCount: i.journalCount ?? 0,
    pointerCount: i.pointerCount ?? 0,
    primaryPr: (i.primaryPr as IssueSummary["primaryPr"] | undefined) ?? null,
    attestation: i.attestationState ?? null,
    contractComplete: i.structurallyValid ?? null,
    dispatchable: i.dispatchable,
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
    unreadable: strOrNull(j.unreadable),
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

type IssueDetailCtx = { projectId: string | null; resume: WireResume | null; trace: WireTrace | null; journal: WireJournalEntry[]; journalError?: string | null; journalPaging?: JournalPaging | null };

/**
 * The detail as the four per-issue reads describe it. Fields that only the project board carries
 * (priority, scrutiny, dates, parent, blockers) are neutral here; `applyBoard` fills them in.
 */
const OPERATIONAL: ReadonlySet<string> = new Set(["terminal", "deferred", "draft", "blocked", "claimed", "ready"]);

/**
 * The detail's readiness is Substrate's operational state, the same value the board row carries.
 * It used to collapse to `ready`/`not_ready` from `dispatchable`, which dropped `claimed` and
 * `blocked`: a claimed, attested issue then derived as "Open" in the drawer while the list said
 * "In progress". `not_ready` remains only for an `sb` build that omits the state.
 */
export function detailReadiness(state: string | undefined, dispatchable: boolean): Readiness {
  if (state !== undefined && OPERATIONAL.has(state)) return state as Readiness;
  return dispatchable ? "ready" : "not_ready";
}

export function mapIssueCore(d: WireIssueDetail, ctx: IssueDetailCtx): IssueDetail {
  const children: IssueLink[] = (ctx.resume?.children ?? []).map((c) => ({ id: c.issueId, ref: c.humanRef, locator: c.locator, title: c.title, lifecycle: c.lifecycleState }));
  const journal = ctx.journal.map(mapJournalEntry).sort((a, b) => b.sequence - a.sequence);
  const journalError = ctx.journalError ?? null;
  const journalPaging = ctx.journalPaging ?? null;
  return {
    id: d.id,
    ref: d.humanRef,
    locator: d.locator ?? d.humanRef,
    title: d.title,
    kind: d.kind,
    lifecycle: d.lifecycleState,
    revision: d.revision,
    priority: null,
    scrutiny: null,
    createdAt: null,
    lastActivityAt: null,
    eventCount: journal.length,
    pointerCount: 0,
    attestation: null,
    contractComplete: null,
    updatedAt: null,
    parentRef: null,
    parentLocator: null,
    childCount: children.length,
    childrenDone: children.filter((c) => TERMINAL.has(c.lifecycle)).length,
    blockedBy: [],
    readiness: detailReadiness(d.readinessState, d.dispatchable),
    projectId: ctx.projectId,
    readinessState: d.readinessState,
    dispatchable: d.dispatchable,
    reasons: d.reasons ?? [],
    contract: parseContract(d.contract),
    claim: d.claim ? { holder: d.claim.holder, expiresAt: d.claim.expiresAt } : null,
    closure: mapClosure(d.closure),
    parent: null,
    children,
    blockers: [],
    release: ctx.resume?.release ? { childrenDone: ctx.resume.release.childrenDone, childrenTotal: ctx.resume.release.childrenTotal } : null,
    journal,
    journalError,
    journalPaging,
    journalTotal: Math.max(journal.length, d.operationalContext?.total ?? 0),
    provenance: mapTrace(ctx.trace, journal),
    pullRequests: (((d as { pullRequests?: unknown }).pullRequests as Array<Record<string, unknown>> | undefined) ?? []).map((p) => ({
      id: Number(p.id ?? 0),
      repository: String(p.repository ?? ""),
      number: Number(p.number ?? 0),
      relation: (p.relation === "mentioned" ? "mentioned" : "created_from") as "created_from" | "mentioned",
      sources: Array.isArray(p.sources) ? (p.sources as string[]) : [],
      alsoMentioned: Boolean(p.alsoMentioned ?? p.also_mentioned),
      url: (p.url as string | null) ?? null,
      actor: (p.actor as string | null) ?? null,
      createdAt: Number(p.createdAt ?? p.created_at ?? 0),
      commits: Array.isArray(p.commits) ? (p.commits as IssueDetail["pullRequests"][number]["commits"]) : [],
      state: (p.state as string | null) ?? null,
      // 'assumed' until a reconciler read confirms it (XTRM-754 wire field).
      stateSource: (p.stateSource as string | null) ?? (p.state_source as string | null) ?? null,
      title: (p.title as string | null) ?? null,
      mergedAt: (p.mergedAt ?? p.merged_at) != null ? Number(p.mergedAt ?? p.merged_at) : null,
    })),
    linkEvents: ((d as { linkEvents?: unknown }).linkEvents as IssueDetail["linkEvents"] | undefined) ?? [],
    linkGate: ((d as { linkGate?: unknown }).linkGate as IssueDetail["linkGate"] | undefined) ?? { mode: "manual", manual: { verdict: "pass", codes: [] } },
    primaryPr: ((d as { primaryPr?: unknown }).primaryPr as IssueDetail["primaryPr"] | undefined) ?? null,
  };
}

/**
 * Fill the board-derived fields of a detail from the project board. Pure and idempotent: the board
 * row wins where it exists, the detail's own value stays otherwise, so applying a newer board to
 * the same core detail always recomputes the result from scratch.
 */
export function applyBoard(detail: IssueDetail, board: IssueSummary[]): IssueDetail {
  const row = board.find((r) => r.id === detail.id);
  const byRef = new Map(board.map((r) => [r.ref, r]));
  const byId = new Map(board.map((r) => [r.id, r]));
  const parentRef = row?.parentRef ?? detail.parentRef;
  const parentRow = parentRef ? byRef.get(parentRef) : undefined;
  const children: IssueLink[] = detail.children.length
    ? detail.children.map((c) => ({ ...c, locator: c.locator ?? byId.get(c.id)?.locator }))
    : board.filter((r) => r.parentRef === detail.ref).map(link);
  const blockedBy = row?.blockedBy ?? detail.blockedBy;
  return {
    ...detail,
    locator: detail.locator === detail.ref && row?.locator ? row.locator : detail.locator,
    priority: row?.priority ?? detail.priority,
    scrutiny: row?.scrutiny ?? detail.scrutiny,
    createdAt: row?.createdAt ?? detail.createdAt,
    lastActivityAt: row?.lastActivityAt ?? detail.lastActivityAt,
    eventCount: row?.eventCount ?? detail.eventCount,
    pointerCount: row?.pointerCount ?? detail.pointerCount,
    attestation: row?.attestation ?? detail.attestation,
    contractComplete: row?.contractComplete ?? detail.contractComplete,
    updatedAt: row?.updatedAt ?? detail.updatedAt,
    parentRef,
    parentLocator: row?.parentLocator ?? detail.parentLocator,
    childCount: children.length,
    childrenDone: children.filter((c) => TERMINAL.has(c.lifecycle)).length,
    blockedBy,
    parent: parentRow ? link(parentRow) : detail.parent,
    children,
    blockers: blockedBy.map((ref) => byRef.get(ref)).filter((r): r is IssueSummary => !!r).map(link),
  };
}

export function mapIssueDetail(d: WireIssueDetail, ctx: IssueDetailCtx & { board: IssueSummary[] }): IssueDetail {
  return applyBoard(mapIssueCore(d, ctx), ctx.board);
}

/**
 * The bridge names the journal read it served. `unknown` is carried through as
 * itself: the request was served as asked, but nothing proved paging, so it must
 * not be read as `cursor` (a capability) nor as `legacy` (a downgrade).
 */
export function journalPagingFromHeader(header: string | null): JournalPaging | null {
  return header === "legacy" || header === "cursor" || header === "unknown" ? header : null;
}

async function readWithMeta<T>(path: string): Promise<{ data: T; paging: JournalPaging | null }> {
  const res = await fetch(`/xtrm-api/substrate${path}`);
  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new SubstrateReadError(`substrate bridge returned ${res.status}`);
  }
  if (!("schema" in body)) throw new SubstrateReadError((body as { error?: string }).error ?? `substrate bridge returned ${res.status}`);
  // Test doubles stub only json(); be tolerant of a response without headers.
  return { data: unwrap(body), paging: journalPagingFromHeader(res.headers?.get?.("x-xtrm-journal-paging") ?? null) };
}

async function read<T>(path: string): Promise<T> {
  return (await readWithMeta<T>(path)).data;
}

async function write(path: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`/xtrm-api/substrate${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => null)) as Envelope<unknown> | { ok: false; error: string } | null;
  if (!json) throw new SubstrateReadError(`substrate bridge returned ${res.status}`);
  if ("schema" in json) return unwrap(json);
  throw new SubstrateReadError(json.error);
}

// First journal page: the newest N entries with bodies. Older pages come from
// `readJournal({ before })`, so a large journal is never read in one payload.
export const JOURNAL_TAIL = 200;
/** The bridge's per-page ceiling (`JOURNAL_PAGE_MAX` in server/substrate-cli.ts). */
export const JOURNAL_TAIL_MAX = 2000;
// Page size for the board projection walk (`sb issue query`, MAX_PAGE_LIMIT 500).
export const BOARD_PAGE_LIMIT = 500;

const projectOf = (ref: string) => ref.split("-")[0]?.toUpperCase();

export const liveSubstrate: SubstrateAdapter = {
  source: "live",
  async canWrite() {
    const res = await fetch("/xtrm-api/substrate/capabilities");
    return res.ok ? ((await res.json()) as { writes: boolean }).writes : false;
  },
  /** The bridge knows the transport; a failed read is "unknown", never "local". */
  async connection() {
    try {
      const res = await fetch("/xtrm-api/substrate/capabilities");
      if (!res.ok) return null;
      const body = (await res.json()) as { connection?: BoardConnection | null };
      return body.connection ?? null;
    } catch {
      return null;
    }
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
  async getIssue(ref, projectId, opts) {
    const r = `?ref=${encodeURIComponent(ref)}`;
    // Default: the full detail, board included (the agent reference resolver has no query cache).
    // `withBoard: false` returns the core detail and leaves the board to the caller (applyBoard).
    const withBoard = opts?.withBoard !== false;
    // The project is resolved beside the detail reads, never before them.
    const project: Promise<string | null> = projectId
      ? Promise.resolve(projectId)
      : this.listProjects().then((ps) => ps.find((p) => p.prefix === projectOf(ref))?.id ?? null);
    const board = withBoard ? project.then((id) => (id ? this.listIssues(id).catch(() => []) : [])) : Promise.resolve([] as IssueSummary[]);
    const [detail, resume, trace, journal, resolvedProject, rows] = await Promise.all([
      read<WireIssueDetail>(`/issue${r}`),
      read<WireResume>(`/resume${r}`).catch(() => null),
      read<WireTrace>(`/trace${r}`).catch(() => null),
      // A failed journal read must not empty the tab silently, and must not take
      // the whole detail down with it: carry the error alongside the entries.
      readWithMeta<WireJournalEntry[]>(`/journal${r}&tail=${JOURNAL_TAIL}`)
        .then(({ data, paging }) => ({ entries: data, error: null as string | null, paging }))
        .catch((e: unknown) => ({ entries: [] as WireJournalEntry[], error: e instanceof Error ? e.message : "journal read failed", paging: null as JournalPaging | null })),
      project,
      board,
    ]);
    return mapIssueDetail(detail, { projectId: resolvedProject, board: rows, resume, trace, journal: journal.entries, journalError: journal.error, journalPaging: journal.paging });
  },
  async readJournal(ref, opts) {
    // The bridge refuses anything above its per-page ceiling, so clamp here.
    const page = Math.min(opts?.limit ?? JOURNAL_TAIL, JOURNAL_TAIL_MAX);
    const query = opts?.tail
      ? `&tail=${Math.min(opts.tail, JOURNAL_TAIL_MAX)}`
      : opts?.before
        ? `&before=${opts.before}&limit=${page}`
        : `&tail=${page}`;
    const entries = await read<WireJournalEntry[]>(`/journal?ref=${encodeURIComponent(ref)}${query}`);
    return entries.map(mapJournalEntry).sort((a, b) => b.sequence - a.sequence);
  },
  async journalFeed(projectId, opts) {
    const page = Math.min(opts?.limit ?? 50, 500);
    const cursor = opts?.cursor ? `&cursor=${encodeURIComponent(opts.cursor)}` : "";
    const body = await read<{ entries: JournalFeedEntryWire[]; nextCursor: string | null }>(
      `/journal-feed?project=${encodeURIComponent(projectId)}&limit=${page}${cursor}`,
    );
    return { entries: body.entries, nextCursor: body.nextCursor ?? null };
  },
  async dispatchGraph(projectId, opts) {
    const params = new URLSearchParams({ project: projectId });
    if (opts?.since !== undefined) params.set("since", String(opts.since));
    if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
    // The wire shape is parsed, not trusted: a vertex whose kind the app does not
    // know is dropped rather than rendered as an unnameable row.
    return parseDispatchGraph(await read<unknown>(`/graph?${params.toString()}`));
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
