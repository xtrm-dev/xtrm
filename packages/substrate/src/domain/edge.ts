// Typed graph relations (PRD §14). Only `blocks` affects readiness; the rest
// preserve causality and navigation.

export const EDGE_KINDS = [
  "parent_child",
  "blocks",
  "relates_to",
  "discovered_from",
  "supersedes",
  "duplicates",
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export interface GraphLink {
  from: string;
  to: string;
}

// Generic cycle probe: adding `from -> to` creates a cycle iff `to` can
// already reach `from` through existing directed links. Callers choose the
// direction convention (child->parent for hierarchy, blocker->blocked).
export function wouldCreateCycle(existing: GraphLink[], from: string, to: string): boolean {
  if (from === to) return true;
  const outgoing = new Map<string, string[]>();
  for (const e of existing) {
    const list = outgoing.get(e.from);
    if (list) list.push(e.to);
    else outgoing.set(e.from, [e.to]);
  }
  const seen = new Set<string>([to]);
  const stack = [to];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (cur === from) return true;
    for (const next of outgoing.get(cur) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}
