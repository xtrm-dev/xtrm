import { Icon } from "../../ui/icon.tsx";
import { Badge } from "../../ui/badge.tsx";
import { PrKey } from "../../ui/pr-key.tsx";
import { Row, cx } from "../../ui/primitives.tsx";
import type { Worker } from "../../adapters/status-board/types.ts";
import { ReferenceChip } from "../../refs/references.tsx";
import { claimState, statusTone, type TreeNode } from "./model.ts";

/**
 * One Workers-tree row (console-ui-system §6 node anatomy):
 * `[disclosure] [glyph] [name] [role word] | [state] | [issue chip] [PrKey] | [ctx %] | [claim]`.
 *
 * Restraint rule 1: the status badge is the row's only coloured element, so the issue
 * chip and the `PrKey` stay plain. Rule 2: role, runtime, ctx % and claim are plain text,
 * never chips — only the state is a chip.
 */
export function WorkerRow({
  node,
  depth,
  expanded,
  onToggle,
  now,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  now: number;
}) {
  const open = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const claim = claimState(node.claimUntil, now);
  const status = node.status;

  return (
    <>
      <Row
        density="list"
        data-testid="worker-row"
        data-kind={node.kind}
        className="items-center gap-2"
        onActivate={hasChildren ? () => onToggle(node.id) : undefined}
      >
        <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 14 }}>
          <span className="w-3 shrink-0 text-ink-faint" aria-hidden>
            {hasChildren ? (open ? "▾" : "▸") : ""}
          </span>
          <Icon name={node.kind === "activation" ? "specialists" : "agent"} size="text" className="shrink-0 text-ink-faint" />
          <span className="truncate text-ink">{node.name}</span>
          <span className="shrink-0 text-ink-faint">{node.roleWord}</span>
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-2">
          {status !== null ? (
            <Badge tone={statusTone(status)} size="xs" title={`worker status: ${status}`}>
              {status}
            </Badge>
          ) : (
            <span className="text-ink-faint" title="no board record for this vertex">
              —
            </span>
          )}

          {node.issueRef ? <ReferenceChip reference={{ kind: "issue", ref: node.issueRef }} showAlias={false} /> : <span className="text-ink-faint">no issue</span>}

          {node.prs.map((pr) => (
            <PrKey key={`${pr.repo ?? ""}#${pr.number}`} number={pr.number} repo={pr.repo ?? undefined} state={null} quiet />
          ))}

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
          <WorkerRow key={child.id} node={child} depth={depth + 1} expanded={expanded} onToggle={onToggle} now={now} />
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
      <span className="flex min-w-0 items-center gap-2 pl-3.5">
        <span className="w-3 shrink-0" aria-hidden />
        <Icon name={worker.kind === "specialist" ? "specialists" : "agent"} size="text" className="shrink-0 text-ink-faint" />
        <span className="truncate text-ink">{worker.name}</span>
        <span className="shrink-0 text-ink-faint">{worker.kind ?? "worker"}</span>
        {worker.milestone && <span className="truncate text-xs text-ink-faint">{worker.milestone}</span>}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {worker.status ? (
          <Badge tone={statusTone(worker.status)} size="xs" title={`worker status: ${worker.status}`}>
            {worker.status}
          </Badge>
        ) : (
          <span className="text-ink-faint">unknown state</span>
        )}
        {worker.issue ? <ReferenceChip reference={{ kind: "issue", ref: worker.issue }} showAlias={false} /> : <span className="text-ink-faint">no issue</span>}
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
