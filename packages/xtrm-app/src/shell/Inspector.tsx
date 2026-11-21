import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { RefKind, RepoEvent } from "../adapters/index.tsx";
import { HostRefPanel, SessionPanel } from "../agent/DrawerPanels.tsx";
import { useAgentStore } from "../agent/workspace.tsx";
import { readAccounting, readVersionRef } from "../adapters/research/manifest.ts";
import { useEvents, useIssue, useResearchMetrics, useResearchRun, useResearchSamples, useResearchTail } from "../app/queries.ts";
import { GithubIssuePanel } from "../github/GithubIssuePanel.tsx";
import { PullPanel } from "../github/PullPanel.tsx";
import { DevicePanel } from "../github/auth.tsx";
import { useCanWrite } from "../issues/actions.ts";
import { IssueView } from "../issues/IssueView.tsx";
import { Drawer, Fields, InspectorSection } from "../ui/drawer.tsx";
import { GithubPill } from "../ui/github-pill.tsx";
import { OptionsMenu } from "../ui/menu.tsx";
import { ContentPanel, EmptyState, ErrorState, IconButton, LoadingState, Row, ago } from "../ui/primitives.tsx";
import { MetricFields, UsageFields } from "../surfaces/research-format.tsx";
import { DetailTitle } from "./detail-title.tsx";
import { ToolbarButton } from "../ui/toolbar.tsx";
import { useShell } from "./context.tsx";
import { formatRef, type DrawerRef } from "./layout.ts";

/** `research-*` refs are `<runId>|<detail>`: `|` never occurs in a run/sample id
 * (SAFE_SEGMENT_PATTERN in packages/research allows only `[A-Za-z0-9._@:-]`). */
function splitResearchRef(ref: string): [string, string] {
  const i = ref.indexOf("|");
  return i === -1 ? [ref, ""] : [ref.slice(0, i), ref.slice(i + 1)];
}

const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => {});

const label = (s: string) => s.replace(/_/g, " ");

// --- issue ------------------------------------------------------------------

function IssuePanel({ issueRef, follow }: { issueRef: string; follow: boolean }) {
  const { inspect } = useShell();
  const canWrite = useCanWrite();
  const q = useIssue(issueRef, follow);
  if (q.isPending) return <LoadingState rows={6} label="Loading issue" />;
  if (q.isError) return <ErrorState title={`Could not read ${issueRef}`} error={q.error} />;
  return <IssueView issue={q.data} canWrite={canWrite} variant="panel" nav={{ onOpenIssue: (ref) => inspect({ kind: "issue", ref }), onOpenPull: (ref) => inspect({ kind: "pr", ref }) }} />;
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
      <DetailTitle
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
      </DetailTitle>
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
          <GithubPill href={e.url} />
        </InspectorSection>
      )}
    </>
  );
}

// --- research: run provenance, metric, sample, annotation -------------------
// No inspector of its own (rev 10 item 5): these panels are the canonical drawer's only
// research-specific content, reached from the run analysis and comparison surfaces.

function RunProvenancePanel({ runId }: { runId: string }) {
  const navigate = useNavigate();
  const { dispatch } = useShell();
  const q = useResearchRun(runId);
  if (q.isPending) return <LoadingState rows={5} label="Loading run" />;
  if (q.isError) return <ErrorState title={`Run manifest unreadable: ${runId}`} error={q.error} />;
  const manifest = q.data.manifest;
  const experiment = readVersionRef(manifest.experiment);
  const variant = readVersionRef(manifest.variant);
  const accounting = readAccounting(manifest.accounting);
  return (
    <>
      <DetailTitle eyebrow={<span className="font-mono">{runId}</span>}>Run provenance</DetailTitle>
      <InspectorSection title="Versions">
        <Fields
          rows={[
            ["Experiment", experiment ? `${experiment.id}@${experiment.version}` : <span className="text-ink-faint">unresolved</span>],
            ["Variant", variant ? `${variant.id}@${variant.version}` : <span className="text-ink-faint">unresolved</span>],
            ["Status", label(q.data.status)],
          ]}
        />
      </InspectorSection>
      <InspectorSection title="Accounting provenance">
        {accounting ? (
          <Fields rows={[["Price table", accounting.priceTableVersion], ["Telemetry schema", accounting.telemetrySchemaVersion], ["OTel semconv", accounting.otelSemconvRef]]} />
        ) : (
          <p className="text-sm text-ink-faint">Accounting provenance unavailable — the manifest carries no readable accounting block.</p>
        )}
      </InspectorSection>
      <div className="px-5 pb-4">
        <ToolbarButton
          icon="open"
          onClick={() => {
            void navigate({ to: `/research/runs/${runId}` } as never);
            dispatch({ type: "drawer/close" });
          }}
        >
          Open run analysis
        </ToolbarButton>
      </div>
    </>
  );
}

