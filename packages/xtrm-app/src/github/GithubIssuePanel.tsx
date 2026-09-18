import { useGithubIssue } from "../app/queries.ts";
import { parseGithubIssueRef, issueStateLabel, issueStateTone } from "./issues.ts";
import { ReferenceActionsProvider } from "../refs/references.tsx";
import { useShell } from "../shell/context.tsx";
import { Fields, InspectorSection } from "../ui/drawer.tsx";
import { Icon } from "../ui/icon.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { EmptyState, ErrorState, LoadingState, StatusDot, ago } from "../ui/primitives.tsx";

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
    <ReferenceActionsProvider open={(r) => inspect(r)}>
      <div className="flex flex-col gap-1.5 px-5 pt-4 pb-3">
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <StatusDot tone={issueStateTone(i.state)} label={issueStateLabel(i.state)} />
          <span className="font-mono">#{i.number}</span>
          <span>·</span>
          <span>{issueStateLabel(i.state)}</span>
          <span className="ml-auto">{ago(i.updatedAt)}</span>
        </div>
        <h2 className="text-base leading-snug font-medium text-pretty text-ink">{i.title}</h2>
        <p className="text-xs text-ink-faint">
          {i.author} · {parsed.fullName}
        </p>
      </div>

      <InspectorSection title="Overview">
        <Fields
          rows={[
            ["Author", i.author],
            ["State", issueStateLabel(i.state)],
            ["Labels", i.labels.length ? <span className="flex flex-wrap gap-1">{i.labels.map((l) => <span key={l} className="rounded-sm bg-control px-1.5 py-px text-xs text-ink-muted">{l}</span>)}</span> : <span className="text-ink-faint">None</span>],
            ["Comments", <span className="tabular">{i.comments}</span>],
            ["Opened", ago(i.createdAt)],
            ["Closed", i.closedAt ? ago(i.closedAt) : <span className="text-ink-faint">—</span>],
          ]}
        />
      </InspectorSection>

      {i.body && (
        <InspectorSection title="Description">
          <div className="rounded-md border border-border-muted px-3 py-2">
            <Markdown>{i.body}</Markdown>
          </div>
        </InspectorSection>
      )}

      <InspectorSection title="Comments">
        <p className="text-sm text-ink-faint">
          {i.comments === 0 ? "No comments." : `${i.comments} on GitHub; the backend stores the count only.`}
        </p>
      </InspectorSection>

      <InspectorSection title="Links">
        <a href={i.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-accent-ink hover:underline">
          Open on GitHub <Icon name="external" size="xs" />
        </a>
      </InspectorSection>
    </ReferenceActionsProvider>
  );
}
