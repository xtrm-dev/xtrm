// `/research/compare` search params: `?baseline=<runId>&candidate=<runId>&candidate=<runId>...`.
// A dedicated validator, not folded into `validateDrawerSearch` (shell/layout.ts) — that one is
// generic across every route; this one is specific to the comparison surface's own two keys.

export interface CompareSearch {
  baseline?: string;
  candidate?: string[];
}

const asString = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const asStringArray = (v: unknown): string[] | undefined => {
  if (typeof v === "string") return v.length > 0 ? [v] : undefined;
  if (Array.isArray(v)) {
    const strs = v.filter((x): x is string => typeof x === "string" && x.length > 0);
    return strs.length > 0 ? strs : undefined;
  }
  return undefined;
};

export function validateCompareSearch(search: Record<string, unknown>): CompareSearch {
  const baseline = asString(search.baseline);
  const candidate = asStringArray(search.candidate);
  return { ...(baseline ? { baseline } : {}), ...(candidate ? { candidate } : {}) };
}

/** Every run id in the comparison, baseline first — the shape `compare()` wants. */
export function compareRunIds(search: CompareSearch): string[] {
  return search.baseline ? [search.baseline, ...(search.candidate ?? [])] : [];
}
