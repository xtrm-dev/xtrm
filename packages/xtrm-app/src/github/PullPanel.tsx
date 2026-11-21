import { usePull } from "../app/queries.ts";
import { checkLabel, checkTone, conversationUnavailable, mergeableText, parsePullRef, reviewLabel, usePrLinkedRefs } from "./pr.ts";
import { ReferenceActionsProvider, ReferenceChip } from "../refs/references.tsx";
import { useShell } from "../shell/context.tsx";
import { DetailTitle } from "../shell/detail-title.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { EmptyState, ErrorState, LoadingState, StatusDot, ago } from "../ui/primitives.tsx";
import { PrKey, PrStateChip } from "../ui/pr-key.tsx";
import { Fields, InspectorSection } from "../ui/drawer.tsx";
import { GithubPill } from "../ui/github-pill.tsx";
import { Icon } from "../ui/icon.tsx";
import { AuthorInline } from "./identity.tsx";
import { PullConversation } from "./PullConversation.tsx";

/** The full linked list, under the header (§4.5): the list column is the compact form of it. */
function LinkedIssues({ refs }: { refs: string[] }) {
  if (!refs.length) return <span className="text-ink-faint">None detected</span>;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-0.5">
      {refs.map((key) => (
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
  // Called before the early returns so the hook order never depends on the query state.
  const refs = usePrLinkedRefs(pull.data ?? null);

  if (!parsed) return <EmptyState icon="pull" title="Not a pull request reference" />;
  if (pull.isPending) return <LoadingState rows={6} label="Loading pull request" />;
  if (pull.isError) return <ErrorState title={`Could not read ${refValue}`} error={pull.error} />;
  const p = pull.data;

  const meta = (
    <>
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <PrStateChip state={p.state} draft={p.draft} />
        <span
          className="min-w-0 truncate font-mono text-xs text-ink-muted"
          title={`${p.headBranch ?? "unknown"} → ${p.baseBranch ?? "unknown"}`}
        >
          {p.headBranch ?? "unknown"} → {p.baseBranch ?? "unknown"}
        </span>
        <span
          className="shrink-0 tabular text-xs"
          title={p.additions === null && p.deletions === null ? "Diff counts unavailable from the source" : "Diff counts from the pull request"}
        >
          {p.additions === null && p.deletions === null ? (
            <span className="text-ink-faint">diff unknown</span>
          ) : (
            <>
              <span className="text-diff-add">+{p.additions ?? "?"}</span>{" "}
              <span className="text-diff-del">−{p.deletions ?? "?"}</span>
            </>
          )}
        </span>
        <span className="shrink-0 text-ink-faint">{p.changedFiles === null ? "files unknown" : `${p.changedFiles} files`}</span>
      </div>
      <p className="flex min-w-0 items-center gap-1.5 text-xs text-ink-faint">
        <AuthorInline login={p.author} />
        <span className="truncate">
          · opened {ago(p.createdAt)} · updated {ago(p.updatedAt)}
        </span>
      </p>
    </>
  );

  return (
    <ReferenceActionsProvider open={(r) => inspect(r)} repo={parsed.fullName}>
      <div data-testid="pull-header">
        <DetailTitle
          lead={<PrKey number={p.number} state={p.state} draft={p.draft} quiet className="shrink-0" />}
          aside={<GithubPill href={p.url} size="sm" variant="ghost" />}
          meta={meta}
        >
          {p.title}
        </DetailTitle>
      </div>

      <InspectorSection title="Linked Substrate issues">
        <LinkedIssues refs={refs} />
      </InspectorSection>

      <InspectorSection title="Overview">
        <Fields
          rows={[
            [
              "Checks",
              <span className="inline-flex items-center gap-1.5" key="checks">
                <StatusDot tone={checkTone(p.checks)} label={checkLabel(p.checks)} />
                {checkLabel(p.checks)}
              </span>,
            ],
            ["Review", reviewLabel(p.review)],
            ["Mergeable", mergeableText(p.mergeable, p.mergeableState) ?? <span className="text-ink-faint">—</span>],
            // Commits lost its home when Change left the Overview (§4.5); the count stays visible.
            ["Commits", p.commits === null ? <span className="text-ink-faint">commits unknown</span> : `${p.commits} commits`],
            ["Updated", ago(p.updatedAt)],
          ]}
        />
      </InspectorSection>

      {p.body && (
        <InspectorSection title="Description">
          <Markdown html>{p.body}</Markdown>
        </InspectorSection>
      )}

      <InspectorSection title={`Reviews${p.reviewCount === null ? " · unknown" : p.reviewCount ? ` · ${p.reviewCount}` : ""}`}>
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
                  <div className="border-l border-border-muted pl-3">
                    <Markdown html>{r.body}</Markdown>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-faint">{p.review === null ? "Review data unavailable from the source." : "No reviews yet."}</p>
        )}
      </InspectorSection>

      <InspectorSection title="Conversation">
        {conversationUnavailable(p.unavailableSections) ? (
          <p className="text-sm text-ink-faint">Conversation unavailable from the source.</p>
        ) : (
          <PullConversation comments={p.conversationComments} reviews={p.reviews} reviewComments={p.reviewComments} />
        )}
      </InspectorSection>

      <InspectorSection title={`Files changed${p.files.length ? ` · ${p.files.length}` : ""}`} aside={<span className="text-xs text-ink-faint tabular">summary only</span>}>
        {p.unavailableSections.includes("files") ? (
          <p className="text-sm text-ink-faint">File summary unavailable from the source.</p>
        ) : p.files.length ? (
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
