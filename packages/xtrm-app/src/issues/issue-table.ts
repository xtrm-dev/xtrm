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

/** The issue's address as the list renders it: the hierarchical locator when Substrate has one. */
export const primaryKey = (i: IssueSummary) => i.locator || i.ref;

/** Both names, for the key cell's tooltip: a narrow list truncates the inline key, not its address. */
export const keyNames = (i: IssueSummary) => (primaryKey(i) !== i.ref ? `${primaryKey(i)} / ${i.ref}` : primaryKey(i));

/**
 * The width the reading line keeps before the list gives up a numeric column: a deep leading cluster,
 * the address whole, a status chip and a readable title (XTRM-918). The numeric columns are the
 * summary's guests, so they go before it does.
 */
export const READING_MIN_PX = 28 * 16;

/** The numeric columns in the order the list gives them up, lowest value first. */
const DROP_ORDER: ReadonlyArray<SortKey> = ["events", "pointers", "created", "updated", "pr", "children"];

/**
 * The columns a list of this width shows. The reading line wins the width argument (XTRM-911, XTRM-926):
 * the list gives up numeric columns, lowest value first, until the reading line keeps its minimum, so a
 * narrow list never squeezes the address and its chip out of the row. Header and rows read one set.
 */
export function visibleColumns<T extends { key: SortKey; width: string }>(columns: ReadonlyArray<T>, width: number): T[] {
  const px = (w: string) => (/^[\d.]+rem$/.test(w) ? Number.parseFloat(w) * 16 : Number.NaN);
  const numeric = columns.filter((c) => Number.isFinite(px(c.width)));
  const dropped = new Set<SortKey>();
  const kept = () => numeric.filter((c) => !dropped.has(c.key)).reduce((sum, c) => sum + px(c.width), 0);
  for (const key of DROP_ORDER) {
    if (width - kept() >= READING_MIN_PX) break;
    dropped.add(key);
  }
  return columns.filter((c) => !dropped.has(c.key));
}
