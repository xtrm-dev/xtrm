import type {
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
  title: string;
  kind: string;
  lifecycleState: string;
  revision: number;
  readinessState?: string;
  dispatchable?: boolean;
}
export interface WireExport {
  issues: Array<{
    issue: { id: string; kind: string; title: string; lifecycleState: string; priority: number; scrutiny: string; currentRevision: number; createdAt: number; updatedAt: number };
  }>;
  edges: Array<{ fromIssue: string; toIssue: string; kind: string; active: boolean; childSlot?: number }>;
}
export interface WireIssueDetail extends WireIssue {
  readinessState: string;
  dispatchable: boolean;
  reasons?: string[];
  contract?: unknown;
  claim?: { holder: string; expiresAt: number } | null;
  closure?: { closed: boolean; closedAt: number | null; reason: string | null };
}
interface WireResume {
  children?: Array<{ issueId: string; humanRef: string; title: string; lifecycleState: string }>;
  release?: { childrenDone: number; childrenTotal: number } | null;
}
interface WireTrace {
  attestation?: { outcome: string; policy: string; attestedBy: string; createdAt: number } | null;
  claims?: unknown[];
  bindings?: unknown[];
  receipts?: unknown[];
  commits?: Array<{ sha?: string } | string>;
  prs?: Array<{ ref?: string; number?: number; url?: string } | string>;
}
interface WireJournalEntry {
  id: string;
  sequence: number;
  kind: string;
  issueRevision: number;
  createdAt: number;
  semantic?: { summary?: string } | null;
  mechanical?: unknown;
}

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

/** Join list (human refs) + export (priority, dates, edges) + ready set into Jira-style rows. No per-issue reads. */
export function mapBoard(list: WireIssue[], exported: WireExport | null, ready: WireIssue[]): IssueSummary[] {
  const refById = new Map(list.map((i) => [i.id, i.humanRef]));
  const lifecycleById = new Map(list.map((i) => [i.id, i.lifecycleState]));
  const meta = new Map(exported?.issues.map((r) => [r.issue.id, r.issue]));
  const readyIds = new Set(ready.filter((r) => r.dispatchable !== false).map((r) => r.id));
  const parentOf = new Map<string, string>();
  const children = new Map<string, string[]>();
  const blockers = new Map<string, string[]>();
  for (const e of exported?.edges ?? []) {
    if (!e.active) continue;
    if (e.kind === "parent_child") {
      parentOf.set(e.toIssue, e.fromIssue);
      children.set(e.fromIssue, [...(children.get(e.fromIssue) ?? []), e.toIssue]);
    } else if (e.kind === "blocks") {
      blockers.set(e.toIssue, [...(blockers.get(e.toIssue) ?? []), e.fromIssue]);
    }
  }
  return list.map((i) => {
    const m = meta.get(i.id);
    const kids = children.get(i.id) ?? [];
    const parent = parentOf.get(i.id);
    return {
      id: i.id,
      ref: i.humanRef,
      title: i.title,
      kind: i.kind,
      lifecycle: i.lifecycleState,
      revision: i.revision,
      priority: m ? m.priority : null,
      scrutiny: m ? m.scrutiny || null : null,
      createdAt: m?.createdAt ?? null,
      updatedAt: m?.updatedAt ?? null,
      parentRef: parent ? (refById.get(parent) ?? null) : null,
      childCount: kids.length,
      childrenDone: kids.filter((k) => TERMINAL.has(lifecycleById.get(k) ?? "")).length,
      blockedBy: (blockers.get(i.id) ?? []).filter((b) => !TERMINAL.has(lifecycleById.get(b) ?? "")).map((b) => refById.get(b) ?? b),
      readiness: readyIds.has(i.id) ? "ready" : "unknown",
    };
  });
}

const link = (row: IssueSummary): IssueLink => ({ id: row.id, ref: row.ref, title: row.title, lifecycle: row.lifecycle, kind: row.kind });

export function mapIssueDetail(
  d: WireIssueDetail,
  ctx: { projectId: string | null; board: IssueSummary[]; resume: WireResume | null; trace: WireTrace | null; journal: WireJournalEntry[] },
): IssueDetail {
  const row = ctx.board.find((r) => r.id === d.id);
  const byRef = new Map(ctx.board.map((r) => [r.ref, r]));
  const parentRow = row?.parentRef ? byRef.get(row.parentRef) : undefined;
  const children: IssueLink[] = ctx.resume?.children?.length
    ? ctx.resume.children.map((c) => ({ id: c.issueId, ref: c.humanRef, title: c.title, lifecycle: c.lifecycleState }))
    : ctx.board.filter((r) => r.parentRef === d.humanRef).map(link);
  const text = (x: unknown) => (typeof x === "string" ? x : x && typeof x === "object" ? String((x as Record<string, unknown>).sha ?? (x as Record<string, unknown>).ref ?? (x as Record<string, unknown>).url ?? (x as Record<string, unknown>).number ?? "") : "");
  const provenance: ProvenanceSummary = {
    attestation: ctx.trace?.attestation ?? null,
    claims: ctx.trace?.claims?.length ?? 0,
    bindings: ctx.trace?.bindings?.length ?? 0,
    receipts: ctx.trace?.receipts?.length ?? 0,
    commits: (ctx.trace?.commits ?? []).map(text).filter(Boolean),
    prs: (ctx.trace?.prs ?? []).map(text).filter(Boolean),
  };
  const journal: JournalEntry[] = ctx.journal.map((j) => ({
    id: j.id,
    sequence: j.sequence,
    kind: j.kind,
    revision: j.issueRevision,
    createdAt: j.createdAt,
    summary: j.semantic?.summary ?? (j.mechanical ? "Mechanical entry" : ""),
  }));
  return {
    id: d.id,
    ref: d.humanRef,
    title: d.title,
    kind: d.kind,
    lifecycle: d.lifecycleState,
    revision: d.revision,
    priority: row?.priority ?? null,
    scrutiny: row?.scrutiny ?? null,
    createdAt: row?.createdAt ?? null,
    updatedAt: row?.updatedAt ?? null,
    parentRef: row?.parentRef ?? null,
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
    closure: d.closure ?? { closed: false, closedAt: null, reason: null },
    parent: parentRow ? link(parentRow) : null,
    children,
    blockers: (row?.blockedBy ?? []).map((ref) => byRef.get(ref)).filter((r): r is IssueSummary => !!r).map(link),
    release: ctx.resume?.release ? { childrenDone: ctx.resume.release.childrenDone, childrenTotal: ctx.resume.release.childrenTotal } : null,
    journal: journal.sort((a, b) => b.sequence - a.sequence),
    provenance,
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
    const q = `?project=${encodeURIComponent(projectId)}`;
    const [list, exported, ready] = await Promise.all([
      read<WireIssue[]>(`/issues${q}`),
      read<WireExport>(`/export${q}`).catch(() => null),
      read<WireIssue[]>(`/ready${q}`),
    ]);
    return mapBoard(list, exported, ready);
  },
  async getIssue(ref, projectId) {
    const r = `?ref=${encodeURIComponent(ref)}`;
    const resolvedProject = projectId ?? (await this.listProjects()).find((p) => p.prefix === projectOf(ref))?.id ?? null;
    const [detail, resume, trace, journal, board] = await Promise.all([
      read<WireIssueDetail>(`/issue${r}`),
      read<WireResume>(`/resume${r}`).catch(() => null),
      read<WireTrace>(`/trace${r}`).catch(() => null),
      read<WireJournalEntry[]>(`/journal${r}&limit=100`).catch(() => []),
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
