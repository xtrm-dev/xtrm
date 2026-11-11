import { useAdapters, type ProgramItem, type ProgramItemKind } from "../adapters/index.tsx";
import { useProgram } from "../app/queries.ts";
import { useShell } from "../shell/context.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { ErrorState, LoadingState, Row, SourceBadge, StatusDot, SurfaceToolbar, relativeTime, type Tone } from "../ui/primitives.tsx";

const SECTIONS: Array<[ProgramItemKind, string]> = [
  ["workstream", "Workstreams"],
  ["assignment", "Assignments"],
  ["decision", "Decisions"],
];

function statusTone(status: string): Tone {
  if (["active", "in_flight", "accepted"].includes(status)) return "active";
  if (["done", "closed", "superseded"].includes(status)) return "done";
  if (["proposed", "planned"].includes(status)) return "muted";
  return "neutral";
}

/** Governance projection: references executable work, never duplicates its state (PRD §9, §34.7). */
export function ProgramSurface({ repoScoped }: { repoScoped?: boolean }) {
  const { inspect, inspected, repo } = useShell();
  const { program } = useAdapters();
  const q = useProgram();

  let body;
  if (q.isPending) body = <LoadingState label="Loading Program" />;
  else if (q.isError) body = <ErrorState title="Program read model unavailable" error={q.error} />;
  else {
    const view = q.data;
    body = (
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-6">
          {view.now && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-faint">Now{view.now.evidenceCutoff && ` · evidence to ${view.now.evidenceCutoff}`}</span>
              <p className="text-base text-ink">{view.now.title}</p>
            </div>
          )}
          {repoScoped && <p className="text-xs text-ink-faint">Program is cross-repository. Snapshot v3 carries no repository key, so {repo.name} shows the full Program.</p>}
          {SECTIONS.map(([kind, label]) => {
            const items = view.items.filter((i) => i.kind === kind);
            return (
              <section key={kind} id={`program-${kind}`} className="flex scroll-mt-4 flex-col gap-1" aria-label={label}>
                <h2 className="px-3 text-xs font-medium text-ink-faint">
                  {label} <span className="tabular">{items.length}</span>
                </h2>
                {items.length ? (
                  items.map((item) => (
                    <ProgramRow key={item.id} item={item} selected={inspected?.kind === "program" && inspected.ref === item.id} onOpen={() => inspect({ kind: "program", ref: item.id })} />
                  ))
                ) : (
                  <p className="px-3 text-sm text-ink-faint">None</p>
                )}
              </section>
            );
          })}
          <section id="program-activity" className="flex scroll-mt-4 flex-col gap-1" aria-label="Program activity">
            <h2 className="px-3 text-xs font-medium text-ink-faint">Recent changes</h2>
            {view.activity.map((a) => (
              <Row key={a.sha} density="list" onActivate={() => void window.open(a.url, "_blank", "noreferrer")}>
                <span className="w-16 shrink-0 font-mono text-xs text-ink-faint">{a.sha.slice(0, 7)}</span>
                <span className="min-w-0 flex-1 truncate text-ink-muted">{a.subject}</span>
                <span className="shrink-0 text-xs text-ink-faint">{a.date}</span>
              </Row>
            ))}
          </section>
          <p className="border-t border-border-muted pt-4 text-xs text-ink-faint">
            Program is a governance projection. Executable work, readiness, and claims live in Substrate Issues and are only referenced here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Program">
      <SurfaceToolbar>
        {q.data && (
          <span className="truncate text-[11px] text-ink-faint">
            {q.data.source.repository}@<span className="font-mono">{q.data.source.shortSha ?? "?"}</span> · {q.data.freshness}
          </span>
        )}
        <SourceBadge source={program.source} />
        <div className="ml-auto" />
        <OptionsMenu label="Program options" items={[{ label: "Refresh snapshot", icon: "live", onSelect: () => void q.refetch() }]} />
      </SurfaceToolbar>
      {body}
    </section>
  );
}

function ProgramRow({ item, selected, onOpen }: { item: ProgramItem; selected: boolean; onOpen: () => void }) {
  return (
    <Row selected={selected} onActivate={onOpen}>
      <StatusDot tone={statusTone(item.status)} label={item.status} />
      <span className="w-16 shrink-0 font-mono text-xs text-ink-faint">{item.id}</span>
      <span className="min-w-0 flex-1 truncate text-ink">{item.title}</span>
      {item.issueRefs.length > 0 && <span className="shrink-0 text-xs text-ink-faint">{item.issueRefs.length} refs</span>}
      <span className="w-20 shrink-0 text-right text-xs text-ink-faint">{item.status.replace(/_/g, " ")}</span>
      <span className="w-8 shrink-0 text-right text-xs text-ink-faint tabular">{relativeTime(item.updatedAt)}</span>
    </Row>
  );
}

