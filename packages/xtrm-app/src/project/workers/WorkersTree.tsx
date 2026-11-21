import { useState } from "react";
import type { Worker } from "../../adapters/status-board/types.ts";
import { Icon } from "../../ui/icon.tsx";
import { EmptyState, cx } from "../../ui/primitives.tsx";
import { BoardWorkerRow, CHEVRON, WorkerRow } from "./WorkerRow.tsx";
import type { TreeNode, WorkersTreeModel } from "./model.ts";

/**
 * The Workers tree (console-ui-system §6): lead → worker → activation, each row carrying
 * its issue and PR as a trail, never as extra tree levels.
 *
 * The parent chain is the durable `dispatched_by` edge. A worker whose binding carries no
 * dispatcher is not attached to a guessed parent: it is listed under "unknown dispatcher",
 * together with the board workers that the graph does not mention at all. On live data that
 * group holds hundreds of vertices, most of them raw session ids, so the group starts
 * collapsed with its count and renders nothing until the operator opens it (XTRM-912).
 */
export function WorkersTree({
  model,
  now,
  titleOf,
}: {
  model: WorkersTreeModel;
  now: number;
  /** The issue title for a vertex the graph names only by machine id; absent outside a shell. */
  titleOf?: (ref: string) => string | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allIds(model.roots)));
  const [unknownOpen, setUnknownOpen] = useState(false);
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const total = model.roots.length + model.unknown.length + model.cycles.length + model.orphans.length;
  if (total === 0) {
    return <EmptyState icon="specialists" title="No workers">Neither the dispatch graph nor the board reports a worker for this repository.</EmptyState>;
  }
  const unknownCount = model.unknown.length + model.orphans.length;

  return (
    <div className="min-w-0" data-testid="workers-tree">
      {model.roots.map((node) => (
        <WorkerRow key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggle} now={now} titleOf={titleOf} />
      ))}

      {model.cycles.length > 0 && (
        <section aria-label="Dispatch cycle" className="mt-3 border-t border-border-muted pt-2" data-testid="workers-cycles">
          <h3 className="px-1.5 text-xs font-medium text-ink-muted">dispatch cycle</h3>
          <p className="px-1.5 pb-1 text-xs text-ink-faint">
            These workers dispatch each other in a cycle, so no worker sits above them. The tree does not guess a parent.
          </p>
          {model.cycles.map((node) => (
            <WorkerRow key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggle} now={now} titleOf={titleOf} />
          ))}
        </section>
      )}

      {unknownCount > 0 && (
        <section aria-label="Unknown dispatcher" className="mt-3 border-t border-border-muted pt-2" data-testid="workers-unknown">
          <h3>
            <button
              type="button"
              aria-expanded={unknownOpen}
              onClick={() => setUnknownOpen((prev) => !prev)}
              data-testid="workers-unknown-toggle"
              className="flex w-full items-center gap-1 rounded-sm px-1.5 py-1 text-left text-xs font-medium text-ink-muted outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-1 focus-visible:ring-accent/40"
            >
              <span className="flex size-5 shrink-0 items-center justify-center text-ink-faint" aria-hidden>
                <Icon name="chevronDown" size="text" className={cx(CHEVRON, !unknownOpen && "-rotate-90")} />
              </span>
              unknown dispatcher ({unknownCount})
            </button>
          </h3>
          {unknownOpen && (
            <>
              <p className="px-1.5 pb-1 text-xs text-ink-faint">
                Workers whose launch did not record who dispatched them, and board workers the graph does not mention. The tree does not guess a parent.
              </p>
              {model.unknown.map((node) => (
                <WorkerRow key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggle} now={now} titleOf={titleOf} />
              ))}
              {model.orphans.map((worker) => (
                <BoardWorkerRow key={worker.name} worker={worker} now={now} testid="worker-orphan" />
              ))}
            </>
          )}
        </section>
      )}
    </div>
  );
}

function allIds(...trees: TreeNode[][]): string[] {
  const ids: string[] = [];
  const walk = (node: TreeNode) => {
    ids.push(node.id);
    node.children.forEach(walk);
  };
  trees.flat().forEach(walk);
  return ids;
}
