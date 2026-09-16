import type { ReactNode } from "react";
import type { IssueDetail, RepoEvent } from "../adapters/index.tsx";
import { useEvents, useIssue, useProgram } from "../app/queries.ts";
import { Drawer, Fields, InspectorSection } from "../ui/drawer.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { ContentPanel, EmptyState, ErrorState, IconButton, LoadingState, Row, StatusDot, relativeTime, type Tone } from "../ui/primitives.tsx";
import { useShell } from "./context.tsx";
import { formatRef, type DrawerRef } from "./layout.ts";

const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

export function lifecycleTone(lifecycle: string): Tone {
  switch (lifecycle) {
    case "in_progress":
    case "in_review":
      return "active";
    case "done":
      return "done";
    case "cancelled":
    case "archived":
    case "deferred":
      return "muted";
    case "blocked":
      return "danger";
    default:
      return "neutral";
  }
}

const label = (s: string) => s.replace(/_/g, " ");

function List({ items, empty = "None recorded" }: { items: string[]; empty?: string }) {
  if (!items.length) return <p className="text-sm text-ink-faint">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1 text-sm text-ink">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-ink-faint" />
          <span className="min-w-0 break-words">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function Title({ eyebrow, children }: { eyebrow: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 pt-4 pb-3">
      <div className="flex items-center gap-2 text-xs text-ink-faint">{eyebrow}</div>
      <h2 className="text-base leading-snug font-medium text-pretty text-ink">{children}</h2>
    </div>
  );
}

// --- issue ------------------------------------------------------------------

function IssueReadiness({ issue }: { issue: IssueDetail }) {
  return (
    <InspectorSection title="Readiness">
      <div className="flex items-center gap-2 text-sm">
        <StatusDot tone={issue.dispatchable ? "accent" : "neutral"} label={issue.readinessState} />
        <span className="text-ink">{label(issue.readinessState)}</span>
        <span className="text-ink-faint">{issue.dispatchable ? "· dispatchable" : "· not dispatchable"}</span>
      </div>
      {issue.reasons.length > 0 && <List items={issue.reasons} />}
    </InspectorSection>
  );
}

function IssuePanel({ ref: issueRef, follow }: { ref: string; follow: boolean }) {
  const q = useIssue(issueRef, follow);
  if (q.isPending) return <LoadingState rows={6} label="Loading issue" />;
  if (q.isError) return <ErrorState title={`Could not read ${issueRef}`} error={q.error} />;
  const issue = q.data;
  const c = issue.contract;
  return (
    <>
      <Title
        eyebrow={
          <>
            <StatusDot tone={lifecycleTone(issue.lifecycle)} label={issue.lifecycle} />
            <span className="font-mono">{issue.ref}</span>
            <span>·</span>
            <span>{label(issue.lifecycle)}</span>
            <span>·</span>
            <span>{issue.kind}</span>
            <span className="ml-auto tabular">rev {issue.revision}</span>
          </>
        }
      >
        {issue.title}
      </Title>
      <IssueReadiness issue={issue} />
      <InspectorSection title="Contract">
        <div className="flex flex-col gap-4">
          <Prose title="Problem" text={c.problem} />
          <Prose title="Success" text={c.success} />
          <ContractList title="Scope" items={c.scope} />
          <ContractList title="Non-goals" items={c.nonGoals} />
          <ContractList title="Constraints" items={c.constraints} />
          <ContractList title="Validation" items={c.validation} />
          <ContractList title="Output" items={c.output} />
        </div>
      </InspectorSection>
      <InspectorSection title="Execution">
        <Fields
          rows={[
            ["Claim", issue.claim ? `${issue.claim.holder} · expires in ${relativeTime(Date.now(), issue.claim.expiresAt ?? undefined)}` : <span className="text-ink-faint">unclaimed</span>],
            ["Closure", issue.closure.closed ? `${issue.closure.reason ?? "closed"} · ${relativeTime(issue.closure.closedAt)} ago` : <span className="text-ink-faint">open</span>],
            ["Provenance", `${issue.provenance.eventCount} events${issue.provenance.lastEventType ? ` · last ${issue.provenance.lastEventType}` : ""}`],
          ]}
        />
      </InspectorSection>
      <p className="px-5 pb-5 text-xs text-ink-faint">Read-only projection. Claims and lifecycle changes go through Substrate authority, not this prototype.</p>
    </>
  );
}

// Contract fields hold long prose: label above value keeps a readable measure.
function Prose({ title, text }: { title: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-ink-faint">{title}</span>
      <p className="text-sm leading-6 text-pretty whitespace-pre-line text-ink">{text || <span className="text-ink-faint">—</span>}</p>
    </div>
  );
}

function ContractList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-ink-faint">{title}</span>
      <List items={items} empty="—" />
    </div>
  );
}

