import type { ReactNode } from "react";
import { useAdapters } from "../../adapters/index.tsx";
import { useJiraBinding, useJiraIssues } from "../../app/queries.ts";
import { useShell } from "../../shell/context.tsx";
import { EmptyState, ErrorState, LoadingState, ago } from "../../ui/primitives.tsx";
import { ProjectShell } from "../ProjectShell.tsx";
import { JIRA_GRID, JiraRow } from "./JiraRow.tsx";

/**
 * Jira (§D2/D3): the Jira issues bound to this repository's Jira project, with
 * key, summary, remote status, assignee, Substrate link state and a browse link.
 *
 * Read-only against the bridge (ADR-002 assumption 4): the surface lists the
 * bound project's page, never runs free JQL, never writes, and never infers a
 * link state — `syncState` is displayed from the Substrate bindings or reported
 * as unknown. An unbound repository reads no Jira collection at all.
 */
export function JiraSurface() {
  const { repo } = useShell();
  const { jira } = useAdapters();
  const repository = repo.fullName;

  const binding = useJiraBinding(repository);
  const bound = binding.data?.configured === true;
  const issues = useJiraIssues(repository, bound);

  const shell = (children: ReactNode, freshness: string) => (
    <ProjectShell
      title="Jira"
      binding={binding.data ?? null}
      health={null}
      freshness={freshness}
      source={jira.source}
      toolbar={
        bound && binding.data?.project ? (
          <span className="truncate font-mono text-[11px] text-ink-faint" data-testid="jira-binding">
            {binding.data.project}
            {binding.data.site === null ? "" : ` · ${binding.data.site}`}
          </span>
        ) : undefined
      }
    >
      {children}
    </ProjectShell>
  );

  if (binding.isPending) return shell(<LoadingState label="Resolving the Jira binding" rows={4} />, "checking link");
  if (binding.isError) return shell(<ErrorState title="The Jira bridge is unavailable" error={binding.error} />, "link unavailable");
  const resolved = binding.data;
  if (!resolved.configured) {
    return shell(
      <EmptyState icon="link" title="This repository is not linked to Jira">
        <span data-testid="jira-unbound-reason">
          {repository} has no Jira binding
          {resolved.reason === null ? "" : ` (${resolved.reason.replace(/_/g, " ")})`}. Bind the repository to a Jira project in the status board, then reload this section.
        </span>
      </EmptyState>,
      "not linked",
    );
  }

  if (issues.isPending) return shell(<LoadingState label="Reading the bound Jira project" />, "reading issues");
  if (issues.isError) return shell(<ErrorState title="The bound Jira project could not be read" error={issues.error} />, "read failed");

  const page = issues.data;
  const freshness = `read ${ago(page.cachedAt ?? Date.now())}`;

  return shell(
    <>
      <div className="border-b border-border-muted px-3 py-1.5">
        <div className={JIRA_GRID} role="row">
          {["Key", "Summary", "Status", "Assignee", "Sync", "Substrate"].map((label) => (
            <span key={label} role="columnheader" className="text-[11px] text-ink-faint">
              {label}
            </span>
          ))}
          {/* The last column carries the row action (open in Jira); it has no visible heading. */}
          <span role="columnheader" className="sr-only">
            Actions
          </span>
        </div>
      </div>
      {page.issues.length === 0 ? (
        <EmptyState icon="link" title="The bound Jira project has no issues">
          <span>
            {resolved.project} is the bound project for {repository}.
          </span>
        </EmptyState>
      ) : (
        <div role="list" aria-label="Jira issues in the bound project">
          {page.issues.map((issue) => (
            <JiraRow key={issue.key} issue={issue} />
          ))}
        </div>
      )}
      {!page.bindingsAvailable && (
        <p className="px-3 py-2 text-xs text-ink-muted" data-testid="jira-bindings-incomplete">
          The Substrate link join did not answer{page.bindingsReason === null ? "" : ` (${page.bindingsReason.replace(/_/g, " ")})`}. Link state is unknown, not unlinked.
        </p>
      )}
      {page.truncated && (
        <p className="px-3 py-2 text-xs text-ink-muted" data-testid="jira-truncated">
          This page stops at the bridge's limit; the bound project has more issues than are listed here.
        </p>
      )}
    </>,
    freshness,
  );
}
