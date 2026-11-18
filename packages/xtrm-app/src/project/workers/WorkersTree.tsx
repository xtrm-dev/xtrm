import { useState } from "react";
import type { Worker } from "../../adapters/status-board/types.ts";
import { EmptyState } from "../../ui/primitives.tsx";
import { BoardWorkerRow, WorkerRow } from "./WorkerRow.tsx";
import type { TreeNode, WorkersTreeModel } from "./model.ts";

/**
 * The Workers tree (console-ui-system §6): lead → worker → activation, each row carrying
 * its issue and PR as a trail, never as extra tree levels.
 *
 * The parent chain is the durable `dispatched_by` edge. A worker whose binding carries no
 * dispatcher is not attached to a guessed parent: it is listed under "unknown dispatcher",
 * together with the board workers that the graph does not mention at all.
 */
export function WorkersTree({ model, now }: { model: WorkersTreeModel; now: number }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(allIds(model.roots, model.unknown)));
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const total = model.roots.length + model.unknown.length + model.orphans.length;
  if (total === 0) {
    return <EmptyState icon="specialists" title="No workers">Neither the dispatch graph nor the board reports a worker for this repository.</EmptyState>;
  }

  return (
    <div className="min-w-0" data-testid="workers-tree">
      {model.roots.map((node) => (
        <WorkerRow key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggle} now={now} />
      ))}

      {(model.unknown.length > 0 || model.orphans.length > 0) && (
        <section aria-label="Unknown dispatcher" className="mt-3 border-t border-border-muted pt-2">
          <h3 className="px-1.5 text-xs font-medium text-ink-muted">unknown dispatcher</h3>
          <p className="px-1.5 pb-1 text-xs text-ink-faint">
            Workers whose launch did not record who dispatched them, and board workers the graph does not mention. The tree does not guess a parent.
          </p>
          {model.unknown.map((node) => (
            <WorkerRow key={node.id} node={node} depth={0} expanded={expanded} onToggle={toggle} now={now} />
          ))}
          {model.orphans.map((worker) => (
            <BoardWorkerRow key={worker.name} worker={worker} now={now} testid="worker-orphan" />
          ))}
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
