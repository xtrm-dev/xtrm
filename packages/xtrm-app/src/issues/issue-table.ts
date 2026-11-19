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
 * One status per issue, in Substrate's vocabulary. The stored lifecycle wins once settled; otherwise
 * the derived readiness, with `draft` split by what is missing and `ready` by whether dispatch is allowed.
 */
export function issueStatus(i: IssueSummary): { label: string; tone: StatusTone; hint: string } {
  if (TERMINAL.has(i.lifecycle)) return { label: lifecycleLabel(i.lifecycle), tone: "muted", hint: "Closed" };
  if (i.lifecycle === "deferred" || i.readiness === "deferred") return { label: "Deferred", tone: "muted", hint: "Deferred" };
  if (i.blockedBy.length > 0 || i.readiness === "blocked") return { label: "Blocked", tone: "danger", hint: `Blocked by ${i.blockedBy.join(", ") || "an open issue"}` };
  if (i.readiness === "claimed") return { label: "In progress", tone: "active", hint: "Claimed by a worker" };
  if (i.readiness === "ready") {
    return i.dispatchable === false
      ? { label: "Attested", tone: "neutral", hint: "Attested, but the scrutiny policy denies dispatch" }
      : { label: "Ready", tone: "accent", hint: "Attested and dispatchable" };
  }
  if (i.contractComplete === false) return { label: "Draft", tone: "muted", hint: "The work contract is incomplete" };
  if (i.attestation === "rejected") return { label: "Rejected", tone: "danger", hint: "Attestation rejected this revision" };
  if (i.attestation === "stale") return { label: "Stale", tone: "neutral", hint: "Attested on an older revision" };
  if (i.attestation === "none") return { label: "Unattested", tone: "neutral", hint: "The contract is complete but not attested" };
  return { label: "Draft", tone: "muted", hint: "Not ready for dispatch" };
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

/** The list shows the primary locator alone: the flat alias would widen every row for a rare difference. */
export const primaryKey = (i: IssueSummary) => i.locator || i.ref;

/** Both names, for the tooltip and the Inspector, so the list does not lose the alias it stopped showing. */
export const keyNames = (i: IssueSummary) => (primaryKey(i) !== i.ref ? `${primaryKey(i)} / ${i.ref}` : primaryKey(i));

/**
 * Width inside the key cell before and after the key text, in rem: the kind icon (13px), the
 * priority glyph (16px), their two 4px gaps and the cell's trailing inset (4px) = 2.6rem. The
 * disclosure slot is not here: the leading cluster owns it (XTRM-898).
 */
export const KEY_CELL_CHROME_REM = 2.6;

/**
 * Key column width in rem: the longest primary key at the deepest row's indentation. The key cell
 * gives the row its depth width back (see `IssueRow`), so the status chip and the title start at one
 * x for every depth while the chevron sits at the row's own depth.
 *
 * Text is measured at Geist Mono's 0.6em advance and the 0.72rem xs size.
 */
/** The key column never grows past this: the summary is the row's reading content, the key is its address. */
export const KEY_COL_MAX_REM = 15.5;

export function keyColumnRem(rows: IssueSummary[], maxDepth = 0) {
  const longest = rows.reduce((n, i) => Math.max(n, primaryKey(i).length), 8);
  const wanted = Math.ceil(longest * 0.6 * 0.72 * 10) / 10 + INDENT_REM * Math.max(0, maxDepth) + KEY_CELL_CHROME_REM;
  // One deep locator hides elsewhere in the population would otherwise tax every visible row
  // (19.7rem live against an 18-character visible key). The full name stays in the cell tooltip.
  return Math.min(wanted, KEY_COL_MAX_REM);
}

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
