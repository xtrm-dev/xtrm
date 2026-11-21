import { useGithubIssue } from "../app/queries.ts";
import { parseGithubIssueRef, issueStateLabel, issueStateTone } from "./issues.ts";
import { ReferenceActionsProvider } from "../refs/references.tsx";
import { useShell } from "../shell/context.tsx";
import { Badge } from "../ui/badge.tsx";
import { Fields, InspectorSection } from "../ui/drawer.tsx";
import { GithubPill } from "../ui/github-pill.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { EmptyState, ErrorState, LoadingState, StatusDot, ago } from "../ui/primitives.tsx";
import { AuthorInline } from "./identity.tsx";

/** GitHub issue drawer: the repository's own tracker item, never an XTRM work contract. */
export function GithubIssuePanel({ refValue, follow }: { refValue: string; follow: boolean }) {
  const { inspect } = useShell();
  const parsed = parseGithubIssueRef(refValue);
  const issue = useGithubIssue(parsed?.fullName ?? "", parsed?.number ?? null, follow);

  if (!parsed) return <EmptyState icon="comment" title="Not a GitHub issue reference" />;
  if (issue.isPending) return <LoadingState rows={5} label="Loading GitHub issue" />;
  if (issue.isError) return <ErrorState title={`Could not read ${refValue}`} error={issue.error} />;
  const i = issue.data;

  return (
    <ReferenceActionsProvider open={(r) => inspect(r)} repo={parsed.fullName}>
      <div data-testid="github-issue-header" className="flex flex-col gap-1.5 px-5 pt-4 pb-3">
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <StatusDot tone={issueStateTone(i.state)} label={issueStateLabel(i.state)} />
          <span className="font-mono">#{i.number}</span>
          <span>·</span>
          <span>{issueStateLabel(i.state)}</span>
          <span className="ml-auto">{ago(i.updatedAt)}</span>
        </div>
        <div className="flex items-start gap-3">
          <h2 className="min-w-0 flex-1 text-base leading-snug font-medium text-pretty text-ink">{i.title}</h2>
          <GithubPill href={i.url} size="sm" />
        </div>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
          <AuthorInline login={i.author} />
          <span className="truncate">· {parsed.fullName}</span>
        </p>
      </div>

      <InspectorSection title="Overview">
        <Fields
          rows={[
            ["Author", <AuthorInline key="author" login={i.author} />],
            ["State", issueStateLabel(i.state)],
            ["Labels", i.labels.length ? <span className="flex flex-wrap gap-1">{i.labels.map((l) => <Badge key={l} size="sm">{l}</Badge>)}</span> : <span className="text-ink-faint">None</span>],
            ["Comments", <span className="tabular">{i.comments}</span>],
            ["Opened", ago(i.createdAt)],
            ["Closed", i.closedAt ? ago(i.closedAt) : <span className="text-ink-faint">—</span>],
          ]}
        />
      </InspectorSection>

      {i.body && (
        <InspectorSection title="Description">
          <Markdown html>{i.body}</Markdown>
        </InspectorSection>
      )}

      <InspectorSection title="Comments">
        <p className="text-sm text-ink-faint">
          {i.comments === 0 ? "No comments." : `${i.comments} on GitHub; the backend stores the count only.`}
        </p>
      </InspectorSection>
    </ReferenceActionsProvider>
  );
}
