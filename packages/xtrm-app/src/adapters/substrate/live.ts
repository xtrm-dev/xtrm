import type { IssueDetail, IssueSummary, Readiness, SubstrateAdapter, SubstrateProject } from "../types.ts";

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
interface WireIssue {
  id: string;
  humanRef: string;
  title: string;
  kind: string;
  lifecycleState: string;
  revision: number;
  readinessState?: string;
  dispatchable?: boolean;
}
interface WireIssueDetail extends WireIssue {
  readinessState: string;
  dispatchable: boolean;
  reasons?: string[];
  contract?: {
    problem?: string;
    success?: string;
    scope?: string[];
    nonGoals?: string[];
    constraints?: string[];
    validation?: Array<{ check?: string }>;
    output?: Array<{ artifact?: string }>;
  };
  claim?: { holder: string; expiresAt: number } | null;
  closure?: { closed: boolean; closedAt: number | null; reason: string | null };
  provenance?: { eventCount: number; lastEventType: string | null; lastEventAt: number | null };
}

export class SubstrateReadError extends Error {}

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

export function mapIssues(all: WireIssue[], ready: WireIssue[]): IssueSummary[] {
  const readyIds = new Set(ready.filter((r) => r.dispatchable !== false).map((r) => r.id));
  return all.map((i) => ({
    id: i.id,
    ref: i.humanRef,
    title: i.title,
    kind: i.kind,
    lifecycle: i.lifecycleState,
    revision: i.revision,
    readiness: readyIds.has(i.id) ? "ready" : "unknown",
  }));
}

export function mapIssueDetail(d: WireIssueDetail): IssueDetail {
  const c = d.contract ?? {};
  const readiness: Readiness = d.dispatchable ? "ready" : "not_ready";
  return {
    id: d.id,
    ref: d.humanRef,
    title: d.title,
    kind: d.kind,
    lifecycle: d.lifecycleState,
    revision: d.revision,
    readiness,
    readinessState: d.readinessState,
    dispatchable: d.dispatchable,
    reasons: d.reasons ?? [],
    contract: {
      problem: c.problem ?? "",
      success: c.success ?? "",
      scope: c.scope ?? [],
      nonGoals: c.nonGoals ?? [],
      constraints: c.constraints ?? [],
      validation: (c.validation ?? []).map((v) => v.check ?? "").filter(Boolean),
      output: (c.output ?? []).map((o) => o.artifact ?? "").filter(Boolean),
    },
    claim: d.claim ? { holder: d.claim.holder, expiresAt: d.claim.expiresAt } : null,
    closure: d.closure ?? { closed: false, closedAt: null, reason: null },
    provenance: d.provenance ?? { eventCount: 0, lastEventType: null, lastEventAt: null },
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

export const liveSubstrate: SubstrateAdapter = {
  source: "live",
  async listProjects() {
    const [projects, links] = await Promise.all([read<WireProject[]>("/projects"), read<WireLinks>("/links")]);
    return mapProjects(projects, links);
  },
  async listIssues(projectId) {
    const q = `?project=${encodeURIComponent(projectId)}`;
    const [all, ready] = await Promise.all([read<WireIssue[]>(`/issues${q}`), read<WireIssue[]>(`/ready${q}`)]);
    return mapIssues(all, ready);
  },
  async getIssue(ref) {
    return mapIssueDetail(await read<WireIssueDetail>(`/issue?ref=${encodeURIComponent(ref)}`));
  },
};
