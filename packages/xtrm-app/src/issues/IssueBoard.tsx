import { useQueryClient } from "@tanstack/react-query";
import { useState, type DragEvent } from "react";
import { useAdapters, type IssueSummary, type Lifecycle } from "../adapters/index.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { cx, relativeTime } from "../ui/primitives.tsx";
import { SectionHeader } from "../ui/section.tsx";
import { TERMINAL, IssueKey, PriorityGlyph, kindIcon } from "./meta.tsx";
import { ReferenceChip } from "../refs/references.tsx";

/**
 * Board columns. Blocked and Ready are derived from dependencies and the dispatchable set,
 * so they are not drop targets: READY is an execution gate, not a status you drag into (PRD §8).
 */
export const BOARD_COLUMNS: Array<{ id: string; label: string; match: (i: IssueSummary) => boolean; drop?: Lifecycle; hint?: string }> = [
  { id: "blocked", label: "Blocked", match: (i) => i.lifecycle === "open" && i.blockedBy.length > 0, hint: "derived from blockers" },
  { id: "ready", label: "Ready", match: (i) => i.lifecycle === "open" && !i.blockedBy.length && i.readiness === "ready", hint: "derived from contract readiness" },
  { id: "todo", label: "To do", match: (i) => i.lifecycle === "open" && !i.blockedBy.length && i.readiness !== "ready", drop: "open" },
  { id: "deferred", label: "Deferred", match: (i) => i.lifecycle === "deferred", drop: "deferred" },
  { id: "done", label: "Done", match: (i) => TERMINAL.has(i.lifecycle), drop: "done" },
];

// ponytail: columns render at most this many cards (no per-column virtualization); the list view shows the rest.
const COLUMN_LIMIT = 50;

const MOVES: Array<[Lifecycle, string]> = [
  ["open", "Open"],
  ["deferred", "Deferred"],
  ["done", "Done"],
];

