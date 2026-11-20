import { useQuery } from "@tanstack/react-query";
import { useAdapters } from "../../adapters/index.tsx";
import type { TreeNode, WorkersTreeModel } from "./model.ts";

/**
 * How many missing titles one page load reads. The cap keeps the read bounded when the board window is
 * short and the graph is not; a live graph's nameless vertices share few issue refs, so the real number
 * stays well below it.
 */
export const TITLE_READ_LIMIT = 50;

/**
 * How many title reads are in flight at once. Each read is a detail read on the bridge, so they go out
 * in small batches instead of one burst the size of the cap.
 */
const TITLE_READ_BATCH = 8;

const NONE: ReadonlyMap<string, string> = new Map();

/**
 * The issue refs a rendered row needs a title for but the board index does not carry.
 *
 * A vertex the graph names only by a session id borrows its issue's title (XTRM-912). The title came
 * from the console's board read, and on live data that read covered far fewer issues than the graph
 * names, so most nameless rows showed a key and nothing else (XTRM-918). Only rows that will print a
 * title are asked for — the unnamed vertices with an issue — deduplicated and capped. Board-only
 * workers are not asked for: the board already named them.
 */
export function missingTitleRefs(model: WorkersTreeModel | null, index: ReadonlyMap<string, unknown>, limit = TITLE_READ_LIMIT): string[] {
  if (!model) return [];
  const refs = new Set<string>();
  const walk = (node: TreeNode) => {
    if (node.unnamed && node.issueRef !== null && !index.has(node.issueRef)) refs.add(node.issueRef);
    node.children.forEach(walk);
  };
  // The unknown-dispatcher group is collapsed by default, but the operator opens it, and its rows are
  // the ones most often nameless: they are part of the same bounded read.
  for (const tree of [model.roots, model.cycles, model.unknown]) for (const node of tree) walk(node);
  return [...refs].slice(0, limit);
}

/**
 * The titles the board index could not supply, read by issue ref. A failed read leaves the map short:
 * the row then shows its key, exactly as it did before, and the tree still renders.
 */
export function useIssueTitles(refs: ReadonlyArray<string>, projectId: string | null): ReadonlyMap<string, string> {
  const { substrate } = useAdapters();
  const titles = useQuery({
    queryKey: ["substrate", "issue-titles", projectId, refs],
    enabled: projectId !== null && refs.length > 0,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const found = new Map<string, string>();
      for (let i = 0; i < refs.length; i += TITLE_READ_BATCH) {
        const batch = refs.slice(i, i + TITLE_READ_BATCH);
        const titles = await Promise.all(batch.map(async (ref) => (await substrate.getIssue(ref, projectId!, { withBoard: false })).title));
        batch.forEach((ref, index) => found.set(ref, titles[index]!));
      }
      return found;
    },
  });
  return titles.data ?? NONE;
}
