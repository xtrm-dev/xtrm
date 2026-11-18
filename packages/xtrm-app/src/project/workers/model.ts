import type { DispatchGraphEdge, DispatchGraphNode, ProjectDispatchGraph } from "../../adapters/substrate/graph.ts";
import type { Worker } from "../../adapters/status-board/types.ts";

/**
 * The Workers tree's view model (console-ui-system §6, XTRM-819).
 *
 * The tree is built from the durable dispatch graph (`sb provenance graph`, XTRM-868):
 * `dispatched_by` gives the parent chain, `works_on` names the issue a worker is on,
 * `delivers` names the PR that issue produced. Board `workers/*` records only *enrich*
 * a vertex (status, runtime, milestone, ctx %, claim expiry) and they are joined on the
 * issue ref — never on a name, because a claim holder and a pane name differ (spec §6 gap 1).
 *
 * A vertex without a `dispatched_by` parent is grouped under "unknown dispatcher". That
 * group is the honest rendering of a binding that predates the dispatcher write path
 * (core #963) or carried no dispatcher; the tree never guesses a parent for it.
 */

/** The board's worker status vocabulary observed so far. Anything else renders neutrally. */
export const KNOWN_WORKER_STATUSES = ["working", "blocked", "waiting", "idle", "done", "archived"] as const;

/** `archived` is the one status the archived control hides; it is a status, not a separate field. */
export const ARCHIVED_STATUS = "archived";

const gaps = new Set<string>();

/**
 * Record a value the app does not model (CONSTRAINTS: unknown values render neutrally *and*
 * are logged as a contract gap). Logged once per value so a dense list cannot flood the console.
 */
export function logContractGap(what: string): void {
  if (gaps.has(what)) return;
  gaps.add(what);
  // eslint-disable-next-line no-console
  console.warn(`[contract gap] ${what}`);
}

/** The known-status test the renderer uses; an unknown status is still shown, just without a tone. */
export function isKnownStatus(status: string | null | undefined): boolean {
  return status !== null && status !== undefined && (KNOWN_WORKER_STATUSES as readonly string[]).includes(status);
}

export type StatusTone = "accent" | "danger" | "muted" | "success" | "neutral";

export function statusTone(status: string | null): StatusTone {
  switch (status) {
    case "working":
      return "accent";
    case "blocked":
      return "danger";
    case "waiting":
      return "muted";
    case "done":
      return "success";
    case "idle":
    case "archived":
      return "neutral";
    default:
      if (status !== null) logContractGap(`worker status "${status}" is not in the known set`);
      return "neutral";
  }
}

/** Claim state for the row's claim column; `soon` is emphasis within 2h (spec §6). */
export type ClaimState = "none" | "ok" | "soon" | "expired";

export const CLAIM_SOON_MS = 2 * 60 * 60 * 1000;

export function claimState(claimUntil: string | null | undefined, now: number): ClaimState {
  if (!claimUntil) return "none";
  const at = Date.parse(claimUntil);
  if (Number.isNaN(at)) return "none";
  if (at <= now) return "expired";
  return at - now <= CLAIM_SOON_MS ? "soon" : "ok";
}

export interface TreeNode {
  /** Vertex id from the graph (`participant:<holder>`, `activation:<id>`, `session:<id>`). */
  id: string;
  kind: "participant" | "activation" | "session";
  /** The name a reader recognises: the participant, else the activation id. */
  name: string;
  roleWord: "lead" | "worker" | "activation" | "session";
  status: string | null;
  /** The issue the vertex works on (first `works_on`), and every issue it touches. */
  issueRef: string | null;
  issueRefs: string[];
  prs: Array<{ number: number; repo: string | null }>;
  ctxPct: number | null;
  claimUntil: string | null;
  runtime: string | null;
  /** The board record this vertex was enriched from, by issue ref; `null` when the graph has no match. */
  board: Worker | null;
  children: TreeNode[];
}

export interface WorkersTreeModel {
  roots: TreeNode[];
  /** Vertices with no `dispatched_by` parent: an unknown dispatcher, never a guessed one. */
  unknown: TreeNode[];
  /** Board records whose issue ref no graph vertex carries: on the board, absent from the graph. */
  orphans: Worker[];
  /** Issue refs the graph covers — the join key the enrichment uses. */
  graphRefs: Set<string>;
  /** Vertices that had no works_on edge, so no board record could enrich them. */
  unenriched: number;
}

