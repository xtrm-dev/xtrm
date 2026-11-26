import type { IssueSummary } from "../adapters/index.tsx";
import { TERMINAL, lifecycleLabel } from "./meta.tsx";

export type SortKey = "key" | "title" | "priority" | "children" | "events" | "pointers" | "pr" | "created" | "updated";
export type Sort = { key: SortKey; desc: boolean };

/** Direction a column sorts in on its first click. */
export const defaultDesc = (key: SortKey) => !["key", "title", "priority"].includes(key);

export function refOrder(a: string, b: string) {
  const na = a.split(/[-.]/).slice(1).map(Number);
  const nb = b.split(/[-.]/).slice(1).map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? -1) - (nb[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

export type StatusTone = "accent" | "active" | "danger" | "neutral" | "muted";

/**
 * The status vocabulary `sb issue list --status` accepts (XTRM: the console must not invent its own).
 * Only the terminal lifecycle states are stored; `in_progress`, `ready`, `blocked` and `open` are derived
 * views over readiness and claim, exactly as `packages/substrate/src/presentation/terminal.ts` derives them.
 */
export type IssueStatusId = "open" | "in_progress" | "ready" | "blocked" | "deferred" | "done" | "cancelled" | "archived";

/** Filter-only aggregate: every settled lifecycle state, which is what `--status closed|terminal` means. */
export type IssueStatusFilter = IssueStatusId | "closed";

export const ISSUE_STATUSES: ReadonlyArray<{ id: IssueStatusId; label: string }> = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "ready", label: "Ready" },
  { id: "blocked", label: "Blocked" },
  { id: "deferred", label: "Deferred" },
  { id: "done", label: "Done" },
  { id: "cancelled", label: "Cancelled" },
  { id: "archived", label: "Archived" },
];

/** Every status filter, including the `closed` aggregate, in the order Substrate lists them. */
export const ISSUE_STATUS_FILTERS: ReadonlyArray<{ value: IssueStatusFilter; label: string }> = [
  ...ISSUE_STATUSES.map((s) => ({ value: s.id as IssueStatusFilter, label: s.label })),
  { value: "closed", label: "Closed" },
];

/**
 * The derived status, in Substrate's order: a settled lifecycle wins, then deferred, then a live claim
 * (`in_progress`), then a blocker, then dispatchability. Anything else is still `open`.
 */
export function issueStatusId(i: IssueSummary): IssueStatusId {
  if (TERMINAL.has(i.lifecycle)) return i.lifecycle as IssueStatusId;
  if (i.lifecycle === "deferred" || i.readiness === "deferred") return "deferred";
  if (i.readiness === "claimed") return "in_progress";
  if (i.blockedBy.length > 0 || i.readiness === "blocked") return "blocked";
  if (i.dispatchable === true || i.readiness === "ready") return "ready";
  return "open";
}

/**
 * `sb issue list --status` semantics. `open` is the stored lifecycle (so a claimed or ready issue is
 * still open), `closed`/`terminal` is every settled state, and anything else matches the derived status,
 * the lifecycle or the readiness.
 */
export function matchesIssueStatus(i: IssueSummary, requested: string | null): boolean {
  if (requested === null || requested === "" || requested === "all") return true;
  const wanted = requested.trim().toLowerCase();
  if (wanted === "closed" || wanted === "terminal") return TERMINAL.has(i.lifecycle);
  if (wanted === "open") return i.lifecycle === "open";
  return issueStatusId(i) === wanted || i.lifecycle === wanted || i.readiness === wanted;
}

/**
 * The multi-select form of the status filter (§2026-11-26 ruling). The set holds the eight disjoint
 * `IssueStatusId` values only, and a row matches when its derived status is in the set. Overlapping
 * members are refused by construction: `closed` is not a set member because it aggregates three
 * others, so unchecking one item can never leave that item's rows visible. An empty set matches
 * nothing — "everything" is only ever the full set.
 */
export function matchesIssueStatusSet(i: IssueSummary, statuses: ReadonlySet<string>): boolean {
  return statuses.has(issueStatusId(i));
}

/**
 * The badge for one row. The derived status supplies the tone; an open issue is refined by what it
 * lacks (a complete contract, an attestation against the current revision) so the board says why.
 */
export function issueStatus(i: IssueSummary): { label: string; tone: StatusTone; hint: string } {
  const status = issueStatusId(i);
  if (status === "done" || status === "cancelled" || status === "archived") {
    return { label: lifecycleLabel(i.lifecycle), tone: "muted", hint: "Closed" };
  }
  if (status === "deferred") return { label: "Deferred", tone: "muted", hint: "Deferred" };
  if (status === "in_progress") return { label: "In progress", tone: "active", hint: "Claimed by a worker" };
  if (status === "blocked") return { label: "Blocked", tone: "danger", hint: `Blocked by ${i.blockedBy.join(", ") || "an open issue"}` };
  if (status === "ready") {
    return i.dispatchable === false
      ? { label: "Attested", tone: "neutral", hint: "Attested, but the scrutiny policy denies dispatch" }
      : { label: "Ready", tone: "accent", hint: "Attested and dispatchable" };
  }
  if (i.contractComplete === false) return { label: "Draft", tone: "muted", hint: "The work contract is incomplete" };
  if (i.attestation === "rejected") return { label: "Rejected", tone: "danger", hint: "Attestation rejected this revision" };
  if (i.attestation === "stale") return { label: "Stale", tone: "neutral", hint: "Attested on an older revision" };
  if (i.attestation === "none") return { label: "Unattested", tone: "neutral", hint: "The contract is complete but not attested" };
  return { label: "Open", tone: "neutral", hint: "Open, not ready for dispatch" };
}

