import { useMemo, useState } from "react";
import { useAdapters } from "../adapters/index.tsx";
import { useRepoDocument, useRepoReport, useRepoReports } from "../app/queries.ts";
import { ReferenceActionsProvider } from "../refs/references.tsx";
import { useShell } from "../shell/context.tsx";
import { Icon } from "../ui/icon.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { EmptyState, ErrorState, LoadingState, Row, SourceBadge, SurfaceHeader, ago, cx } from "../ui/primitives.tsx";

/** The backend serves only these two repository paths; anything else is rejected there. */
const DOCS = [
  { id: "README.md", label: "README" },
  { id: "CHANGELOG.md", label: "CHANGELOG" },
] as const;

type Selection = { kind: "doc"; path: string } | { kind: "report"; name: string };

/** Session reports open with YAML frontmatter; it is metadata, not prose, so it renders as fields. */
export function splitFrontmatter(raw: string): { fields: Array<[string, string]>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { fields: [], body: raw };
  const fields = m[1]!
    .split(/\r?\n/)
    .map((line) => /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line))
    .filter((x): x is RegExpExecArray => !!x)
    .map((x) => [x[1]!, x[2]!.trim()] as [string, string]);
  return { fields, body: raw.slice(m[0].length) };
}

function DocumentBody({ content, empty }: { content: string | null | undefined; empty: string }) {
  if (content === undefined) return <LoadingState label="Loading document" />;
  if (!content?.trim()) return <EmptyState icon="file" title={empty} />;
  const { fields, body } = splitFrontmatter(content);
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-5">
      {fields.length > 0 && (
        <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-border-muted px-3 py-2 text-xs">
          {fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-ink-faint">{k}</dt>
              <dd className="min-w-0 break-words text-ink">{v || <span className="text-ink-faint">—</span>}</dd>
            </div>
          ))}
        </dl>
      )}
      <Markdown>{body}</Markdown>
    </div>
  );
}

/** README, CHANGELOG and session reports, rendered with the shared Markdown component. */
export function ContentSurface() {
  const { repo, inspect } = useShell();
  const { github } = useAdapters();
  const [selection, setSelection] = useState<Selection>({ kind: "doc", path: "README.md" });
  const reports = useRepoReports(repo.fullName);
  const doc = useRepoDocument(repo.fullName, selection.kind === "doc" ? selection.path : null);
  const report = useRepoReport(repo.fullName, selection.kind === "report" ? selection.name : null);

  const active = selection.kind === "doc" ? doc : report;
  const title = selection.kind === "doc" ? (DOCS.find((d) => d.id === selection.path)?.label ?? selection.path) : selection.name;
  const reportRows = useMemo(() => reports.data ?? [], [reports.data]);

  let body;
  if (active.isError) body = <ErrorState title={`Could not read ${title}`} error={active.error} />;
  else
    body = (
      <ReferenceActionsProvider open={(r) => inspect(r)}>
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
          <DocumentBody
            content={active.isPending ? undefined : (active.data?.content ?? null)}
            empty={selection.kind === "doc" ? `${title} is not present in ${repo.fullName}` : `${title} is empty`}
          />
        </div>
      </ReferenceActionsProvider>
    );

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Repository content">
      <SurfaceHeader
        title="Repository content"
        meta={
          <>
            <span>{repo.fullName}</span>
            <SourceBadge source={github.source} />
            {active.data?.lastModified && <span title={new Date(active.data.lastModified).toLocaleString()}>updated {ago(active.data.lastModified)}</span>}
          </>
        }
      >
        <OptionsMenu
          label="Content options"
          items={[
            { label: "Refresh", icon: "live", onSelect: () => void active.refetch() },
            {
              label: "Open on GitHub",
              icon: "external",
              onSelect: () =>
                void window.open(
                  selection.kind === "doc" ? `https://github.com/${repo.fullName}/blob/HEAD/${selection.path}` : `https://github.com/${repo.fullName}/blob/HEAD/.xtrm/reports/${selection.name}`,
                  "_blank",
                  "noreferrer",
                ),
            },
          ]}
        />
      </SurfaceHeader>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Documents" className="flex w-56 shrink-0 flex-col border-r border-border-muted">
          <div className="flex flex-col p-1.5">
            {DOCS.map((d) => (
              <Row
                key={d.id}
                density="sidebar"
                selected={selection.kind === "doc" && selection.path === d.id}
                onActivate={() => setSelection({ kind: "doc", path: d.id })}
              >
                <Icon name="file" size="xs" className="shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1 truncate">{d.label}</span>
              </Row>
            ))}
          </div>
          <div className="flex min-h-0 flex-1 flex-col border-t border-border-muted">
            <span className="px-3 pt-2 pb-1 text-xs font-medium text-ink-faint">
              Reports {reportRows.length > 0 && <span className="tabular">{reportRows.length}</span>}
            </span>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5 pt-0">
              {reports.isPending && <span className="px-2 text-xs text-ink-faint">Loading…</span>}
              {reports.isError && <span className="px-2 text-xs text-ink-faint">Reports unavailable</span>}
              {!reports.isPending && !reports.isError && !reportRows.length && <span className="px-2 text-xs text-ink-faint">No session reports</span>}
              {reportRows.map((r) => (
                <Row key={r.name} density="sidebar" selected={selection.kind === "report" && selection.name === r.name} onActivate={() => setSelection({ kind: "report", name: r.name })}>
                  <Icon name="file" size="xs" className="shrink-0 text-ink-faint" />
                  <span className={cx("min-w-0 flex-1 truncate font-mono text-xs")} title={r.path}>
                    {r.name.replace(/\.md$/, "")}
                  </span>
                </Row>
              ))}
            </div>
          </div>
        </nav>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</div>
      </div>
    </section>
  );
}
