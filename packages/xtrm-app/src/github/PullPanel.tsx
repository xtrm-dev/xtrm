import { useMemo } from "react";
import { usePull } from "../app/queries.ts";
import { checkLabel, checkTone, extractIssueKeys, parsePullRef, pullStateLabel, pullStateTone, reviewLabel } from "./pr.ts";
import { ReferenceActionsProvider, ReferenceChip, useIssueIndex } from "../refs/references.tsx";
import { useShell } from "../shell/context.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { EmptyState, ErrorState, LoadingState, StatusDot, ago } from "../ui/primitives.tsx";
import { Fields, InspectorSection } from "../ui/drawer.tsx";
import { GithubPill } from "../ui/github-pill.tsx";
import { Icon } from "../ui/icon.tsx";
import { AuthorInline } from "./identity.tsx";
import { PullConversation } from "./PullConversation.tsx";

function LinkedIssues({ title, branch, body }: { title: string; branch: string; body: string | null }) {
  const index = useIssueIndex();
  const keys = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const key of extractIssueKeys(title, branch, body)) {
      const resolved = index.get(key)?.ref ?? key;
      if (!seen.has(resolved)) {
        seen.add(resolved);
        out.push(key);
      }
    }
    return out;
  }, [title, branch, body, index]);
  if (!keys.length) return <span className="text-ink-faint">None detected</span>;
  return (
    <span className="flex flex-wrap items-center gap-0.5">
      {keys.map((key) => (
        <ReferenceChip key={key} reference={{ kind: "issue", ref: key }} showTitle />
      ))}
    </span>
  );
}

/** PR drawer panel: overview, checks, reviews, conversation, files-changed summary, linked Substrate issues. */
export function PullPanel({ refValue, follow }: { refValue: string; follow: boolean }) {
  const { inspect } = useShell();
  const parsed = parsePullRef(refValue);
  const pull = usePull(parsed?.fullName ?? "", parsed?.number ?? null, follow);

  if (!parsed) return <EmptyState icon="pull" title="Not a pull request reference" />;
  if (pull.isPending) return <LoadingState rows={6} label="Loading pull request" />;
  if (pull.isError) return <ErrorState title={`Could not read ${refValue}`} error={pull.error} />;
  const p = pull.data;

  return (
    <ReferenceActionsProvider open={(r) => inspect(r)}>
      <div data-testid="pull-header" className="flex flex-col gap-1.5 px-5 pt-4 pb-3">
        <div className="flex items-center gap-2 text-xs text-ink-faint">
          <StatusDot tone={pullStateTone(p.state)} label={pullStateLabel(p.state, p.draft)} />
          <span className="font-mono">#{p.number}</span>
          <span>·</span>
          <span>{pullStateLabel(p.state, p.draft)}</span>
          {p.draft && (
            <>
              <span>·</span>
              <span>draft</span>
            </>
          )}
          <span className="ml-auto">{ago(p.updatedAt)}</span>
        </div>
        <div className="flex items-start gap-3">
          <h2 className="min-w-0 flex-1 text-base leading-snug font-medium text-pretty text-ink">{p.title}</h2>
          <GithubPill href={p.url} size="sm" />
        </div>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
          <AuthorInline login={p.author} />
          <span className="truncate">· {p.headBranch} → {p.baseBranch}</span>
        </p>
      </div>

      <InspectorSection title="Overview">
        <Fields
          rows={[
            ["Author", <AuthorInline key="author" login={p.author} />],
            ["Branch", `${p.headBranch} → ${p.baseBranch}`],
            [
              "Checks",
              <span className="inline-flex items-center gap-1.5" key="checks">
                <StatusDot tone={checkTone(p.checks)} label={checkLabel(p.checks)} />
                {checkLabel(p.checks)}
              </span>,
            ],
            ["Review", reviewLabel(p.review)],
            [
              "Mergeable",
              p.mergeableState ? `${p.mergeable === false ? "conflicts" : p.mergeable === true ? "mergeable" : "unknown"} · ${p.mergeableState}` : <span className="text-ink-faint">—</span>,
            ],
            [
              "Change",
              <span className="tabular" key="change">
                <span className="text-diff-add">+{p.additions}</span> <span className="text-diff-del">−{p.deletions}</span>
                <span className="text-ink-faint"> · {p.changedFiles} files · {p.commits} commits</span>
              </span>,
            ],
            ["Updated", ago(p.updatedAt)],
          ]}
        />
      </InspectorSection>

      <InspectorSection title="Linked Substrate issues">
        <LinkedIssues title={p.title} branch={p.headBranch} body={p.body} />
      </InspectorSection>

      {p.body && (
        <InspectorSection title="Description">
          <div className="rounded-md border border-border-muted px-3 py-2">
            <Markdown html>{p.body}</Markdown>
          </div>
        </InspectorSection>
      )}

      <InspectorSection title={`Reviews${p.reviews.length ? ` · ${p.reviews.length}` : ""}`}>
        {p.reviews.length ? (
          <ul className="flex flex-col gap-3">
            {p.reviews.map((r) => (
              <li key={r.id} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <Icon name="comment" size="xs" className="shrink-0 text-ink-faint" />
                  <AuthorInline login={r.author} />
                  <span className="text-ink-faint">{reviewLabel(r.state)}</span>
                  {r.submittedAt && (
                    <span className="ml-auto text-xs text-ink-faint tabular" title={new Date(r.submittedAt).toLocaleString()}>
                      {ago(r.submittedAt)}
                    </span>
                  )}
                </div>
                {r.body?.trim() && (
                  <div className="ml-5 rounded-md border border-border-muted px-3 py-2">
                    <Markdown html>{r.body}</Markdown>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-faint">No reviews yet.</p>
        )}
      </InspectorSection>

      <InspectorSection title="Conversation">
        <PullConversation comments={p.conversationComments} reviews={p.reviews} reviewComments={p.reviewComments} />
      </InspectorSection>

      <InspectorSection title={`Files changed${p.files.length ? ` · ${p.files.length}` : ""}`} aside={<span className="text-xs text-ink-faint tabular">summary only</span>}>
        {p.files.length ? (
          <ul className="flex flex-col">
            {p.files.slice(0, 30).map((f) => (
              <li key={f.filename} className="flex min-w-0 items-center gap-2 py-0.5 text-sm">
                <Icon name="file" size="xs" className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{f.filename}</span>
                <span className="shrink-0 text-xs tabular">
                  <span className="text-diff-add">+{f.additions}</span> <span className="text-diff-del">−{f.deletions}</span>
                </span>
              </li>
            ))}
            {p.files.length > 30 && <li className="py-1 text-xs text-ink-faint">+{p.files.length - 30} more files — open on GitHub for the full diff.</li>}
          </ul>
        ) : (
          <p className="text-sm text-ink-faint">No file summary for this pull request.</p>
        )}
      </InspectorSection>
    </ReferenceActionsProvider>
  );
}
