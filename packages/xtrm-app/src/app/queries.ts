// One query layer for all adapters (§9.2): no module-singleton caches.
import { useQueries, useQuery } from "@tanstack/react-query";
import { useAdapters, type Repo, type SubstrateProject } from "../adapters/index.tsx";

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

export function useIssue(ref: string, follow = false) {
  const { substrate } = useAdapters();
  return useQuery({
    queryKey: ["substrate", "issue", ref],
    queryFn: () => substrate.getIssue(ref),
    staleTime: 15_000,
    refetchInterval: follow ? LIVE_MS : false,
  });
}

export function useProgram(follow = false) {
  const { program } = useAdapters();
  return useQuery({ queryKey: ["program", "snapshot"], queryFn: () => program.snapshot(), staleTime: 60_000, refetchInterval: follow ? LIVE_MS : false, retry: false });
}
