import type { IssueSummary } from "../adapters/index.tsx";
import type { Tone } from "../ui/primitives.tsx";
import { TERMINAL, lifecycleLabel, lifecycleTone } from "./meta.tsx";

export type SortKey = "key" | "title" | "status" | "priority" | "children" | "events" | "pointers" | "created" | "updated";
export type Sort = { key: SortKey; desc: boolean };

/** Direction a column sorts in on its first click. */
export const defaultDesc = (key: SortKey) => !["key", "title", "status", "priority"].includes(key);

export function refOrder(a: string, b: string) {
  const na = a.split(/[-.]/).slice(1).map(Number);
  const nb = b.split(/[-.]/).slice(1).map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] ?? -1) - (nb[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

const STATUS_ORDER = ["Ready", "Claimed", "Open", "Draft", "Blocked", "Deferred", "Done", "Cancelled", "Archived"];

/** One status per issue: the stored lifecycle once it is settled, otherwise the derived readiness. */
export function issueStatus(i: IssueSummary): { label: string; tone: Tone; rank: number } {
  const settled = TERMINAL.has(i.lifecycle) || i.lifecycle === "deferred";
  const blocked = i.blockedBy.length > 0 || i.readiness === "blocked";
  const [label, tone]: [string, Tone] = settled
    ? [lifecycleLabel(i.lifecycle), lifecycleTone(i.lifecycle)]
    : blocked
      ? ["Blocked", "danger"]
      : i.readiness === "ready"
        ? ["Ready", "accent"]
        : i.readiness === "claimed"
          ? ["Claimed", "active"]
          : i.readiness === "draft"
            ? ["Draft", "muted"]
            : ["Open", "neutral"];
  const rank = STATUS_ORDER.indexOf(label);
  return { label, tone, rank: rank < 0 ? STATUS_ORDER.length : rank };
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
    status: (i) => issueStatus(i).rank,
    priority: (i) => i.priority,
    children: (i) => i.childCount,
    events: (i) => roll(i).events,
    pointers: (i) => roll(i).pointers,
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

const keyText = (i: IssueSummary) => (i.locator && i.locator !== i.ref ? `${i.locator} / ${i.ref}` : i.ref);

/** Key column width in rem: fits the longest key in view, at Geist Mono's 0.6em advance and the 0.72rem xs size. */
export function keyColumnRem(rows: IssueSummary[]) {
  const longest = rows.reduce((n, i) => Math.max(n, keyText(i).length), 8);
  return Math.ceil(longest * 0.6 * 0.72 * 10) / 10 + 1.5;
}
