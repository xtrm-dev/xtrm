// One query layer for all adapters (§9.2): no module-singleton caches.
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAdapters, type GithubAuthStatus, type PullListState, type Repo, type SubstrateProject } from "../adapters/index.tsx";

const LIVE_MS = 10_000;

export function useRepos() {
  const { github } = useAdapters();
  return useQuery({ queryKey: ["github", "repos"], queryFn: () => github.listRepos(), staleTime: 60_000 });
}

export function useRepoStats() {
  const { github } = useAdapters();
  return useQuery({ queryKey: ["github", "stats"], queryFn: () => github.repoStats(), staleTime: 60_000 });
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

export function useIssues(projectId: string | null | undefined) {
  const { substrate } = useAdapters();
  return useQuery({
    queryKey: ["substrate", "issues", projectId],
    queryFn: () => substrate.listIssues(projectId!),
    enabled: !!projectId,
    staleTime: 30_000,
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

export function useIssue(ref: string, follow = false, projectId?: string | null) {
  const { substrate } = useAdapters();
  return useQuery({
    queryKey: ["substrate", "issue", ref],
    queryFn: () => substrate.getIssue(ref, projectId ?? undefined),
    staleTime: 15_000,
    refetchInterval: follow ? LIVE_MS : false,
  });
}

export function useProgram(follow = false) {
  const { program } = useAdapters();
  return useQuery({ queryKey: ["program", "snapshot"], queryFn: () => program.snapshot(), staleTime: 60_000, refetchInterval: follow ? LIVE_MS : false, retry: false });
}

/** Backs both Research list views (XTRM-433 slice 2): the run list directly, the experiment
 * list by deduping `experiment` across rows — there is no `listExperiments` read verb. */
export function useResearchRuns() {
  const { research } = useAdapters();
  return useQuery({ queryKey: ["research", "runs"], queryFn: () => research.listRuns(), staleTime: 30_000, retry: false });
}
