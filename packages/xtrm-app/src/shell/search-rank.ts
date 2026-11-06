/** Issue key typed on its own: `MMD-3752`, `xtrm-690`, `XTRM-424.5.1`. */
const ISSUE_KEY = /^[a-z][a-z0-9]*-\d+(?:\.\d+)*$/i;

export function issueKeyFromQuery(query: string): string | null {
  const q = query.trim();
  return ISSUE_KEY.test(q) ? q.toUpperCase() : null;
}

export interface Searchable {
  label: string;
  /** Identifiers such as issue keys: an exact match ranks first, a prefix match second. */
  keys?: string[];
}

/**
 * Filter, rank and cap in one pass. Every query token must appear in the label or a key.
 * Ranking: exact key, key prefix, label prefix, any match; ties keep source order.
 * Capping happens after filtering, so a large board never hides a match.
 */
export function rankSearch<T extends Searchable>(items: readonly T[], query: string, limit: number): T[] {
  const q = query.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length) return items.slice(0, limit);
  const scored: { item: T; score: number; i: number }[] = [];
  items.forEach((item, i) => {
    const keys = (item.keys ?? []).map((k) => k.toLowerCase());
    const label = item.label.toLowerCase();
    const haystack = `${label} ${keys.join(" ")}`;
    if (!tokens.every((t) => haystack.includes(t))) return;
    const score = keys.includes(q) ? 3 : keys.some((k) => k.startsWith(q)) ? 2 : label.startsWith(q) ? 1 : 0;
    scored.push({ item, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.item);
}
