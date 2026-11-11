import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { Outlet, createRootRoute, createRoute, createRouter, redirect, type RouterHistory } from "@tanstack/react-router";
import { AdaptersProvider, type Adapters } from "../adapters/index.tsx";
import { AgentIndexSurface, AgentSessionSurface } from "../agent/AgentSurface.tsx";
import { IssuePage } from "../issues/IssuePage.tsx";
import { IssuesSurface } from "../issues/IssuesSurface.tsx";
import { AppShell } from "../shell/AppShell.tsx";
import { DEFAULT_REPO } from "../shell/context.tsx";
import { validateDrawerSearch } from "../shell/layout.ts";
import { ActivitySurface } from "../surfaces/ActivitySurface.tsx";
import { ContentSurface } from "../github/ContentSurface.tsx";
import { GithubIssuesSurface } from "../github/IssuesSurface.tsx";
import { ReleasesSurface } from "../github/ReleasesSurface.tsx";
import { PullsSurface } from "../github/PullsSurface.tsx";
import { ProgramSurface } from "../surfaces/ProgramSurface.tsx";
import { ExperimentDetailSurface, ExperimentListSurface, RunAnalysisSurface, RunComparisonSurface, RunListSurface } from "../surfaces/ResearchSurface.tsx";
import { DeferredSurface, RepositoriesSurface } from "../surfaces/other.tsx";
import { SettingsSurface } from "../settings/SettingsSurface.tsx";
import { MODES, REPO_SECTIONS, RESEARCH_SECTIONS, type Destination } from "./destinations.ts";
import { validateCompareSearch } from "./research-compare-search.ts";

// URL contract: docs/console-v2-shell-architecture.md §9.1.

