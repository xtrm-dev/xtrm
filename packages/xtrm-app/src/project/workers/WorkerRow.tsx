import type { CSSProperties } from "react";
import { Icon } from "../../ui/icon.tsx";
import { Badge } from "../../ui/badge.tsx";
import { Row, cx } from "../../ui/primitives.tsx";
import type { Worker } from "../../adapters/status-board/types.ts";
import { INDENT_REM } from "../../issues/issue-table.ts";
import { ReferenceChip } from "../../refs/references.tsx";
import { PrTrail } from "./PrTrail.tsx";
import { claimState, statusTone, type TreeNode } from "./model.ts";

/**
 * The trailing column template shared by the list header, the tree rows and the flat
 * board rows (the Follow-ups grid pattern): state chip, issue, PR trail, context, claim.
 * Fixed tracks are what let the header labels sit over the values they name.
 */
export const WORKER_COLUMNS = "grid shrink-0 grid-cols-[6.5rem_7rem_3.5rem_2.5rem_6rem] items-center gap-2";

/** The shared disclosure step for a row or a toggle (XTRM-934): a 0.875rem mark in a size-5 box. */
/** One disclosure idiom, one string: the tree and the unknown-dispatcher toggle share it. */
export const CHEVRON = "transition-transform";

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
        className="items-center"
        aria-expanded={hasChildren ? open : undefined}
        style={{ "--row-indent": `${depth * INDENT_REM}rem` } as CSSProperties}
        onActivate={hasChildren ? () => onToggle(node.id) : undefined}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden" style={{ paddingLeft: "var(--row-indent)" }}>
          <span className="flex size-5 shrink-0 items-center justify-center text-ink-faint" aria-hidden>
            {hasChildren && <Icon name="chevronDown" size="text" className={cx(CHEVRON, !open && "-rotate-90")} />}
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

        <span className={cx(WORKER_COLUMNS, "ml-auto")}>
          <span className="min-w-0 overflow-hidden">
            {status !== null ? (
              <Badge tone={statusTone(status)} size="xs" title={`worker status: ${status}`}>
                {status}
              </Badge>
            ) : (
              <span className="text-ink-faint" title="no board record for this vertex">
                —
              </span>
            )}
          </span>

          <span className="min-w-0 overflow-hidden">
            {namedByIssue ? null : node.issueRef ? (
              <ReferenceChip reference={{ kind: "issue", ref: node.issueRef }} showAlias={false} />
            ) : (
              <span className="text-ink-faint">no issue</span>
            )}
          </span>

          <span className="min-w-0 overflow-hidden">
            <PrTrail prs={node.prs} />
          </span>

          <span className="text-right text-ink-faint tabular-nums">{node.ctxPct === null ? "—" : `${node.ctxPct}%`}</span>

          <span
            data-testid="worker-claim"
            className={cx(
              "min-w-0 truncate text-right text-ink-faint",
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
    <Row density="list" data-testid={testid} className="items-center" style={{ "--row-indent": "0rem" } as CSSProperties}>
      <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden" style={{ paddingLeft: "var(--row-indent)" }}>
        <span className="size-5 shrink-0" aria-hidden />
        <Icon name={worker.kind === "specialist" ? "specialists" : "agent"} size="text" className="shrink-0 text-ink-faint" />
        <span className="min-w-0 truncate text-ink">{worker.name}</span>
        <span className="shrink-0 text-ink-faint">{worker.kind ?? "worker"}</span>
        {worker.milestone && <span className="min-w-0 truncate text-xs text-ink-faint">{worker.milestone}</span>}
      </span>
      <span className={cx(WORKER_COLUMNS, "ml-auto")}>
        <span className="min-w-0 overflow-hidden">
          {worker.status ? (
            <Badge tone={statusTone(worker.status)} size="xs" title={`worker status: ${worker.status}`}>
              {worker.status}
            </Badge>
          ) : (
            <span className="text-ink-faint">unknown state</span>
          )}
        </span>
        <span className="min-w-0 overflow-hidden">
          {worker.issue ? (
            <ReferenceChip reference={{ kind: "issue", ref: worker.issue }} showAlias={false} />
          ) : (
            <span className="text-ink-faint">no issue</span>
          )}
        </span>
        {/* A board row has no graph trail; the empty cell keeps ctx and claim under their headings. */}
        <span className="min-w-0" aria-hidden />
        <span className="text-right text-ink-faint tabular-nums">{typeof worker.ctxPct === "number" ? `${worker.ctxPct}%` : "—"}</span>
        <span
          data-testid="worker-claim"
          className={cx(
            "min-w-0 truncate text-right text-ink-faint",
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