export function IssueBoard({
  issues,
  projectId,
  canWrite,
  inspectedRef,
  onInspect,
  onOpen,
}: {
  issues: IssueSummary[];
  projectId: string;
  canWrite: boolean;
  inspectedRef: string | null;
  onInspect: (ref: string) => void;
  onOpen: (ref: string) => void;
}) {
  const { substrate } = useAdapters();
  const qc = useQueryClient();
  const [dragging, setDragging] = useState<IssueSummary | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const move = async (issue: IssueSummary, state: Lifecycle) => {
    if (issue.lifecycle === state) return;
    setPending(issue.ref);
    setError(null);
    try {
      await substrate.setLifecycle(projectId, issue.ref, state);
      await qc.invalidateQueries({ queryKey: ["substrate", "issues"] });
    } catch (e) {
      setError(`${issue.ref}: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPending(null);
    }
  };

  const accepts = (column: (typeof BOARD_COLUMNS)[number]) => !!dragging && !!column.drop && dragging.lifecycle !== column.drop;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <p role="alert" className="mx-8 mb-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="thin-scrollbar flex min-h-0 flex-1 overflow-x-auto px-8 pb-4" data-testid="issue-board">
        {BOARD_COLUMNS.map((column) => {
          const cards = issues.filter(column.match);
          const shown = cards.slice(0, COLUMN_LIMIT);
          const target = accepts(column);
          return (
            <section
              key={column.id}
              aria-label={`${column.label} column`}
              data-testid={`board-column-${column.id}`}
              onDragOver={(e: DragEvent) => {
                if (!target) return;
                e.preventDefault();
                setOver(column.id);
              }}
              onDragLeave={() => setOver((o) => (o === column.id ? null : o))}
              onDrop={(e: DragEvent) => {
                e.preventDefault();
                setOver(null);
                if (target && dragging && column.drop) void move(dragging, column.drop);
              }}
              className={cx(
                // A column is a lane, not a card: one hairline between lanes. The drop affordance is
                // that hairline turning accent plus a faint fill, because a lane has no ring to paint.
                "flex w-72 shrink-0 flex-col border-l border-border-muted pl-3 transition-colors first:border-l-0 first:pl-0",
                over === column.id ? "border-l-accent/60 bg-accent-soft/40" : "",
                dragging && !target && "opacity-60",
              )}
            >
              {/* `inset="none"` inside a box of the card's own gutter, so the lane heading starts on
               * the same x as the card titles below it (both 24px from the hairline).
               *
               * Level 2, because a lane is a section of the page: the board is a mode of the Issues
               * surface under its own toolbar, and until now the outline began at h3 with no h1 or h2
               * above it (XTRM-954: the first heading on a page is level 1 or 2, and an omission is
               * written where it lives). */}
              <div className="flex h-8 shrink-0 items-center px-3">
                <SectionHeader
                  title={column.label}
                  count={cards.length}
                  level={2}
                  inset="none"
                  // `auto` is the only word the hint explains, so the tip rides on the word itself.
                  aside={column.hint && <span className="text-xs text-ink-faint" title={column.hint}>auto</span>}
                />
              </div>
              <ol className="thin-scrollbar flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pb-2">
                {shown.map((issue) => (
                  <li key={issue.id}>
                    <BoardCard
                      issue={issue}
                      selected={inspectedRef === issue.ref}
                      pending={pending === issue.ref}
                      canWrite={canWrite}
                      onInspect={() => onInspect(issue.ref)}
                      onOpen={() => onOpen(issue.ref)}
                      onMove={(state) => void move(issue, state)}
                      onDragStart={() => setDragging(issue)}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                    />
                  </li>
                ))}
                {cards.length > shown.length && <li className="px-1 py-1 text-xs text-ink-faint">+{cards.length - shown.length} more in the list view</li>}
                {!cards.length && <li className="px-1 py-2 text-xs text-ink-faint">No issues</li>}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardCard({
  issue,
  selected,
  pending,
  canWrite,
  onInspect,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  issue: IssueSummary;
  selected: boolean;
  pending: boolean;
  canWrite: boolean;
  onInspect: () => void;
  onOpen: () => void;
  onMove: (state: Lifecycle) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const terminal = TERMINAL.has(issue.lifecycle);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${issue.ref} ${issue.title}`}
      aria-pressed={selected}
      data-testid="board-card"
      draggable={canWrite && !pending}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", issue.ref);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onInspect}
      onDoubleClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") onOpen();
        if (e.key === " ") {
          e.preventDefault();
          onInspect();
        }
      }}
      className={cx(
        // The console's one card dialect, byte for byte: `IssueProvenance.tsx`'s local `Card`
        // (`rounded-md border border-border-muted px-3 py-2.5`) and `IssueView.tsx`'s `PreviewBlock`.
        // A third copy is the duplication, not the board's frame.
        "group/card flex flex-col gap-2 rounded-md border border-border-muted px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        selected ? "border-accent/60" : "hover:border-border",
        canWrite && "cursor-grab active:cursor-grabbing",
        pending && "opacity-50",
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon name={kindIcon(issue.kind)} size="xs" className="text-ink-faint" />
        <IssueKey locator={issue.locator} humanRef={issue.ref} className="min-w-0 truncate" />
        <PriorityGlyph priority={issue.priority} />
        <span className="ml-auto opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100 has-[[data-popup-open]]:opacity-100" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {canWrite && (
            <OptionsMenu
              label={`Move ${issue.ref}`}
              header="Move to"
              items={MOVES.map(([state, label]) => ({ label, disabled: issue.lifecycle === state, onSelect: () => onMove(state) }))}
            />
          )}
        </span>
      </div>
      <p className={cx("line-clamp-2 text-sm", terminal ? "text-ink-muted" : "text-ink")}>{issue.title}</p>
      <div className="flex items-center gap-2 text-xs text-ink-faint">
        {issue.blockedBy.length > 0 && !terminal && <span title={`Blocked by ${issue.blockedBy.join(", ")}`}>blocked by {issue.blockedBy.length}</span>}
        {issue.childCount > 0 && (
          <span className="tabular">
            {issue.childrenDone}/{issue.childCount} children
          </span>
        )}
        {issue.parentRef && (
          <span className="flex min-w-0 items-center">
            ↑<ReferenceChip reference={{ kind: "issue", ref: issue.parentRef }} fallback={issue.parentLocator ?? issue.parentRef} className="truncate" />
          </span>
        )}
        <span className="ml-auto shrink-0 tabular">{relativeTime(issue.updatedAt)}</span>
      </div>
    </div>
  );
}
