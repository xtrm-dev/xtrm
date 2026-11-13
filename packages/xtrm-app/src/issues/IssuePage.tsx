import { useNavigate, useParams } from "@tanstack/react-router";
import { projectForRepo, useIssue, useProjects } from "../app/queries.ts";
import { useShell } from "../shell/context.tsx";
import { Breadcrumbs } from "../ui/breadcrumbs.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { ErrorState, LoadingState } from "../ui/primitives.tsx";
import { useCanWrite } from "./actions.ts";
import { IssueView } from "./IssueView.tsx";
import { IssueKey } from "./meta.tsx";

const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

/** Full Jira-style issue view: `/rep/:owner/:repo/work/issues/:issueRef`. */
export function IssuePage() {
  const { issueRef } = useParams({ strict: false }) as { issueRef: string };
  const { repo, inspect } = useShell();
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const projects = useProjects();
  const project = projectForRepo(projects.data, repo);
  const q = useIssue(issueRef, false, project?.id);
  const listHref = `/rep/${repo.owner}/${repo.name}/work/issues`;

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={`Issue ${issueRef}`}>
      <header className="flex h-11 shrink-0 items-center gap-2 border-b border-border-muted px-4">
        <Breadcrumbs
          className="text-sm"
          items={[
            { key: "issues", icon: "back", label: "Issues", onClick: () => void navigate({ to: listHref } as never) },
            { key: "self", label: <IssueKey locator={null} humanRef={issueRef} />, title: q.data?.locator ?? issueRef },
          ]}
        />
        <div className="ml-auto flex items-center gap-1">
          <OptionsMenu
            label="Issue options"
            items={[
              { label: "Open in inspector", icon: "inspector", onSelect: () => inspect({ kind: "issue", ref: issueRef }) },
              { label: "Copy reference", icon: "copy", onSelect: () => copy(`@issue:${issueRef}`) },
              { label: "Copy link", icon: "link", onSelect: () => copy(window.location.href) },
              { label: "Copy sb command", icon: "command", onSelect: () => copy(`sb issue show ${issueRef}`) },
              { label: "Refresh", icon: "live", onSelect: () => void q.refetch() },
            ]}
          />
        </div>
      </header>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        {q.isPending ? (
          <LoadingState rows={10} label="Loading issue" />
        ) : q.isError ? (
          <ErrorState title={`Could not read ${issueRef}`} error={q.error} />
        ) : (
          <IssueView issue={q.data} canWrite={canWrite} variant="page" nav={{ onOpenIssue: (ref) => void navigate({ to: `${listHref}/${ref}` } as never), onOpenPull: (ref) => inspect({ kind: "pr", ref }) }} />
        )}
      </div>
    </section>
  );
}