export interface Rollup {
  /** Latest activity on the issue or anything under it. */
  activityAt: number | null;
  /** Journal entries on the issue and everything under it. */
  events: number;
  pointers: number;
}

/** Rolls activity up to parents, across every issue so a child hidden by the current view still counts. */
export function rollupActivity(all: IssueSummary[]): Map<string, Rollup> {
  const kids = new Map<string, IssueSummary[]>();
  for (const i of all) if (i.parentRef) kids.set(i.parentRef, [...(kids.get(i.parentRef) ?? []), i]);
  const memo = new Map<string, Rollup>();
  const walk = (i: IssueSummary, path: Set<string>): Rollup => {
    const done = memo.get(i.ref);
    if (done) return done;
    const r: Rollup = { activityAt: i.lastActivityAt ?? i.updatedAt, events: i.eventCount, pointers: i.pointerCount };
    path.add(i.ref);
    for (const k of kids.get(i.ref) ?? []) {
      if (path.has(k.ref)) continue;
      const c = walk(k, path);
      r.activityAt = Math.max(r.activityAt ?? 0, c.activityAt ?? 0) || null;
      r.events += c.events;
      r.pointers += c.pointers;
    }
    path.delete(i.ref);
    memo.set(i.ref, r);
    return r;
  };
  for (const i of all) walk(i, new Set());
  return memo;
}

export interface TreeRow {
  issue: IssueSummary;
  depth: number;
  rollup: Rollup;
  hasChildren: boolean;
  collapsed: boolean;
  /** Its parent exists but is not in this view, so the row sits at the root. */
  detached: boolean;
}

function comparator({ key, desc }: Sort, rollups: Map<string, Rollup>) {
  const roll = (i: IssueSummary) => rollups.get(i.ref)!;
  const value: Record<SortKey, (i: IssueSummary) => number | string | null> = {
    key: () => null,
    title: (i) => i.title.toLowerCase(),
    priority: (i) => i.priority,
    children: (i) => i.childCount,
    events: (i) => roll(i).events,
    pointers: (i) => roll(i).pointers,
    pr: (i) => i.primaryPr?.number ?? null,
    created: (i) => i.createdAt,
    updated: (i) => roll(i).activityAt,
  };
  const pick = value[key];
  const dir = desc ? -1 : 1;
  return (a: IssueSummary, b: IssueSummary) => {
    if (key === "key") return dir * refOrder(a.locator, b.locator);
    const x = pick(a);
    const y = pick(b);
    // Missing values stay last in both directions; the key breaks every tie.
    if (x === null || y === null) return x === y ? refOrder(a.locator, b.locator) : x === null ? 1 : -1;
    const d = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
    return dir * d || refOrder(a.locator, b.locator);
  };
}

/** Sorts each level on its own and nests children under their parent. */
export function buildTree(rows: IssueSummary[], rollups: Map<string, Rollup>, sort: Sort, collapsed: ReadonlySet<string>): TreeRow[] {
  const inView = new Set(rows.map((i) => i.ref));
  const kids = new Map<string, IssueSummary[]>();
  const roots: IssueSummary[] = [];
  for (const i of rows) {
    if (i.parentRef && inView.has(i.parentRef) && i.parentRef !== i.ref) kids.set(i.parentRef, [...(kids.get(i.parentRef) ?? []), i]);
    else roots.push(i);
  }
  const cmp = comparator(sort, rollups);
  const out: TreeRow[] = [];
  const emit = (i: IssueSummary, depth: number) => {
    const children = kids.get(i.ref) ?? [];
    const closed = collapsed.has(i.ref);
    out.push({ issue: i, depth, rollup: rollups.get(i.ref)!, hasChildren: children.length > 0, collapsed: closed, detached: depth === 0 && !!i.parentRef });
    if (!closed) for (const c of [...children].sort(cmp)) emit(c, depth + 1);
  };
  for (const r of roots.sort(cmp)) emit(r, 0);
  return out;
}

/** One level of tree indentation, in rem; the row's leading cluster carries it (XTRM-898). */
export const INDENT_REM = 1.25;

/** The issue's address as the list renders it: the hierarchical locator when Substrate has one. */
export const primaryKey = (i: IssueSummary) => i.locator || i.ref;

/** Both names, for the key cell's tooltip: a narrow list truncates the inline key, not its address. */
export const keyNames = (i: IssueSummary) => (primaryKey(i) !== i.ref ? `${primaryKey(i)} / ${i.ref}` : primaryKey(i));

/**
 * How many numeric columns the list can afford at its measured width. The summary always wins the
 * width argument: below `wide` the two rollups go, below `medium` the two timestamps follow, and the
 * shipped `minWidth` keeps the rest scrolling sideways instead of squeezing the title to nothing.
 */
export type ListDensity = "wide" | "medium" | "compact";

export const listDensity = (width: number): ListDensity => (width >= 62 * 16 ? "wide" : width >= 48 * 16 ? "medium" : "compact");

const DROPPED: Record<ListDensity, ReadonlySet<SortKey>> = {
  wide: new Set(),
  medium: new Set<SortKey>(["events", "pointers"]),
  compact: new Set<SortKey>(["events", "pointers", "created", "updated"]),
};

/** The column keys the list hides at this width, so header and rows stay in step. */
export const hiddenColumns = (density: ListDensity) => DROPPED[density];