// --- program ----------------------------------------------------------------

function ProgramPanel({ id, follow }: { id: string; follow: boolean }) {
  const { inspect } = useShell();
  const q = useProgram(follow);
  if (q.isPending) return <LoadingState rows={5} label="Loading program item" />;
  if (q.isError) return <ErrorState title="Program read model unavailable" error={q.error} />;
  const item = q.data.items.find((i) => i.id === id);
  if (!item) return <EmptyState icon="program" title={`${id} is not in the current Program snapshot`} />;
  return (
    <>
      <Title
        eyebrow={
          <>
            <span className="font-mono">{item.id}</span>
            <span>·</span>
            <span>{item.kind}</span>
            <span>·</span>
            <span>{label(item.status)}</span>
          </>
        }
      >
        {item.title}
      </Title>
      <InspectorSection title="Governance">
        <Fields
          rows={[
            ["Status", label(item.status)],
            ["Record", <span className="font-mono text-xs">{item.path}</span>],
            ["Updated", item.updatedAt ? `${relativeTime(item.updatedAt)} ago` : "—"],
            ["Jira", item.jiraRefs.length ? item.jiraRefs.join(", ") : <span className="text-ink-faint">—</span>],
            ["Snapshot", `${q.data.source.repository}@${q.data.source.shortSha ?? "?"}`],
          ]}
        />
      </InspectorSection>
      <InspectorSection title="Executable work">
        {item.issueRefs.length ? (
          <div className="-mx-2 flex flex-col">
            {item.issueRefs.map((ref) => (
              <Row key={ref} density="sidebar" onActivate={() => inspect({ kind: "issue", ref })}>
                <Icon name="issues" size="xs" className="text-ink-faint" />
                <span className="font-mono text-xs text-accent-ink">@issue:{ref}</span>
                <Icon name="forward" size="xs" className="ml-auto text-ink-faint" />
              </Row>
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-faint">No typed references to executable work.</p>
        )}
        <p className="text-xs text-ink-faint">Program references issues; their state is read from Substrate when opened, never copied here.</p>
      </InspectorSection>
    </>
  );
}

// --- activity ---------------------------------------------------------------

export function eventTitle(e: RepoEvent): string {
  if (e.title) return e.title;
  switch (e.kind) {
    case "delete":
      return e.branch ? `Deleted ${e.branch}` : "Deleted a branch or tag";
    case "create":
      return e.branch ? `Created ${e.branch}` : "Created a branch or tag";
    case "push":
      return `Pushed ${e.commitCount ?? ""} commit${e.commitCount === 1 ? "" : "s"}${e.branch ? ` to ${e.branch}` : ""}`;
    default:
      return e.rawType.replace(/Event$/, "");
  }
}

/** Activity refs are `<owner>/<repo>:<event id>`. */
export const activityRef = (e: RepoEvent) => `${e.repo}:${e.id}`;

function ActivityPanel({ refValue, follow }: { refValue: string; follow: boolean }) {
  const i = refValue.lastIndexOf(":");
  const repo = refValue.slice(0, i);
  const id = refValue.slice(i + 1);
  const q = useEvents(repo, follow);
  if (q.isPending) return <LoadingState rows={4} label="Loading event" />;
  if (q.isError) return <ErrorState title="GitHub backend unavailable" error={q.error} />;
  const e = q.data.find((x) => x.id === id);
  if (!e) return <EmptyState icon="activity" title="Event is outside the loaded window" />;
  return (
    <>
      <Title
        eyebrow={
          <>
            <span>{e.rawType.replace(/Event$/, "")}</span>
            {e.action && (
              <>
                <span>·</span>
                <span>{e.action}</span>
              </>
            )}
            <span className="ml-auto">{relativeTime(e.createdAt)} ago</span>
          </>
        }
      >
        {eventTitle(e)}
      </Title>
      <InspectorSection title="Event">
        <Fields
          rows={[
            ["Repository", e.repo],
            ["Actor", e.actor],
            ["Branch", e.branch ?? <span className="text-ink-faint">—</span>],
            [
              "Change",
              e.additions != null ? (
                <span className="tabular">
                  <span className="text-diff-add">+{e.additions}</span> <span className="text-diff-del">−{e.deletions ?? 0}</span>
                  {e.changedFiles != null && <span className="text-ink-faint"> · {e.changedFiles} files</span>}
                </span>
              ) : (
                <span className="text-ink-faint">—</span>
              ),
            ],
            ["At", new Date(e.createdAt).toLocaleString()],
          ]}
        />
      </InspectorSection>
      {e.body && (
        <InspectorSection title="Body">
          <ContentPanel className="whitespace-pre-wrap">{e.body}</ContentPanel>
        </InspectorSection>
      )}
      {e.url && (
        <InspectorSection title="Links">
          <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-accent-ink hover:underline">
            Open on GitHub <Icon name="external" size="xs" />
          </a>
        </InspectorSection>
      )}
    </>
  );
}

// --- drawer host ------------------------------------------------------------

function refTitle(ref: DrawerRef) {
  return ref.kind === "activity" ? "Activity" : ref.ref;
}

export function InspectorBody({ entity, follow }: { entity: DrawerRef | null; follow: boolean }) {
  if (!entity)
    return (
      <EmptyState icon="inspector" title="Nothing inspected">
        Select an issue, Program item, or activity event to inspect it here without leaving the current surface.
      </EmptyState>
    );
  switch (entity.kind) {
    case "issue":
      return <IssuePanel key={entity.ref} ref={entity.ref} follow={follow} />;
    case "program":
      return <ProgramPanel key={entity.ref} id={entity.ref} follow={follow} />;
    case "activity":
      return <ActivityPanel key={entity.ref} refValue={entity.ref} follow={follow} />;
  }
}

export function InspectorDrawer({ variant }: { variant: "overlay" | "column" | "maximized" }) {
  const { layout, dispatch, inspected } = useShell();
  const state = layout.inspector.state;
  const follow = layout.inspector.followLive;
  const link = () => copy(window.location.href);

  const header = (
    <>
      <IconButton icon="back" label="Back" disabled={layout.cursor <= 0} onClick={() => dispatch({ type: "drawer/back" })} />
      <IconButton icon="forward" label="Forward" disabled={layout.cursor >= layout.stack.length - 1} onClick={() => dispatch({ type: "drawer/forward" })} />
      <nav aria-label="Inspector trail" className="ml-1 flex min-w-0 items-center gap-1 text-sm">
        {layout.stack.slice(Math.max(0, layout.cursor - 1), layout.cursor + 1).map((r, i, arr) => (
          <span key={`${formatRef(r)}-${i}`} className="flex min-w-0 items-center gap-1">
            {i > 0 && <span className="text-ink-faint">/</span>}
            <span className={i === arr.length - 1 ? "truncate text-ink" : "truncate text-ink-faint"}>{refTitle(r)}</span>
          </span>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-0.5">
        <IconButton icon="live" label={follow ? "Following live updates" : "Follow live updates"} active={follow} aria-pressed={follow} onClick={() => dispatch({ type: "drawer/followLive" })} />
        {state !== "MAXIMIZED" && (
          <IconButton
            icon={state === "PINNED" ? "unpin" : "pin"}
            label={state === "PINNED" ? "Unpin drawer" : "Pin drawer"}
            aria-pressed={state === "PINNED"}
            onClick={() => dispatch({ type: state === "PINNED" ? "drawer/unpin" : "drawer/pin" })}
          />
        )}
        <IconButton
          icon={state === "MAXIMIZED" ? "restore" : "maximize"}
          label={state === "MAXIMIZED" ? "Restore drawer" : "Maximize drawer"}
          onClick={() => dispatch({ type: state === "MAXIMIZED" ? "drawer/restore" : "drawer/maximize" })}
        />
        <OptionsMenu
          label="Entity options"
          header={inspected ? formatRef(inspected) : undefined}
          items={[
            { label: "Copy reference", icon: "copy", disabled: !inspected, onSelect: () => inspected && copy(`@${formatRef(inspected)}`) },
            { label: "Copy link", icon: "link", onSelect: link },
            ...(inspected?.kind === "issue" ? [{ label: "Copy sb command", icon: "command" as const, onSelect: () => copy(`sb issue show ${inspected.ref}`) }] : []),
          ]}
        />
        <IconButton icon="close" label="Close drawer" shortcut="Esc" onClick={() => dispatch({ type: "drawer/close" })} />
      </div>
    </>
  );

  return (
    <Drawer variant={variant} header={header} label="Inspector">
      <InspectorBody entity={inspected} follow={follow} />
    </Drawer>
  );
}
