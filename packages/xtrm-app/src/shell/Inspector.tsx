import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { RepoEvent } from "../adapters/index.tsx";
import { useEvents, useIssue, useProgram } from "../app/queries.ts";
import { useCanWrite } from "../issues/actions.ts";
import { IssueView } from "../issues/IssueView.tsx";
import { Drawer, Fields, InspectorSection } from "../ui/drawer.tsx";
import { Icon } from "../ui/icon.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { ContentPanel, EmptyState, ErrorState, IconButton, LoadingState, Row, ago } from "../ui/primitives.tsx";
import { useShell } from "./context.tsx";
import { formatRef, type DrawerRef } from "./layout.ts";

const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

const label = (s: string) => s.replace(/_/g, " ");

function Title({ eyebrow, children }: { eyebrow: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 pt-4 pb-3">
      <div className="flex items-center gap-2 text-xs text-ink-faint">{eyebrow}</div>
      <h2 className="text-base leading-snug font-medium text-pretty text-ink">{children}</h2>
    </div>
  );
}

// --- issue ------------------------------------------------------------------

function IssuePanel({ issueRef, follow }: { issueRef: string; follow: boolean }) {
  const { inspect } = useShell();
  const canWrite = useCanWrite();
  const q = useIssue(issueRef, follow);
  if (q.isPending) return <LoadingState rows={6} label="Loading issue" />;
  if (q.isError) return <ErrorState title={`Could not read ${issueRef}`} error={q.error} />;
  return <IssueView issue={q.data} canWrite={canWrite} variant="panel" nav={{ onOpenIssue: (ref) => inspect({ kind: "issue", ref }) }} />;
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
            ["Updated", item.updatedAt ? ago(item.updatedAt) : "—"],
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
            <span className="ml-auto">{ago(e.createdAt)}</span>
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

export function InspectorBody({ entity, follow }: { entity: DrawerRef | null; follow: boolean }) {
  if (!entity)
    return (
      <EmptyState icon="inspector" title="Nothing inspected">
        Select an issue, Program item, or activity event to inspect it here without leaving the current surface.
      </EmptyState>
    );
  switch (entity.kind) {
    case "issue":
      return <IssuePanel key={entity.ref} issueRef={entity.ref} follow={follow} />;
    case "program":
      return <ProgramPanel key={entity.ref} id={entity.ref} follow={follow} />;
    case "activity":
      return <ActivityPanel key={entity.ref} refValue={entity.ref} follow={follow} />;
  }
}

const KIND_LABEL: Record<DrawerRef["kind"], string> = { issue: "Issue", program: "Program", activity: "Activity" };

export function InspectorDrawer({ variant }: { variant: "overlay" | "column" | "maximized" }) {
  const { layout, dispatch, inspected, repo } = useShell();
  const navigate = useNavigate();
  const state = layout.inspector.state;
  const follow = layout.inspector.followLive;

  const header = (
    <>
      <IconButton icon="back" label="Back" disabled={layout.cursor <= 0} onClick={() => dispatch({ type: "drawer/back" })} />
      <IconButton icon="forward" label="Forward" disabled={layout.cursor >= layout.stack.length - 1} onClick={() => dispatch({ type: "drawer/forward" })} />
      <span className="ml-1 truncate text-sm font-medium text-ink" title={inspected ? KIND_LABEL[inspected.kind] : undefined}>
        Inspector
      </span>
      <div className="ml-auto flex items-center gap-0.5">
        {inspected?.kind === "issue" && (
          <button
            type="button"
            onClick={() => {
              void navigate({ to: `/rep/${repo.owner}/${repo.name}/work/issues/${inspected.ref}` } as never);
              dispatch({ type: "drawer/close" });
            }}
            className="mr-1 flex h-7 items-center gap-1.5 rounded-md border border-border-muted px-2 text-xs text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:border-border-strong"
          >
            <Icon name="open" size="xs" /> Open
          </button>
        )}
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
            { label: "Copy link", icon: "link", onSelect: () => copy(window.location.href) },
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
