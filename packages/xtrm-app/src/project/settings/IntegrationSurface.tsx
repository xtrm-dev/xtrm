import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { BoardGap, ProjectBinding, ProjectHealth, StatusBoardAdapter, UnitProbeReason } from "../../adapters/status-board/types.ts";
import { useAdapters } from "../../adapters/index.tsx";
import { useShell } from "../../shell/context.tsx";
import { ErrorState, LoadingState, ago } from "../../ui/primitives.tsx";
import { SectionHeader } from "../../ui/section.tsx";
import { ProjectShell } from "../ProjectShell.tsx";

/**
 * The Integration surface (ADR-002 §D2 settings row, §D7): the resolved binding, the derived sync
 * health and the contract gaps the adapters report — read-only, paths only, never a credential.
 *
 * Every unverified health fact renders as `unverified` with its own reason (§4): `unitActive: null`
 * is not "the sync is down", and a missing drift count is not zero drift.
 */

const PROBE_REASON: Record<UnitProbeReason, string> = {
  unit_not_found: "the unit was not found on this host",
  probe_timeout: "the probe timed out",
  non_user_session: "this deployment does not run as a user session",
  probe_failed: "the probe failed",
};

const RESOLVED_BY: Record<ProjectBinding["resolvedBy"], string> = {
  explicit: "an explicit configuration entry",
  env: "the environment",
  repo_slug: "the repository slug",
  repo_name: "the repository name",
  none: "nothing yet",
};

const UNBOUND_REASON = {
  config_absent: "this deployment has no project-management configuration",
  repo_not_bound: "no project-management binding names this repository",
} as const;

/** The collections the Project surfaces read, in the order the bridge serves them. */
export const INTEGRATION_COLLECTIONS = ["workers", "schedule", "questions", "answers", "followups", "status", "proposals"] as const;

export interface IntegrationGaps {
  /** Gaps the adapters reported, each already carrying its record path and field. */
  gaps: BoardGap[];
  /** Collections the bridge stopped paging, so their gaps are not the whole story. */
  truncated: string[];
  /** Collections whose read failed: an unreadable collection is a gap of its own, never "clean". */
  failed: { collection: string; reason: string }[];
  /** Records the scan actually read, so a zero-gap report can be judged against its coverage. */
  scanned: number;
}

/**
 * Read every collection once and aggregate the gaps. `allSettled`, not `all`: one unreadable
 * collection must not hide the gaps the others reported.
 */
