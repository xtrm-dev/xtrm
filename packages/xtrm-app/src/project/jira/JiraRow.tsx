import { useNavigate } from "@tanstack/react-router";
import type { JiraIssue } from "../../adapters/jira/types.ts";
import { useShell } from "../../shell/context.tsx";
import { Badge, type BadgeTone } from "../../ui/badge.tsx";
import { Icon } from "../../ui/icon.tsx";
import { Row, StatusDot, cx } from "../../ui/primitives.tsx";
import { jiraStatusTone, jiraSyncLabel } from "./JiraChip.tsx";

/**
 * One Jira issue in the repository's bound project (ADR-002 §D2/D9): key,
 * summary, remote status, assignee, Substrate link state and the browse link.
 * The table is read-only; the only writes in the app stay in Substrate.
 */

/** Shared column grid for the surface's header and every row. */
export const JIRA_GRID = "grid w-full grid-cols-[7.5rem_minmax(0,1fr)_7rem_7rem_6.5rem_7rem] items-center gap-3";

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
    <Row density="list" role="listitem" data-testid={`jira-row-${issue.key}`} data-jira-key={issue.key} className="h-9 gap-0">
      <div className={JIRA_GRID}>
        <span className="min-w-0">
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            title={`Open ${issue.key} in Jira`}
            className="inline-flex min-w-0 items-center gap-1 font-mono text-xs text-accent-ink hover:underline"
          >
            <span className="truncate">{issue.key}</span>
            <Icon name="external" size="text" className="shrink-0" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </span>
        <span className={cx(CELL, "text-ink")} title={issue.summary ?? undefined}>
          {issue.summary ?? <span className="text-ink-faint">No summary</span>}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-sm text-ink-muted">
          {issue.status === null ? (
            <span className="text-ink-faint">No status</span>
          ) : (
            <>
              <StatusDot tone={jiraStatusTone(issue.status)} label={issue.status} />
              <span className="truncate">{issue.status}</span>
            </>
          )}
        </span>
        <span className={cx(CELL, issue.assignee === null ? "text-ink-faint" : "text-ink-muted")}>{issue.assignee ?? "Unassigned"}</span>
        <span>
          <Badge tone={jiraSyncTone(issue)} title="Substrate link state, read from external_bindings">
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
      </div>
    </Row>
  );
}