export function createAppRouter({ adapters, history, queryClient = new QueryClient() }: { adapters: Adapters; history?: RouterHistory; queryClient?: QueryClient }) {
  const rootRoute = createRootRoute({
    validateSearch: validateDrawerSearch,
    component: () => (
      <QueryClientProvider client={queryClient}>
        <AdaptersProvider adapters={adapters}>
          <AppShell />
        </AdaptersProvider>
      </QueryClientProvider>
    ),
    notFoundComponent: () => <DeferredSurface title="Not found" icon="alert" reason="This route is not part of the Console v2 URL contract." />,
  });

  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    beforeLoad: () => {
      let stored: string | null = null;
      try {
        stored = localStorage.getItem("xtrm.console.repo.v1");
      } catch {
        // storage unavailable
      }
      const [owner, name] = stored?.split("/") ?? [DEFAULT_REPO.owner, DEFAULT_REPO.name];
      throw redirect({ to: `/rep/${owner}/${name}/work/issues` } as never);
    },
  });

  const deferredModes = MODES.filter((m) => m.deferred && m.path).map((m) =>
    createRoute({ getParentRoute: () => rootRoute, path: m.path!, component: () => <DeferredSurface title={m.label} icon={m.icon} reason={m.deferred!} /> }),
  );
  // System destinations are not repository-scoped: one deferred root route each (XTRM-632).
  const systemRoutes = (REPO_SECTIONS.find((s) => s.label === "System")?.items ?? [])
    .filter((i): i is Destination & { path: string; deferred: string } => !!i.path && !!i.deferred)
    .map((i) => createRoute({ getParentRoute: () => rootRoute, path: i.path, component: () => <DeferredSurface title={i.label} icon={i.icon} reason={i.deferred} /> }));

  // Agent half (PRD §36.2): `/agent` reopens the last or most recent session.
  const agentIndexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/agent", component: AgentIndexSurface });
  const agentSessionRoute = createRoute({ getParentRoute: () => rootRoute, path: "/agent/$sessionId", component: AgentSessionSurface });

  const workRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/work",
    component: () => <DeferredSurface title="Work" icon="work" reason="Cross-repository work queue; use repository Issues in this vertical." />,
  });
  const repositoriesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/repositories", component: RepositoriesSurface });
  const programRoute = createRoute({ getParentRoute: () => rootRoute, path: "/program", component: () => <ProgramSurface /> });
  const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsSurface });

  // Research (XTRM-433 slice 2): `/research` redirects to its first section, mirroring the
  // app-root index redirect above. Each section is a real route; a `deferred` one renders the
  // same placeholder as REPO_SECTIONS, never invented UI.
  const researchIndexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/research",
    beforeLoad: () => {
      throw redirect({ to: RESEARCH_SECTIONS[0]!.path } as never);
    },
  });
  const RESEARCH_SURFACES: Record<string, ComponentType> = { experiments: ExperimentListSurface, runs: RunListSurface };
  const researchRoutes = RESEARCH_SECTIONS.map((s) => {
    const Surface = RESEARCH_SURFACES[s.id];
    return createRoute({
      getParentRoute: () => rootRoute,
      path: s.path,
      component: s.deferred || !Surface ? () => <DeferredSurface title={s.label} icon={s.icon} reason={s.deferred ?? "Not implemented"} /> : () => <Surface />,
    });
  });
  // Experiment detail: reached from an experiment row, URL-addressable on its own.
  const researchExperimentRoute = createRoute({ getParentRoute: () => rootRoute, path: "/research/experiments/$experimentId", component: ExperimentDetailSurface });
  // Run analysis (rev 10 slice 3): reached from a run row, URL-addressable on its own.
  const researchRunRoute = createRoute({ getParentRoute: () => rootRoute, path: "/research/runs/$runId", component: RunAnalysisSurface });
  // Comparison surface: its own search validator composed with the drawer's, so `?inspect=`
  // still restores alongside `?baseline=&candidate=` (rootRoute's validateSearch only covers
  // the drawer keys; each route's own validateSearch is additive, not replacing).
  const researchCompareRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/research/compare",
    validateSearch: (search: Record<string, unknown>) => ({ ...validateDrawerSearch(search), ...validateCompareSearch(search) }),
    component: RunComparisonSurface,
  });

  const repoRoute = createRoute({ getParentRoute: () => rootRoute, path: "/rep/$owner/$repo", component: Outlet });
  const repoChildren = [
    createRoute({ getParentRoute: () => repoRoute, path: "/work/issues", component: IssuesSurface }),
    createRoute({ getParentRoute: () => repoRoute, path: "/work/issues/$issueRef", component: IssuePage }),
    createRoute({ getParentRoute: () => repoRoute, path: "/code/activity", component: ActivitySurface }),
    createRoute({ getParentRoute: () => repoRoute, path: "/code/pulls", component: PullsSurface }),
    createRoute({ getParentRoute: () => repoRoute, path: "/code/issues", component: GithubIssuesSurface }),
    createRoute({ getParentRoute: () => repoRoute, path: "/code/releases", component: ReleasesSurface }),
    createRoute({ getParentRoute: () => repoRoute, path: "/code/content", component: ContentSurface }),
    createRoute({ getParentRoute: () => repoRoute, path: "/governance/program", component: () => <ProgramSurface repoScoped /> }),
    ...REPO_SECTIONS.flatMap((s) => s.items)
      .filter((i): i is Destination & { repoPath: string; deferred: string } => !!i.deferred && !!i.repoPath)
      .map((i) => createRoute({ getParentRoute: () => repoRoute, path: i.repoPath, component: () => <DeferredSurface title={i.label} icon={i.icon} reason={i.deferred} /> })),
    // Retired reservation: sessions are not repository-scoped routes (PRD §36.3 scope control).
    createRoute({
      getParentRoute: () => repoRoute,
      path: "/agent/$sessionId",
      beforeLoad: ({ params }) => {
        throw redirect({ to: `/agent/${(params as { sessionId: string }).sessionId}` } as never);
      },
    }),
  ];

  const routeTree = rootRoute.addChildren([
    indexRoute,
    agentIndexRoute,
    agentSessionRoute,
    workRoute,
    repositoriesRoute,
    programRoute,
    researchIndexRoute,
    ...researchRoutes,
    researchExperimentRoute,
    researchRunRoute,
    researchCompareRoute,
    settingsRoute,
    ...deferredModes,
    ...systemRoutes,
    repoRoute.addChildren(repoChildren),
  ]);
  return createRouter({ routeTree, history, defaultPreload: false });
}
