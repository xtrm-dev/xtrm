// The merge layer (XTRM-757 gaps 2-6): ordering, row identity, counts, source
// filtering and the empty/error states. Pure functions only, so the surface
// renders exactly what a test can assert.

import type { ActivityRow, ActivitySource, ActivitySourceState } from "./types.ts";

/** Newest first, then by id so two rows with the same timestamp never swap. */
export function sortActivity(rows: readonly ActivityRow[]): ActivityRow[] {
  return [...rows].sort((a, b) => (b.at - a.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Concatenate the per-source pages. Rows are deduped by id: a page re-read
 * after a refresh cannot double a row, and no source can shadow another.
 */
export function mergeActivity(pages: readonly ActivityRow[][]): ActivityRow[] {
  const seen = new Map<string, ActivityRow>();
  for (const page of pages) for (const row of page) if (!seen.has(row.id)) seen.set(row.id, row);
  return sortActivity([...seen.values()]);
}

export interface ActivityCounts {
  /** Total across every source, including the ones not yet loaded. */
  all: number;
  bySource: Record<ActivitySource, number>;
}

/**
 * Per-source counts for the filter row. A source with no rows counts 0 — which
 * is a fact ("nothing happened"), not an absence of data; a source whose read
 * FAILED is excluded from the count and reported through its own error state,
 * so a failure never reads as "zero activity".
 */
export function activityCounts(states: readonly ActivitySourceState[]): ActivityCounts {
  const bySource = { substrate: 0, github: 0, jira: 0 } as Record<ActivitySource, number>;
  let all = 0;
  for (const state of states) {
    if (state.error !== null) continue;
    bySource[state.source] += state.rows.length;
    all += state.rows.length;
  }
  return { all, bySource };
}

/** Filter by source; `null` means every source. */
export function filterActivity(rows: readonly ActivityRow[], source: ActivitySource | null): ActivityRow[] {
  return source === null ? [...rows] : rows.filter((row) => row.source === source);
}

/** The sources the filter row offers: every live source, plus any that produced rows. */
export function filterSources(states: readonly ActivitySourceState[]): ActivitySource[] {
  const out: ActivitySource[] = [];
  for (const state of states) if (!out.includes(state.source)) out.push(state.source);
  return out;
}