export async function readIntegrationGaps(board: StatusBoardAdapter, repository: string): Promise<IntegrationGaps> {
  const reads = {
    workers: board.listWorkers(repository),
    schedule: board.listSchedule(repository),
    questions: board.listQuestions(repository),
    answers: board.listAnswers(repository),
    followups: board.listFollowUps(repository),
    status: board.listStatus(repository),
    proposals: board.listProposals(repository),
  } as const;
  const entries = Object.entries(reads) as [string, Promise<{ records: unknown[]; gaps: BoardGap[]; truncated: boolean }>][];
  const results = await Promise.allSettled(entries.map(([, read]) => read));
  const report: IntegrationGaps = { gaps: [], truncated: [], failed: [], scanned: 0 };
  results.forEach((result, index) => {
    const collection = entries[index]![0];
    if (result.status === "rejected") {
      report.failed.push({ collection, reason: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      return;
    }
    report.scanned += result.value.records.length;
    report.gaps.push(...result.value.gaps);
    if (result.value.truncated) report.truncated.push(collection);
  });
  return report;
}

function Fact({ label, value, mono, testId, unverified }: { label: string; value: string | null; mono?: boolean; testId?: string; unverified?: boolean }) {
  return (
    <div className="grid grid-cols-[10rem_minmax(0,1fr)] items-baseline gap-3 py-1">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className={`min-w-0 break-words text-xs ${mono ? "font-mono text-xs" : ""} ${unverified ? "text-ink-muted" : "text-ink"}`} data-testid={testId} data-unverified={unverified ? "true" : undefined}>
        {value ?? "not reported"}
      </dd>
    </div>
  );
}

function Group({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <section aria-label={title} data-testid={testId} className="flex min-w-0 flex-col">
      <SectionHeader title={title} inset="list" level={3} className="border-b border-border" />
      <dl className="px-3 py-1">{children}</dl>
    </section>
  );
}

/** A tri-state health fact: a verified boolean, or `unverified` with the probe's reason. */
function tri(value: boolean | null, reason: UnitProbeReason | null, yes: string, no: string): { value: string | null; unverified: boolean } {
  if (value === null) return { value: `unverified — ${reason ? PROBE_REASON[reason] : "the bridge reported no reason"}`, unverified: true };
  return { value: value ? yes : no, unverified: false };
}

function BindingFacts({ binding }: { binding: ProjectBinding }) {
  if (!binding.configured) {
    return (
      <Group title="Binding" testId="integration-binding">
        <Fact label="Repository" value={binding.repository} mono testId="integration-repository" />
        <Fact label="State" value={`not integrated — ${binding.reason ? UNBOUND_REASON[binding.reason] : "the bridge reported no reason"}`} testId="integration-binding-state" />
        <Fact label="Resolved by" value={RESOLVED_BY[binding.resolvedBy]} testId="integration-resolved-by" />
      </Group>
    );
  }
  return (
    <Group title="Binding" testId="integration-binding">
      <Fact label="Repository" value={binding.repository} mono testId="integration-repository" />
      <Fact label="Resolved by" value={RESOLVED_BY[binding.resolvedBy]} testId="integration-resolved-by" />
      <Fact label="PM project" value={binding.pmProject} testId="integration-pm-project" />
      <Fact label="Substrate project" value={binding.substrateProject} testId="integration-substrate-project" />
      <Fact label="Status-board site" value={binding.statusBoard?.site ?? null} mono testId="integration-board-site" />
      <Fact label="Board state dir" value={binding.statusBoard?.stateDir ?? null} mono testId="integration-state-dir" />
      <Fact label="Board timezone" value={binding.statusBoard?.timezone ?? null} testId="integration-timezone" />
      <Fact label="Jira site" value={binding.jira?.site ?? null} mono testId="integration-jira-site" />
      <Fact label="Jira project" value={binding.jira?.project ?? null} testId="integration-jira-project" />
      <Fact
        label="Credential file"
        value={
          binding.statusBoard?.keyFile
            ? `${binding.statusBoard.keyFile} — ${binding.statusBoard.keyPresent ? "readable" : "not readable"}`
            : null
        }
        mono
        testId="integration-key-file"
      />
      <div className="px-0 pt-1 text-xs text-ink-faint" data-testid="integration-credential-note">
        This page carries file paths and flags only. The bridge never returns a credential value.
      </div>
    </Group>
  );
}

function HealthFacts({ health }: { health: ProjectHealth }) {
  const unit = tri(health.unitActive, health.unitActiveReason, "running", "not running");
  const schedule = tri(health.scheduleActive, health.scheduleActiveReason, "active", "not active");
  const run = tri(health.runInProgress, health.runInProgressReason, "a sync is running", "no sync is running");
  const fresh = tri(health.stale, null, "stale", "fresh");
  return (
    <Group title="Sync health" testId="integration-health">
      <Fact
        label="Last successful sync"
        value={health.lastSyncOkAt ? `${ago(health.lastSyncOkAt)} · ${health.lastSyncOkAt}` : null}
        testId="health-last-sync"
      />
      <Fact label="Drift" value={health.driftCount === null ? "unverified — the bridge reported no drift count" : `${health.driftCount} record${health.driftCount === 1 ? "" : "s"}`} unverified={health.driftCount === null} testId="health-drift" />
      <Fact label={`Sync unit${health.timerUnit ? ` (${health.timerUnit})` : ""}`} value={unit.value} unverified={unit.unverified} testId="health-unit" />
      <Fact label="Schedule" value={schedule.value} unverified={schedule.unverified} testId="health-schedule" />
      <Fact label="Run" value={run.value} unverified={run.unverified} testId="health-run" />
      <Fact label="Freshness" value={fresh.value} unverified={fresh.unverified} testId="health-freshness" />
      <Fact label="Checked" value={`${ago(health.checkedAt)} · ${health.checkedAt}`} testId="health-checked" />
    </Group>
  );
}

function GapFacts({ report }: { report: IntegrationGaps }) {
  const clean = report.gaps.length === 0 && report.failed.length === 0;
  return (
    <Group title="Contract gaps" testId="integration-gaps">
      <Fact
        label="Scanned"
        value={`${report.scanned} record${report.scanned === 1 ? "" : "s"} across ${INTEGRATION_COLLECTIONS.length} collections`}
        testId="integration-gap-scan"
      />
      {clean ? (
        <Fact label="Gaps" value="none — every record the adapters read matched a declared shape" testId="integration-gap-none" />
      ) : null}
      {report.gaps.length > 0 ? (
        <ul className="min-w-0 py-1" data-testid="integration-gap-list">
          {report.gaps.map((gap, index) => (
            <li key={`${gap.path}:${gap.field}:${index}`} className="grid grid-cols-[10rem_minmax(0,1fr)] items-baseline gap-3 py-1" data-testid="integration-gap">
              <span className="font-mono text-xs break-words text-ink-faint">{gap.path}</span>
              <span className="min-w-0 text-xs text-ink">
                <span className="font-mono text-xs">{gap.field}</span> carried <span className="font-mono text-xs break-words">{gap.value}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {report.truncated.length > 0 ? (
        <Fact label="Truncated" value={`the bridge stopped at its page budget for ${report.truncated.join(", ")}`} unverified testId="integration-gap-truncated" />
      ) : null}
      {report.failed.map((failure) => (
        <Fact key={failure.collection} label={failure.collection} value={`could not be read — ${failure.reason}`} unverified testId={`integration-gap-failed-${failure.collection}`} />
      ))}
    </Group>
  );
}

export function IntegrationSurface() {
  const { repo } = useShell();
  const { statusBoard } = useAdapters();
  const repository = `${repo.owner}/${repo.name}`;

  const binding = useQuery({
    queryKey: ["project", "binding", repository],
    queryFn: () => statusBoard.binding(repository),
    staleTime: 60_000,
  });
  const bound = binding.data?.configured === true;
  const health = useQuery({
    queryKey: ["project", "health", repository],
    queryFn: () => statusBoard.health(repository),
    staleTime: 60_000,
    enabled: bound,
  });
  const gaps = useQuery({
    queryKey: ["project", "gaps", repository],
    queryFn: () => readIntegrationGaps(statusBoard, repository),
    staleTime: 60_000,
    enabled: bound,
  });

  // The toolbar states what this repository can be asked about. An unbound repository has no gaps to
  // read, so it says so instead of "reading gaps" forever: the query is disabled, never pending.
  const gapCount = gaps.data ? gaps.data.gaps.length + gaps.data.failed.length : null;
  const gapSummary = binding.isPending
    ? "resolving binding"
    : !bound
      ? "not integrated"
      : gapCount === null
        ? "reading gaps"
        : `${gapCount} gap${gapCount === 1 ? "" : "s"}`;
  const toolbar = (
    <span className="text-xs text-ink-faint" data-testid="integration-gap-count" data-state={binding.isPending ? "pending" : bound ? "bound" : "unbound"}>
      {gapSummary}
    </span>
  );

  const shell = (children: ReactNode) => (
    <ProjectShell title="Integration" binding={binding.data ?? null} health={health.data ?? null} source={statusBoard.source} toolbar={toolbar}>
      {children}
    </ProjectShell>
  );

  if (binding.isLoading) return shell(<LoadingState label="Loading the integration binding" rows={4} />);
  if (binding.isError) return shell(<ErrorState title="The integration binding could not be read" error={binding.error} />);
  if (!binding.data) return shell(<ErrorState title="The integration binding could not be read" error={new Error("the bridge returned no binding")} />);

  return shell(
    <div className="flex min-h-0 flex-1 flex-col gap-2 pb-4" data-testid="integration-surface">
      <BindingFacts binding={binding.data} />
      {bound ? (
        health.isError ? (
          <Group title="Sync health" testId="integration-health">
            <ErrorState title="The sync health could not be read" error={health.error} />
          </Group>
        ) : health.data ? (
          <HealthFacts health={health.data} />
        ) : (
          <Group title="Sync health" testId="integration-health">
            <LoadingState label="Loading sync health" rows={4} />
          </Group>
        )
      ) : null}
      {bound ? (
        gaps.isError ? (
          <Group title="Contract gaps" testId="integration-gaps">
            <ErrorState title="The contract gaps could not be read" error={gaps.error} />
          </Group>
        ) : gaps.data ? (
          <GapFacts report={gaps.data} />
        ) : (
          <Group title="Contract gaps" testId="integration-gaps">
            <LoadingState label="Reading contract gaps" rows={3} />
          </Group>
        )
      ) : null}
    </div>,
  );
}
