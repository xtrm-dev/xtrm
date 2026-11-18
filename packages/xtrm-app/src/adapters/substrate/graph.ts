/**
 * The project dispatch graph (XTRM-868 `sb provenance graph`, consumed here by
 * the Workers tree, XTRM-819).
 *
 * The durable edge is the execution binding: a launch records which participant
 * and session dispatched which worker or activation, on which issue, and which
 * PR the issue delivered. Substrate returns it as a node/edge list; this module
 * maps the wire shape to a view model and never invents a vertex — an unknown
 * dispatcher stays `null`, and the UI groups those nodes separately.
 */
import type { DataSource } from "../types.ts";

export type DispatchGraphNodeKind = "participant" | "activation" | "session" | "issue" | "pull_request";
export type DispatchGraphEdgeKind = "works_on" | "dispatched_by" | "delivers";

/** One vertex. `id` is the wire id (`participant:<holder>`, `issue:<uuid>`, …). */
export interface DispatchGraphNode {
  id: string;
  kind: DispatchGraphNodeKind;
  label: string;
  /** Set for participant/activation nodes; `null` when the binding had no participant. */
  participantId: string | null;
}

/**
 * One edge. `from` is `null` when the binding predates the dispatcher write
 * path (before core #963) or carried no dispatcher: the UI renders those nodes
 * under "unknown dispatcher" rather than guessing a parent.
 */
export interface DispatchGraphEdge {
  kind: DispatchGraphEdgeKind;
  from: string | null;
  to: string;
  /** The Substrate issue id the edge belongs to. */
  issueId: string;
  /** Human ref of that issue (`XTRM-853`), resolved from the issue node. */
  issueRef: string | null;
  /** Epoch milliseconds of the binding (or of the PR link for `delivers`). */
  at: number;
  bindingId: string | null;
  dispatcherSessionId: string | null;
}

export interface ProjectDispatchGraph {
  projectId: string;
  since: number | null;
  limit: number;
  nodes: DispatchGraphNode[];
  edges: DispatchGraphEdge[];
  matchedBindings: number;
  omittedBindings: number;
  truncated: boolean;
}

/** Wire shape of the CLI's `provenance.graph` data, leniently parsed. */
interface WireGraph {
  projectId?: unknown;
  since?: unknown;
  limit?: unknown;
  nodes?: unknown;
  edges?: unknown;
  matchedBindings?: unknown;
  omittedBindings?: unknown;
  truncated?: unknown;
}

const NODE_KINDS = new Set<DispatchGraphNodeKind>(["participant", "activation", "session", "issue", "pull_request"]);
const EDGE_KINDS = new Set<DispatchGraphEdgeKind>(["works_on", "dispatched_by", "delivers"]);

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function parseDispatchGraph(wire: unknown): ProjectDispatchGraph {
  const raw = obj(wire) ?? {};
  const nodes: DispatchGraphNode[] = [];
  for (const item of Array.isArray(raw.nodes) ? raw.nodes : []) {
    const n = obj(item);
    const id = str(n?.id);
    const kind = str(n?.kind);
    if (!n || !id || !kind || !NODE_KINDS.has(kind as DispatchGraphNodeKind)) continue;
    nodes.push({ id, kind: kind as DispatchGraphNodeKind, label: str(n.label) ?? id, participantId: str(n.participantId) });
  }
  const refByIssue = new Map<string, string>();
  for (const node of nodes) if (node.kind === "issue") refByIssue.set(node.id, node.label);

  const edges: DispatchGraphEdge[] = [];
  for (const item of Array.isArray(raw.edges) ? raw.edges : []) {
    const e = obj(item);
    const kind = str(e?.kind);
    const to = str(e?.to);
    const issueId = str(e?.issueId);
    if (!e || !kind || !EDGE_KINDS.has(kind as DispatchGraphEdgeKind) || !to || !issueId) continue;
    edges.push({
      kind: kind as DispatchGraphEdgeKind,
      from: str(e.from),
      to,
      issueId,
      issueRef: refByIssue.get(`issue:${issueId}`) ?? null,
      at: num(e.at) ?? 0,
      bindingId: str(e.bindingId),
      dispatcherSessionId: str(e.dispatcherSessionId),
    });
  }

  return {
    projectId: str(raw.projectId) ?? "",
    since: num(raw.since),
    limit: num(raw.limit) ?? 200,
    nodes,
    edges,
    matchedBindings: num(raw.matchedBindings) ?? 0,
    omittedBindings: num(raw.omittedBindings) ?? 0,
    truncated: raw.truncated === true,
  };
}

/** The empty graph an unbound or empty project answers with. */
export function emptyDispatchGraph(projectId: string, source: DataSource = "fixture"): ProjectDispatchGraph & { source: DataSource } {
  return { projectId, since: null, limit: 200, nodes: [], edges: [], matchedBindings: 0, omittedBindings: 0, truncated: false, source };
}
