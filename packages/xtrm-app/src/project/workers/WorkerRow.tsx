import { Icon } from "../../ui/icon.tsx";
import { Badge } from "../../ui/badge.tsx";
import { Row, cx } from "../../ui/primitives.tsx";
import type { Worker } from "../../adapters/status-board/types.ts";
import { ReferenceChip } from "../../refs/references.tsx";
import { PrTrail } from "./PrTrail.tsx";
import { claimState, statusTone, type TreeNode } from "./model.ts";

/**
 * One Workers-tree row (console-ui-system §6 node anatomy):
 * `[disclosure] [glyph] [name] [role word] | [state] | [issue chip] [PrKey] | [ctx %] | [claim]`.
 *
 * Restraint rule 1: the status badge is the row's only coloured element, so the issue
 * chip and the `PrKey` stay plain. Rule 2: role, runtime, ctx % and claim are plain text,
 * never chips — only the state is a chip.
 *
 * A live row names an issue when the graph has no human name for the vertex; the machine
 * identity (session UUID, `$3`, `act:…`) stays in the tooltip (XTRM-912). The row is the
 * layout's flex container: the name truncates, and nothing in it may push the row wider
 * than its own box.
 */
export function WorkerRow({
  node,
  depth,
  expanded,
  onToggle,
  now,
  titleOf,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  now: number;
  /** The issue title for a vertex named by its issue; absent outside a project shell. */
  titleOf?: (ref: string) => string | null;
}) {
  const open = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const claim = claimState(node.claimUntil, now);
  const status = node.status;
  // Only an unnamed vertex borrows the issue's name, so a human name is never replaced.
  const namedByIssue = node.unnamed && node.issueRef !== null;
  const issueTitle = namedByIssue ? (titleOf?.(node.issueRef!) ?? null) : null;

  return (
    <>
      <Row
        density="list"
        data-testid="worker-row"
        data-kind={node.kind}
        className="items-center gap-2"
        onActivate={hasChildren ? () => onToggle(node.id) : undefined}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden" style={{ paddingLeft: depth * 14 }}>
          <span className="w-3 shrink-0 text-ink-faint" aria-hidden>
            {hasChildren ? (open ? "▾" : "▸") : ""}
          </span>
          <Icon name={node.kind === "activation" ? "specialists" : "agent"} size="text" className="shrink-0 text-ink-faint" />
          {namedByIssue ? (
            <span className="flex min-w-0 items-center gap-1.5" data-testid="worker-name" title={node.rawLabel}>
              <span className="shrink-0">
                <ReferenceChip reference={{ kind: "issue", ref: node.issueRef! }} showAlias={false} />
              </span>
              {issueTitle && <span className="truncate text-ink">{issueTitle}</span>}
            </span>
          ) : (
            <span className="min-w-0 truncate text-ink" data-testid="worker-name" title={node.rawLabel !== node.name ? node.rawLabel : undefined}>
              {node.name}
            </span>
          )}
          <span className="shrink-0 text-ink-faint">{node.roleWord}</span>
        </span>

        <span className="ml-auto flex min-w-0 shrink items-center gap-2 overflow-hidden">
          {status !== null ? (
            <span className="shrink-0">
              <Badge tone={statusTone(status)} size="xs" title={`worker status: ${status}`}>
                {status}
              </Badge>
            </span>
          ) : (
            <span className="shrink-0 text-ink-faint" title="no board record for this vertex">
              —
            </span>
          )}

          {namedByIssue ? null : node.issueRef ? (
            <span className="min-w-0">
              <ReferenceChip reference={{ kind: "issue", ref: node.issueRef }} showAlias={false} />
            </span>
          ) : (
            <span className="shrink-0 text-ink-faint">no issue</span>
          )}

          <PrTrail prs={node.prs} />

          <span className="w-10 shrink-0 text-right text-ink-faint tabular-nums">{node.ctxPct === null ? "—" : `${node.ctxPct}%`}</span>

          <span
            data-testid="worker-claim"
            className={cx(
              "w-24 shrink-0 truncate text-right text-ink-faint",
              claim === "soon" && "font-medium text-ink",
              claim === "expired" && "text-danger",
            )}
            title={node.claimUntil ?? "no claim"}
          >
            {claim === "none" ? "—" : claim === "expired" ? "claim expired" : `claim ${claim === "soon" ? "ending" : "held"}`}
          </span>
        </span>
      </Row>
      {open &&
        node.children.map((child) => (
          <WorkerRow key={child.id} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} now={now} titleOf={titleOf} />
        ))}
    </>
  );
}

/**
 * A board worker as one row, with no graph position: the flat list's row and the
 * tree's "unknown dispatcher" orphan row. Its issue ref resolves or stays plain.
 */
export function BoardWorkerRow({ worker, now, testid }: { worker: Worker; now: number; testid: string }) {
  const claim = claimState(worker.claimUntil, now);
  return (
    <Row density="list" data-testid={testid} className="items-center gap-2">
      <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden pl-3.5">
        <span className="w-3 shrink-0" aria-hidden />
        <Icon name={worker.kind === "specialist" ? "specialists" : "agent"} size="text" className="shrink-0 text-ink-faint" />
        <span className="min-w-0 truncate text-ink">{worker.name}</span>
        <span className="shrink-0 text-ink-faint">{worker.kind ?? "worker"}</span>
        {worker.milestone && <span className="min-w-0 truncate text-xs text-ink-faint">{worker.milestone}</span>}
      </span>
      <span className="ml-auto flex min-w-0 shrink items-center gap-2 overflow-hidden">
        {worker.status ? (
          <span className="shrink-0">
            <Badge tone={statusTone(worker.status)} size="xs" title={`worker status: ${worker.status}`}>
              {worker.status}
            </Badge>
          </span>
        ) : (
          <span className="shrink-0 text-ink-faint">unknown state</span>
        )}
        {worker.issue ? (
          <span className="min-w-0">
            <ReferenceChip reference={{ kind: "issue", ref: worker.issue }} showAlias={false} />
          </span>
        ) : (
          <span className="shrink-0 text-ink-faint">no issue</span>
        )}
        <span className="w-10 shrink-0 text-right text-ink-faint tabular-nums">{typeof worker.ctxPct === "number" ? `${worker.ctxPct}%` : "—"}</span>
        <span
          data-testid="worker-claim"
          className={cx(
            "w-24 shrink-0 truncate text-right text-ink-faint",
            claim === "soon" && "font-medium text-ink",
            claim === "expired" && "text-danger",
          )}
          title={worker.claimUntil ?? "no claim"}
        >
          {claim === "none" ? "—" : claim === "expired" ? "claim expired" : `claim ${claim === "soon" ? "ending" : "held"}`}
        </span>
      </span>
    </Row>
  );
}
