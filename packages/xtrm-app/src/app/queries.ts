// One query layer for all adapters (§9.2): no module-singleton caches.
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useAdapters, type GithubAuthStatus, type IssueDetail, type PullListState, type Repo, type SubstrateProject } from "../adapters/index.tsx";
// Pure board merge; fixture details pass through it unchanged (it is idempotent).
import { applyBoard } from "../adapters/substrate/live.ts";
import { loadSourceState } from "../activity/feed.ts";
import type { ActivityRow } from "../activity/types.ts";

const LIVE_MS = 10_000;

export function useRepos() {
  const { github } = useAdapters();
  return useQuery({ queryKey: ["github", "repos"], queryFn: () => github.listRepos(), staleTime: 60_000 });
}

export function useRepoStats() {
  const { github } = useAdapters();
  return useQuery({ queryKey: ["github", "stats"], queryFn: () => github.repoStats(), staleTime: 60_000 });
}

/** Where the Substrate board lives (local db or ssh forward) plus its round-trip time. */
export function useConnection() {
  const { substrate } = useAdapters();
  return useQuery({
    queryKey: ["substrate", "connection"],
    queryFn: () => substrate.connection?.() ?? Promise.resolve(null),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

/**
 * Mixed Activity feed (XTRM-757): one query per source so a failing source has
 * its own state instead of taking the feed down with it. `enabled` lets the
 * surface ask for only the sources it will render.
 */
export function useActivityFeed(opts: { repo: string; projectId: string | null; enabled?: Partial<Record<"substrate" | "github" | "git", boolean>> }) {
  const { github, substrate, gitActivity } = useAdapters();
  const sources = ["substrate", "github", "git"] as const;
  const results = useQueries({
    queries: sources.map((source) => ({
      queryKey: ["activity", source, opts.repo, opts.projectId],
      queryFn: () => loadSourceState(source, { repo: opts.repo, projectId: opts.projectId, github, substrate, gitActivity }),
      staleTime: 30_000,
      refetchInterval: false,
      enabled: opts.enabled?.[source] ?? true,
    })),
  });
  // A page per source is the default; "older" pages are appended on demand and
  // kept per source, so one source's history never blocks another's.
  const [older, setOlder] = useState<
    Partial<Record<(typeof sources)[number], { rows: ActivityRow[]; cursor: string | null; olderError?: string }>>
  >({});
  const states = sources.map((source, i) => {
    const r = results[i]!;
    const extra = older[source];
    return {
      source,
      rows: [...(r.data?.rows ?? []), ...(extra?.rows ?? [])],
      cursor: extra?.cursor ?? r.data?.cursor ?? null,
      error: r.isError ? String((r.error as Error)?.message ?? r.error) : (r.data?.error ?? null),
      // A failed older page is reported separately: it must not flip the source
      // into its error state while the rows it already returned stay on screen.
      olderError: extra?.olderError ?? null,
      pending: r.isPending && (opts.enabled?.[source] ?? true),
    };
  });
  const loadOlder = async (source: (typeof sources)[number]): Promise<void> => {
    const state = states.find((s) => s.source === source);
    if (!state?.cursor) return;
    const page = await loadSourceState(source, { repo: opts.repo, projectId: opts.projectId, github, substrate, gitActivity }, state.cursor);
    setOlder((prev) => {
      const previous = prev[source];
      if (page.error !== null) {
        // The older page failed, but the rows already on screen are still good:
        // keep them, keep the cursor so the button can retry, and report the
        // miss beside them instead of marking the whole source failed.
        return { ...prev, [source]: { rows: previous?.rows ?? [], cursor: state.cursor, olderError: page.error } };
      }
      return { ...prev, [source]: { rows: [...(previous?.rows ?? []), ...page.rows], cursor: page.cursor } };
    });
  };
  const refetch = (): void => {
    setOlder({});
    results.forEach((r) => void r.refetch());
  };
  return { states, loadOlder, refetch };
}

export function useEvents(repo: string, follow = false) {
  const { github } = useAdapters();
  return useQuery({
    queryKey: ["github", "events", repo],
    queryFn: () => github.events(repo, 200),
    staleTime: 30_000,
    refetchInterval: follow ? LIVE_MS : false,
  });
}

export function usePulls(repo: string, state: PullListState = "open", follow = false) {
  const { github } = useAdapters();
  return useQuery({
    queryKey: ["github", "pulls", repo, state],
    queryFn: () => github.listPulls(repo, state),
    staleTime: 30_000,
    refetchInterval: follow ? LIVE_MS : false,
  });
}

export function usePull(repo: string, number: number | null, follow = false) {
  const { github } = useAdapters();
  return useQuery({
    queryKey: ["github", "pull", repo, number],
    queryFn: () => github.getPull(repo, number!),
    enabled: number !== null,
    staleTime: 30_000,
    refetchInterval: follow ? LIVE_MS : false,
  });
}


export function useGithubIssues(repo: string, follow = false) {
  const { github } = useAdapters();
  return useQuery({
    queryKey: ["github", "issues", repo],
    queryFn: () => github.listIssues(repo),
    staleTime: 30_000,
    refetchInterval: follow ? LIVE_MS : false,
  });
}

export function useGithubIssue(repo: string, number: number | null, follow = false) {
  const { github } = useAdapters();
  return useQuery({
    queryKey: ["github", "issue", repo, number],
    queryFn: () => github.getIssue(repo, number!),
    enabled: number !== null,
    staleTime: 30_000,
    refetchInterval: follow ? LIVE_MS : false,
  });
}

export function useReleases(repo: string, follow = false) {
  const { github } = useAdapters();
  return useQuery({
    queryKey: ["github", "releases", repo],
    queryFn: () => github.listReleases(repo),
    staleTime: 60_000,
    refetchInterval: follow ? LIVE_MS : false,
  });
}

export function useRepoDocument(repo: string, path: string | null) {
  const { github } = useAdapters();
  return useQuery({
    queryKey: ["github", "document", repo, path],
    queryFn: () => github.getDocument(repo, path!),
    enabled: !!path,
    staleTime: 60_000,
  });
}

export function useRepoReports(repo: string) {
  const { github } = useAdapters();
  return useQuery({ queryKey: ["github", "reports", repo], queryFn: () => github.listReports(repo), staleTime: 60_000 });
}

export function useRepoReport(repo: string, filename: string | null) {
  const { github } = useAdapters();
  return useQuery({
    queryKey: ["github", "report", repo, filename],
    queryFn: () => github.getReport(repo, filename!),
    enabled: !!filename,
    staleTime: 60_000,
  });
}

// --- github auth (XTRM-400) ----------------------------------------------------
// Reads resolve to served states, never tokens (§9.2: same query layer, same rules).

export function useGithubAuthStatus(poll = false) {
  const { githubAuth } = useAdapters();
  return useQuery({
    queryKey: ["github", "auth", "status"],
    queryFn: () => githubAuth.status(),
    staleTime: 15_000,
    refetchInterval: poll ? 5_000 : false,
    retry: false,
  });
}

export function useGithubInstallations(enabled = true) {
  const { githubAuth } = useAdapters();
  return useQuery({
    queryKey: ["github", "auth", "installations"],
    queryFn: () => githubAuth.installations(),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useGithubCapabilities(repo: string, enabled = true) {
  const { githubAuth } = useAdapters();
  return useQuery({
    queryKey: ["github", "capabilities", repo],
    queryFn: () => githubAuth.capabilities(repo),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

function useAuthMutation(action: "start" | "cancel" | "signout") {
  const { githubAuth } = useAdapters();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (): Promise<GithubAuthStatus> =>
      action === "start" ? githubAuth.startDevice() : action === "cancel" ? githubAuth.cancelDevice() : githubAuth.signOut(),
    // The adapter settles on the fresh status; mirror it into the cache now and
    // refetch observers (the polling device panel) right after.
    onSuccess: (status) => {
      client.setQueryData(["github", "auth", "status"], status);
      void client.invalidateQueries({ queryKey: ["github", "auth", "status"] });
    },
  });
}

export function useStartDevice() {
  return useAuthMutation("start");
}
export function useCancelDevice() {
  return useAuthMutation("cancel");
}
export function useGithubSignOut() {
  return useAuthMutation("signout");
}

export function useProjects() {
  const { substrate } = useAdapters();
  return useQuery({ queryKey: ["substrate", "projects"], queryFn: () => substrate.listProjects(), staleTime: 5 * 60_000 });
}

/**
 * Repository → Substrate project. Matches a bound checkout root basename or the
 * project name against the repository name.
 * ponytail: name heuristic; replace with the repository binding once Substrate exposes remote → project.
 */
export function projectForRepo(projects: SubstrateProject[] | undefined, repo: Pick<Repo, "name">): SubstrateProject | null {
  if (!projects) return null;
  const name = repo.name.toLowerCase();
  return (
    projects.find((p) => p.gitRoots.some((root) => root.split("/").pop()?.toLowerCase() === name)) ??
    projects.find((p) => p.name.toLowerCase() === name) ??
    null
  );
}

// --- Project Jira (ADR-002 D3/D6): read-only links through the typed jira adapter -------------

/** The repository's Jira binding: bound site and project, or why the repository is unbound. */
export function useJiraBinding(repo: string) {
  const { jira } = useAdapters();
  return useQuery({ queryKey: ["jira", "binding", repo], queryFn: () => jira.binding(repo), staleTime: 60_000, retry: false });
}

/**
 * One page of the repository's bound Jira project. `enabled` lets a chip ask only when it has a
 * key the Substrate index did not resolve, so an issue page with no bare keys reads no Jira.
 */
export function useJiraIssues(repo: string, enabled = true) {
  const { jira } = useAdapters();
  return useQuery({ queryKey: ["jira", "issues", repo], queryFn: () => jira.search(repo), staleTime: 30_000, retry: false, enabled });
}

export function useIssues(projectId: string | null | undefined, refetchMs: number | false = false) {
  const { substrate } = useAdapters();
  return useQuery({
    queryKey: ["substrate", "issues", projectId],
    queryFn: () => substrate.listIssues(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
    refetchInterval: refetchMs,
  });
}

export function useIssuesForProjects(projectIds: string[], enabled: boolean) {
  const { substrate } = useAdapters();
  return useQueries({
    queries: projectIds.map((id) => ({
      queryKey: ["substrate", "issues", id],
      queryFn: () => substrate.listIssues(id),
      enabled,
      staleTime: 30_000,
    })),
  });
}

/** With follow on, the board behind an open detail refetches this often (the detail's own reads use LIVE_MS). */
const DETAIL_BOARD_MS = 60_000;

/**
 * The detail paints from the four per-issue reads. Board-derived fields (priority, dates, parent,
 * blockers) come from the project board query the Issues table already shares (same key and
 * staleTime), merged in `select`, so a board refetch or a write's invalidation updates them
 * without refetching the detail.
 */
export function useIssue(ref: string, follow = false, projectId?: string | null) {
  const { substrate } = useAdapters();
  const projects = useProjects();
  const prefix = ref.split("-")[0]?.toUpperCase();
  const boardProject = projectId ?? projects.data?.find((p) => p.prefix.toUpperCase() === prefix)?.id ?? null;
  const board = useIssues(boardProject, follow ? DETAIL_BOARD_MS : false).data;
  const select = useCallback((detail: IssueDetail) => (board ? applyBoard(detail, board) : detail), [board]);
  return useQuery({
    queryKey: ["substrate", "issue", ref],
    queryFn: () => substrate.getIssue(ref, boardProject ?? undefined, { withBoard: false }),
    select,
    staleTime: 15_000,
    refetchInterval: follow ? LIVE_MS : false,
  });
}

/** Backs the Recent Runs list. The Experiments surface is registry-sourced through
 * `useResearchExperiments`, so a definition with zero runs still appears. */
export function useResearchRuns() {
  const { research } = useAdapters();
  return useQuery({ queryKey: ["research", "runs"], queryFn: () => research.listRuns(), staleTime: 30_000, retry: false });
}

/** Registry experiment definitions (`xtrm-research experiments`), not derived from runs. */
export function useResearchExperiments() {
  const { research } = useAdapters();
  return useQuery({ queryKey: ["research", "experiments"], queryFn: () => research.listExperiments(), staleTime: 30_000, retry: false });
}

// --- Research: run analysis and comparison (XTRM-433 slice 3) --------------
// Derived views (metrics, compare, tail) are recomputed on every read on the research side
// (map-433.md §B7 "derived views are never cached"), so polling is always safe; these hooks
// stay one-shot (no refetchInterval) until a later slice adds live follow.

export function useResearchRun(runId: string | null) {
  const { research } = useAdapters();
  return useQuery({ queryKey: ["research", "run", runId], queryFn: () => research.getRun(runId!), enabled: !!runId, staleTime: 15_000, retry: false });
}

export function useResearchExperiment(id: string | null, version?: string) {
  const { research } = useAdapters();
  return useQuery({
    queryKey: ["research", "experiment", id, version ?? null],
    queryFn: () => research.getExperiment(id!, version),
    enabled: !!id,
    staleTime: 30_000,
    retry: false,
  });
}

export function useResearchChartData(runIds: string[], metric: string) {
  const { research } = useAdapters();
  return useQuery({
    queryKey: ["research", "chart-data", runIds, metric],
    queryFn: () => research.getChartData(runIds, metric),
    enabled: runIds.length > 0 && metric.length > 0,
    staleTime: 15_000,
    retry: false,
  });
}

export function useResearchMetrics(runId: string) {
  const { research } = useAdapters();
  return useQuery({ queryKey: ["research", "metrics", runId], queryFn: () => research.getMetrics(runId), staleTime: 15_000, retry: false });
}

/** Sample records from `samples.jsonl` via the CLI `samples` verb — the sample table's content.
 * Tail events are a separate telemetry read (`useResearchTail`) and are never sample contents. */
export function useResearchSamples(runId: string) {
  const { research } = useAdapters();
  return useQuery({ queryKey: ["research", "samples", runId], queryFn: () => research.getSamples(runId), staleTime: 15_000, retry: false });
}

/** Full log, no cursor: the run analysis sample table reads every event once, unlike a live
 * tail follow which would carry a `TailCursor` forward (not built in this slice). */
export function useResearchTail(runId: string) {
  const { research } = useAdapters();
  return useQuery({ queryKey: ["research", "tail", runId], queryFn: () => research.tail(runId), staleTime: 15_000, retry: false });
}

export function useResearchCompare(runIds: string[]) {
  const { research } = useAdapters();
  return useQuery({ queryKey: ["research", "compare", runIds], queryFn: () => research.compare(runIds), enabled: runIds.length >= 2, staleTime: 15_000, retry: false });
}

// --- Research: versioned definitions behind a run (board rerun, Jira XTRM-99 c.13438) ----
// A run page resolves the exact Experiment/Workload/QuestionSpec versions its manifest
// references and renders their semantic metadata; nothing is copied into the manifest.

function versionRef(manifest: Record<string, unknown> | undefined, kind: string): { id: string; version: string } | null {
  if (!manifest) return null;
  const ref = manifest[kind];
  if (typeof ref !== "object" || ref === null) return null;
  const { id, version } = ref as { id?: unknown; version?: unknown };
  return typeof id === "string" && typeof version === "string" ? { id, version } : null;
}

export function useResearchWorkloadForRun(manifest: Record<string, unknown> | undefined) {
  const { research } = useAdapters();
  const ref = versionRef(manifest, "workload");
  return useQuery({ queryKey: ["research", "workload", ref?.id, ref?.version], queryFn: () => research.getWorkload(ref!.id, ref!.version), enabled: ref !== null, staleTime: 60_000, retry: false });
}

export function useResearchQuestionSpec(id: string | undefined, version: string | undefined) {
  const { research } = useAdapters();
  return useQuery({ queryKey: ["research", "question-spec", id, version], queryFn: () => research.getQuestionSpec(id!, version!), enabled: id !== undefined && version !== undefined, staleTime: 60_000, retry: false });
}
