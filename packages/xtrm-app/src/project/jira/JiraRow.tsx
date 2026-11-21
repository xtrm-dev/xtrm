import { useNavigate } from "@tanstack/react-router";
import type { JiraIssue } from "../../adapters/jira/types.ts";
import { useShell } from "../../shell/context.tsx";
import { Badge, type BadgeTone } from "../../ui/badge.tsx";
import { Row, StatusDot, cx } from "../../ui/primitives.tsx";
import { RowAction } from "../../ui/row-action.tsx";
import { jiraSyncLabel } from "./JiraChip.tsx";

/**
 * One Jira issue in the repository's bound project (ADR-002 §D2/D9): key,
 * summary, remote status, assignee, Substrate link state, and the row action
 * that opens the issue in Jira.
 *
 * Restraint (§D9, one coloured element per row): the key is row identity and
 * stays ink mono, the status dot is neutral with the status as text, and the
 * Substrate ref is the row's only accent reference. The status travels from the
 * fetched remote issue; the link state comes from the Substrate bindings.
 */

/** Shared column grid for the surface's header and every row; the last column is the row action. */
export const JIRA_GRID = "grid grid-cols-[7.5rem_minmax(0,1fr)_7rem_7rem_6.5rem_7rem_1.25rem] items-center gap-3";

// The reference table (src/issues/IssuesSurface.tsx) sets its primary text at the row size and
// keeps only numeric/meta cells at text-xs; this table joins it rather than inventing a smaller body.
const CELL = "min-w-0 truncate text-sm";

/** The link state is ink-only: drift is the only state that earns a warning tone. */
export function jiraSyncTone(issue: Pick<JiraIssue, "syncState" | "bindingsAvailable">): BadgeTone {
  if (!issue.bindingsAvailable) return "muted";
  return issue.syncState === "drift" ? "danger" : issue.syncState === "in_sync" ? "neutral" : "muted";
}

export function JiraRow({ issue }: { issue: JiraIssue }) {
  const navigate = useNavigate();
  const { repo } = useShell();
  return (
    <Row density="list" role="listitem" data-testid={`jira-row-${issue.key}`} data-jira-key={issue.key} className="gap-0">
      <div className={cx(JIRA_GRID, "w-full")}>
        <span className={cx(CELL, "font-mono text-ink")} title={issue.key}>
          {issue.key}
        </span>
        <span className={cx(CELL, "text-ink")} title={issue.summary ?? undefined}>
          {issue.summary ?? <span className="text-ink-faint">No summary</span>}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-ink-muted">
          {issue.status === null ? (
            <span className="text-ink-faint">No status</span>
          ) : (
            <>
              <StatusDot tone="neutral" label={issue.status} />
              <span className="truncate">{issue.status}</span>
            </>
          )}
        </span>
        <span className={cx(CELL, "text-xs", issue.assignee === null ? "text-ink-faint" : "text-ink-muted")}>{issue.assignee ?? "Unassigned"}</span>
        <span>
          <Badge tone={jiraSyncTone(issue)} size="xs" title="Substrate link state, read from external_bindings">
            {jiraSyncLabel(issue)}
          </Badge>
        </span>
        <span className="min-w-0 text-xs">
          {issue.issueRef === null ? (
            <span className="text-ink-faint" title={issue.bindingsAvailable ? "No Substrate issue is bound to this key" : "The Substrate bindings read did not answer"}>
              {issue.bindingsAvailable ? "—" : "unknown"}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void navigate({ to: `/rep/${repo.owner}/${repo.name}/work/issues/${issue.issueRef}` } as never)}
              className="truncate font-mono text-accent-ink outline-none hover:underline focus-visible:underline"
              title={`Open Substrate issue ${issue.issueRef}`}
            >
              {issue.issueRef}
            </button>
          )}
        </span>
        {/* Same reveal contract as `Row`'s actions wrapper (§4.3, XTRM-883): hidden means unclickable. */}
        <span className="pointer-events-none flex justify-end opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100">
          <RowAction
            icon="external"
            label={`Open ${issue.key} in Jira`}
            onAct={() => {
              window.open(issue.url, "_blank", "noopener");
            }}
          />
        </span>
      </div>
    </Row>
  );
}