const vertexKind = (kind: DispatchGraphNode["kind"]): TreeNode["kind"] | null =>
  kind === "participant" || kind === "activation" || kind === "session" ? kind : null;

function roleFor(node: TreeNode, hasChildren: boolean, dispatched: boolean): TreeNode["roleWord"] {
  // The role word is the node's POSITION, not its launch mechanism: a worker that launched
  // nothing of its own is an activation, and one that did is a worker (spec §6 role words).
  if (hasChildren) return dispatched ? "worker" : "lead";
  if (node.kind === "activation") return "activation";
  if (node.kind === "session") return "session";
  return "worker";
}

export function buildWorkersTree(graph: ProjectDispatchGraph, workers: Worker[]): WorkersTreeModel {
  const nodes = new Map<string, DispatchGraphNode>();
  for (const node of graph.nodes) nodes.set(node.id, node);
  const issueRef = (issueId: string): string | null => nodes.get(`issue:${issueId}`)?.label ?? null;

  // A participant that dispatches someone is the SAME worker its own binding describes:
  // the graph names both the dispatcher identity (`participant:<holder>`) and the execution
  // (`activation:<id>`, participantId `<holder>`). Merging them keeps one row per worker
  // instead of a phantom parent that exists only because it dispatched.
  const activationByParticipant = new Map<string, string>();
  for (const node of graph.nodes) {
    if (node.kind === "activation" && node.participantId && !activationByParticipant.has(node.participantId)) {
      activationByParticipant.set(node.participantId, node.id);
    }
  }
  const resolve = (id: string): string => {
    const holder = id.startsWith("participant:") ? id.slice("participant:".length) : null;
    return (holder ? activationByParticipant.get(holder) : undefined) ?? id;
  };

  const dispatchedBy = new Map<string, string | null>();
  const dispatchers = new Set<string>();
  const worksOn = new Map<string, string[]>();
  const delivers = new Map<string, Array<{ number: number; repo: string | null }>>();

  const addRef = (map: Map<string, string[]>, key: string, ref: string) => {
    const list = map.get(key) ?? [];
    if (!list.includes(ref)) list.push(ref);
    map.set(key, list);
  };

  for (const edge of graph.edges) {
    if (edge.kind === "dispatched_by") {
      dispatchedBy.set(resolve(edge.to), edge.from ? resolve(edge.from) : null);
      if (edge.from) dispatchers.add(resolve(edge.from));
    } else if (edge.kind === "works_on") {
      const ref = edge.issueRef ?? issueRef(edge.issueId);
      if (ref) addRef(worksOn, resolve(edge.from ?? edge.to), ref);
    } else {
      const ref = edge.issueRef ?? issueRef(edge.issueId);
      if (!ref) continue;
      const m = /^(?:([^#]+))?#(\d+)$/.exec(nodes.get(edge.to)?.label ?? "");
      if (!m) continue;
      const list = delivers.get(ref) ?? [];
      if (!list.some((p) => p.number === Number(m[2]) && p.repo === (m[1] ?? null))) list.push({ number: Number(m[2]), repo: m[1] ?? null });
      delivers.set(ref, list);
    }
  }

  // The vertex set: every executor, plus every participant that dispatches someone.
  const vertexIds = new Set<string>([...dispatchedBy.keys(), ...dispatchers]);

  const byIssue = new Map<string, Worker[]>();
  for (const w of workers) {
    if (!w.issue) continue;
    const list = byIssue.get(w.issue) ?? [];
    list.push(w);
    byIssue.set(w.issue, list);
  }

  const graphRefs = new Set<string>();
  for (const refs of worksOn.values()) for (const ref of refs) graphRefs.add(ref);

  const build = (id: string, seen: Set<string>): TreeNode => {
    const node = nodes.get(id);
    const kind = node ? vertexKind(node.kind) : null;
    if (!node || !kind) {
      // A vertex the graph names but the app cannot classify is a contract gap, not a guess.
      logContractGap(`dispatch graph vertex "${id}" has an unknown kind`);
      return {
        id,
        kind: "participant",
        name: id,
        roleWord: "worker",
        status: null,
        issueRef: null,
        issueRefs: [],
        prs: [],
        ctxPct: null,
        claimUntil: null,
        runtime: null,
        board: null,
        children: [],
      };
    }
    const refs = worksOn.get(id) ?? [];
    const primary = refs[0] ?? null;
    const board = primary ? (byIssue.get(primary)?.[0] ?? null) : null;
    const tree: TreeNode = {
      id,
      kind,
      name: node.participantId ?? node.label,
      roleWord: "worker",
      status: board?.status ?? null,
      issueRef: primary,
      issueRefs: refs,
      prs: refs.flatMap((ref) => delivers.get(ref) ?? []),
      ctxPct: typeof board?.ctxPct === "number" ? board.ctxPct : null,
      claimUntil: board?.claimUntil ?? null,
      runtime: board?.runtime ?? null,
      board,
      children: [],
    };
    // A cycle in the binding chain would otherwise recurse forever; the graph is read-only
    // evidence and cannot be repaired here, so the repeat is cut and logged.
    if (seen.has(id)) {
      logContractGap(`dispatch graph cycle at "${id}"`);
      return tree;
    }
    const next = new Set(seen).add(id);
    for (const child of childrenOf(id)) tree.children.push(build(child, next));
    tree.children.sort((a, b) => (a.name === b.name ? a.id.localeCompare(b.id) : a.name.localeCompare(b.name)));
    tree.roleWord = roleFor(tree, tree.children.length > 0, dispatchedBy.get(id) != null);
    return tree;
  };

  const childIndex = new Map<string, string[]>();
  for (const [child, parent] of dispatchedBy) {
    if (!parent) continue;
    const list = childIndex.get(parent) ?? [];
    list.push(child);
    childIndex.set(parent, list);
  }
  const childrenOf = (id: string): string[] => (childIndex.get(id) ?? []).filter((c) => vertexIds.has(c));

  const roots: TreeNode[] = [];
  const unknown: TreeNode[] = [];
  for (const id of [...vertexIds].sort()) {
    const parent = dispatchedBy.get(id);
    if (parent) continue;
    if (dispatchedBy.has(id)) unknown.push(build(id, new Set()));
    else roots.push(build(id, new Set()));
  }
  roots.sort((a, b) => a.name.localeCompare(b.name));
  unknown.sort((a, b) => a.name.localeCompare(b.name));

  const orphans = workers.filter((w) => !w.issue || !graphRefs.has(w.issue));
  const unenriched = [...worksOn.keys()].filter((id) => !nodes.has(id) || !worksOn.get(id)?.some((ref) => byIssue.has(ref))).length;

  return { roots, unknown, orphans, graphRefs, unenriched };
}

export interface FlatGroup {
  status: string | null;
  rows: Worker[];
}

const FLAT_ORDER = ["working", "blocked", "waiting", "idle", "done", ARCHIVED_STATUS];

/**
 * The flat view: every board worker grouped by status, the archived ones behind the
 * control. An unknown status gets its own group at the end and is logged once.
 */
export function buildFlatGroups(workers: Worker[], opts: { includeArchived: boolean }): { groups: FlatGroup[]; archivedCount: number } {
  const all = [...workers].sort((a, b) => a.name.localeCompare(b.name));
  const archivedCount = all.filter((w) => w.status === ARCHIVED_STATUS).length;
  const visible = opts.includeArchived ? all : all.filter((w) => w.status !== ARCHIVED_STATUS);
  const buckets = new Map<string | null, Worker[]>();
  for (const w of visible) {
    const status = w.status ?? null;
    if (status !== null && !isKnownStatus(status)) logContractGap(`worker status "${status}" is not in the known set`);
    const key = status ?? null;
    buckets.set(key, [...(buckets.get(key) ?? []), w]);
  }
  const order = (status: string | null): number => {
    const i = status === null ? FLAT_ORDER.length : FLAT_ORDER.indexOf(status);
    return i === -1 ? FLAT_ORDER.length + 1 : i;
  };
  return {
    groups: [...buckets.entries()]
      .sort((a, b) => order(a[0]) - order(b[0]) || String(a[0]).localeCompare(String(b[0])))
      .map(([status, rows]) => ({ status, rows })),
    archivedCount,
  };
}

/** Edges of one kind, for the row tooltip and the unenriched count. */
export function edgesOf(graph: ProjectDispatchGraph, kind: DispatchGraphEdge["kind"]): DispatchGraphEdge[] {
  return graph.edges.filter((e) => e.kind === kind);
}