function MetricPanel({ runId, metricKey }: { runId: string; metricKey: string }) {
  const q = useResearchMetrics(runId);
  if (q.isPending) return <LoadingState rows={4} label="Loading metric" />;
  if (q.isError) return <ErrorState title={`Metrics unavailable for ${runId}`} error={q.error} />;
  const metric = q.data.metrics[metricKey];
  if (!metric) return <EmptyState icon="observability" title={`${metricKey} is not reported for ${runId}`} />;
  return (
    <>
      <DetailTitle eyebrow={<span className="font-mono">{runId}</span>}>{metricKey}</DetailTitle>
      <InspectorSection title="Metric">
        <MetricFields metric={metric} />
      </InspectorSection>
    </>
  );
}

function jsonText(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** One optional sample field: absent renders an explicit absence, never an inferred value. */
function SampleField({ label: fieldLabel, value }: { label: string; value: unknown }) {
  if (value === undefined) return <p className="text-sm text-ink-faint">{fieldLabel} not recorded on this sample.</p>;
  return <ContentPanel className="mt-1 whitespace-pre-wrap" mono>{jsonText(value)}</ContentPanel>;
}

function SamplePanel({ runId, sampleId }: { runId: string; sampleId: string }) {
  // Sample content comes from the run's sample records. Telemetry events are a separate read,
  // shown separately below and never folded into the sample's fields.
  const samples = useResearchSamples(runId);
  const telemetry = useResearchTail(runId);
  if (samples.isPending) return <LoadingState rows={4} label="Loading sample" />;
  if (samples.isError) return <ErrorState title={`Sample records unavailable for ${runId}`} error={samples.error} />;
  const sample = samples.data.find((s) => s.sampleId === sampleId);
  if (!sample) return <EmptyState icon="observability" title={`${sampleId} is not in this run's sample records`} />;
  const events = (telemetry.data?.events ?? []).filter((e) => e.sampleId === sampleId);
  return (
    <>
      <DetailTitle eyebrow={<span className="font-mono">{runId}</span>}>{sampleId}</DetailTitle>
      <InspectorSection title="Sample record">
        <Fields
          rows={[
            ["Index", <span className="tabular">{sample.index}</span>],
            ["Status", sample.status],
            ["Created", sample.createdAt ? new Date(sample.createdAt).toLocaleString() : <span className="text-ink-faint">—</span>],
          ]}
        />
        {sample.usage && <UsageFields usage={sample.usage} />}
      </InspectorSection>
      <InspectorSection title="Input">
        <SampleField label="Input" value={sample.input} />
      </InspectorSection>
      <InspectorSection title="Output">
        <SampleField label="Output" value={sample.output} />
      </InspectorSection>
      <InspectorSection title="Candidate">
        <SampleField label="Candidate" value={sample.candidate} />
      </InspectorSection>
      <InspectorSection title="Telemetry events">
        {events.length === 0 ? (
          <p className="text-sm text-ink-faint">No telemetry events reference this sample.</p>
        ) : (
          events.map((e) => (
            <div key={e.seq} className="mb-2 last:mb-0">
              <Fields rows={[["Event", e.kind], ["At", new Date(e.ts).toLocaleString()]]} />
            </div>
          ))
        )}
      </InspectorSection>
    </>
  );
}

function AnnotationPanel({ runId, index }: { runId: string; index: number }) {
  const q = useResearchRun(runId);
  if (q.isPending) return <LoadingState rows={3} label="Loading annotation" />;
  if (q.isError) return <ErrorState title={`Run manifest unreadable: ${runId}`} error={q.error} />;
  const annotation = q.data.annotations[index] as Record<string, unknown> | undefined;
  if (!annotation) return <EmptyState icon="observability" title="Annotation is outside the loaded log" />;
  return (
    <>
      <DetailTitle eyebrow={<span className="font-mono">{runId}</span>}>{String(annotation.kind ?? "Annotation")}</DetailTitle>
      <InspectorSection title="Annotation">
        <Fields
          rows={[
            ["Author", String(annotation.author ?? "—")],
            ["At", typeof annotation.timestamp === "string" ? new Date(annotation.timestamp).toLocaleString() : "—"],
            ["Evidence status", typeof annotation.evidence_status === "string" ? annotation.evidence_status : <span className="text-ink-faint">—</span>],
          ]}
        />
        <ContentPanel className="mt-2 whitespace-pre-wrap">{String(annotation.text ?? "")}</ContentPanel>
      </InspectorSection>
    </>
  );
}

// --- drawer host ------------------------------------------------------------

export function InspectorBody({ entity, follow }: { entity: DrawerRef | null; follow: boolean }) {
  if (!entity)
    return (
      <EmptyState icon="inspector" title="Nothing inspected">
        Select an issue, activity event, pull request, or GitHub issue to inspect it here without leaving the current surface.
      </EmptyState>
    );
  switch (entity.kind) {
    case "issue":
      return <IssuePanel key={entity.ref} issueRef={entity.ref} follow={follow} />;
    case "activity":
      return <ActivityPanel key={entity.ref} refValue={entity.ref} follow={follow} />;
    case "pr":
      return <PullPanel key={entity.ref} refValue={entity.ref} follow={follow} />;
    case "gh-issue":
      return <GithubIssuePanel key={entity.ref} refValue={entity.ref} follow={follow} />;
    case "github-auth":
      return <DevicePanel key={entity.ref} />;
    case "research-run":
      return <RunProvenancePanel key={entity.ref} runId={entity.ref} />;
    case "research-metric": {
      const [runId, metricKey] = splitResearchRef(entity.ref);
      return <MetricPanel key={entity.ref} runId={runId} metricKey={metricKey} />;
    }
    case "research-sample": {
      const [runId, sampleId] = splitResearchRef(entity.ref);
      return <SamplePanel key={entity.ref} runId={runId} sampleId={sampleId} />;
    }
    case "research-annotation": {
      const [runId, indexStr] = splitResearchRef(entity.ref);
      return <AnnotationPanel key={entity.ref} runId={runId} index={Number(indexStr)} />;
    }
    case "session":
      return <SessionPanel key={entity.ref} id={entity.ref} />;
    case "commit":
    case "file":
      return <HostRefPanel key={`${entity.kind}:${entity.ref}`} reference={{ kind: entity.kind, ref: entity.ref }} />;
  }
}

const KIND_LABEL: Record<DrawerRef["kind"], string> = {
  issue: "Issue",
  activity: "Activity",
  pr: "Pull request",
  "gh-issue": "GitHub issue",
  "github-auth": "GitHub sign-in",
  "research-run": "Run provenance",
  "research-metric": "Metric",
  "research-sample": "Sample",
  "research-annotation": "Annotation",
  session: "Session",
  commit: "Commit",
  file: "File",
};

/** Kinds the Agent composer accepts as typed references (PRD §36.5, §36.6). */
const ATTACHABLE = new Set<DrawerRef["kind"]>(["issue", "pr", "gh-issue", "session", "commit", "file"]);

export function InspectorDrawer({ variant }: { variant: "overlay" | "column" | "maximized" }) {
  const { layout, dispatch, inspected, repo } = useShell();
  const navigate = useNavigate();
  const agentStore = useAgentStore();
  const inAgent = useRouterState({ select: (st) => st.location.pathname.startsWith("/agent/") });
  const canAttach = !!inspected && inAgent && ATTACHABLE.has(inspected.kind) && !(inspected.kind === "session" && inspected.ref === agentStore.active);
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
        {canAttach && (
          <ToolbarButton className="mr-1" onClick={() => agentStore.attach({ kind: inspected.kind as RefKind, ref: inspected.ref })}>
            <span className="font-mono leading-none">@</span> Attach to composer
          </ToolbarButton>
        )}
        {inspected?.kind === "issue" && (
          <ToolbarButton
            icon="open"
            className="mr-1"
            onClick={() => {
              void navigate({ to: `/rep/${repo.owner}/${repo.name}/work/issues/${inspected.ref}` } as never);
              dispatch({ type: "drawer/close" });
            }}
          >
            Open
          </ToolbarButton>
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
