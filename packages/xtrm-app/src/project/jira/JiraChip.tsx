import { useMemo } from "react";
import type { JiraIssue, JiraSearchPage } from "../../adapters/jira/types.ts";
import { useJiraIssues } from "../../app/queries.ts";
import { Icon } from "../../ui/icon.tsx";
import { cx, type Tone } from "../../ui/primitives.tsx";

/**
 * Jira links and their one resolution point (ADR-002 D6).
 *
 * A Jira issue is a link, never an editor: a chip opens the browse URL in a new
 * tab and nothing here writes upstream. Provider identity comes from the
 * Substrate bindings carried on the row (`issueRef`, `syncState`), never from
 * the key's shape, so `MMD-551` and `XTRM-551` resolve the way their owners
 * bound them. The status tone is read from the fetched remote status only
 * (D5/D6); a board record never decides it.
 */

/**
 * Remote workflow status → tone. The remote status is the only input: an
 * unrecognised word stays neutral rather than guessing a lifecycle.
 */
export function jiraStatusTone(status: string | null): Tone {
  if (status === null) return "muted";
  const word = status.trim().toLowerCase();
  if (["done", "closed", "resolved", "complete", "completed", "cancelled", "canceled"].includes(word)) return "done";
  if (["in progress", "in review", "review", "active"].includes(word)) return "active";
  if (["blocked", "failed"].includes(word)) return "danger";
  return "neutral";
}

/**
 * The row's Substrate link state. A null `syncState` is two different facts: no
 * binding exists, or the bindings read did not answer — `bindingsAvailable`
 * says which, so the surface never reports an unknown as unlinked (D5).
 */
export function jiraSyncLabel(issue: Pick<JiraIssue, "syncState" | "bindingsAvailable">): string {
  if (!issue.bindingsAvailable) return "link unknown";
  if (issue.syncState === null) return "unlinked";
  return issue.syncState.replace(/_/g, " ");
}

export interface JiraIndex {
  byKey: Map<string, JiraIssue>;
  byIssueRef: Map<string, JiraIssue>;
  page: JiraSearchPage | null;
  pending: boolean;
  error: Error | null;
}

/**
 * One repository's bound Jira page, indexed by key and by Substrate issue ref.
 * `enabled` lets a chip keep the read closed until it meets a key the Substrate
 * index did not resolve.
 */
export function useJiraIssueIndex(repo: string, enabled = true): JiraIndex {
  const query = useJiraIssues(repo, enabled);
  const page = query.data ?? null;
  const pending = query.isPending;
  const error = query.error instanceof Error ? query.error : null;
  return useMemo(() => {
    const byKey = new Map<string, JiraIssue>();
    const byIssueRef = new Map<string, JiraIssue>();
    for (const issue of page?.issues ?? []) {
      byKey.set(issue.key, issue);
      if (issue.issueRef !== null) byIssueRef.set(issue.issueRef, issue);
    }
    return { byKey, byIssueRef, page, pending, error };
  }, [page, pending, error]);
}

/**
 * The chip, rendered only for a resolved issue so a key never becomes a dead link.
 * `showStatusText` adds the remote status as a word for the places that have room for it
 * (the issue page's Details row); the dot alone carries the same status elsewhere.
 */
export function JiraChip({ issue, showStatusText, className }: { issue: JiraIssue; showStatusText?: boolean; className?: string }) {
  const label = `${issue.key} on Jira${issue.status === null ? "" : ` · ${issue.status}`}`;
  return (
    <a
      href={issue.url}
      target="_blank"
      rel="noreferrer"
      title={label}
      data-reference={`@jira:${issue.key}`}
      data-jira-key={issue.key}
      data-jira-sync={jiraSyncLabel(issue)}
      onClick={(event) => event.stopPropagation()}
      className={cx(
        "inline-flex max-w-full min-w-0 items-center gap-1 rounded-sm border border-border-muted px-1 py-px align-baseline text-xs text-ink-muted hover:border-border hover:text-ink",
        className,
      )}
    >
      <span className="truncate font-mono">{issue.key}</span>
      {showStatusText && issue.status !== null && <span data-testid="jira-chip-status" className="truncate text-ink-muted">{issue.status}</span>}
      <Icon name="external" size="text" className="shrink-0 text-ink-faint" />
      <span className="sr-only">(opens in Jira)</span>
    </a>
  );
}

/**
 * A forced `@jira:KEY-123` reference. The key must resolve inside the
 * repository's bound project; when it does not, the author's text stays prose
 * with the reason in its title, and no chip is invented.
 */
export function JiraKeyReference({ repo, jiraKey, fallback }: { repo: string; jiraKey: string; fallback: string }) {
  const index = useJiraIssueIndex(repo, true);
  const issue = index.byKey.get(jiraKey);
  if (issue !== undefined) return <JiraChip issue={issue} />;
  const reason = index.pending
    ? "resolving the Jira key"
    : index.error !== null
      ? `the Jira bridge did not answer: ${index.error.message}`
      : `no Jira issue ${jiraKey} in the bound project`;
  return (
    <span title={reason} data-unresolved="jira" className="font-mono text-xs text-ink-muted">
      {fallback}
    </span>
  );
}
