import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { Outlet, createRootRoute, createRoute, createRouter, redirect, type RouterHistory } from "@tanstack/react-router";
import { AdaptersProvider, type Adapters } from "../adapters/index.tsx";
import { AgentIndexSurface, AgentSessionSurface } from "../agent/AgentSurface.tsx";
import { IssuePage } from "../issues/IssuePage.tsx";
import { IssuesSurface } from "../issues/IssuesSurface.tsx";
import { AppShell } from "../shell/AppShell.tsx";
import { DEFAULT_REPO, REPO_KEY } from "../shell/context.tsx";
import { validateDrawerSearch } from "../shell/layout.ts";
import { ActivitySurface } from "../surfaces/ActivitySurface.tsx";
import { ContentSurface } from "../github/ContentSurface.tsx";
import { GithubIssuesSurface } from "../github/IssuesSurface.tsx";
import { ReleasesSurface } from "../github/ReleasesSurface.tsx";
import { PullsSurface } from "../github/PullsSurface.tsx";
import { ExperimentDetailSurface, ExperimentListSurface, RunAnalysisSurface, RunComparisonSurface, RunListSurface } from "../surfaces/ResearchSurface.tsx";
import { OverviewSurface } from "../project/overview/OverviewSurface.tsx";
import { JiraSurface } from "../project/jira/JiraSurface.tsx";
import { TimelineSurface, validateTimelineSearch } from "../project/timeline/TimelineSurface.tsx";
import { FollowUpsSurface } from "../project/followups/FollowUpsSurface.tsx";
import { QuestionsSurface } from "../project/questions/QuestionsSurface.tsx";
import { IntegrationSurface } from "../project/settings/IntegrationSurface.tsx";
import { WorkersSurface, validateWorkersSearch } from "../project/workers/WorkersSurface.tsx";
import { DeferredSurface, RepositoriesSurface } from "../surfaces/other.tsx";
import { SECTION_ORDER, type SettingsSection } from "../lib/settings/index.ts";
import { SettingsPage, sectionHref } from "../settings/SettingsPage.tsx";
import { MODES, PROJECT_ROOT, PROJECT_SECTIONS, REPO_SECTIONS, RESEARCH_SECTIONS, type Destination } from "./destinations.ts";
import { validateCompareSearch } from "./research-compare-search.ts";

// URL contract: docs/console-v2-shell-architecture.md §9.1.

/** Project sections with a live surface; every other section stays an explicit coming-state. */
const PROJECT_SURFACES: Partial<Record<string, ComponentType>> = { overview: OverviewSurface, timeline: TimelineSurface, jira: JiraSurface, workers: WorkersSurface, followups: FollowUpsSurface, questions: QuestionsSurface, settings: IntegrationSurface };

/** A Project section's own search keys; the drawer's keys stay valid alongside them. */
const PROJECT_SEARCH: Partial<Record<string, (search: Record<string, unknown>) => Record<string, unknown>>> = {
  timeline: (search) => ({ ...validateDrawerSearch(search), ...validateTimelineSearch(search) }),
  workers: (search) => ({ ...validateDrawerSearch(search), ...validateWorkersSearch(search) }),
};

/** The last selected repository (the shell's context rule), or null when none is selected yet. */
function selectedRepo(): { owner: string; name: string } | null {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(REPO_KEY);
  } catch {
    // storage unavailable
  }
  const [owner, name] = stored?.split("/") ?? [];
  return owner && name ? { owner, name } : null;
}

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
      // The stored repository is read once, by the same helper the retired-route redirects use;
      // this route alone keeps the default repository when nothing is stored yet.
      const stored = selectedRepo();
      throw redirect({ to: `/rep/${stored?.owner ?? DEFAULT_REPO.owner}/${stored?.name ?? DEFAULT_REPO.name}/work/issues` } as never);
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
  // Retired cross-repository governance endpoint (ADR-002 D1): redirects to the selected
  // repository's Project root, or to the picker when no repository is selected — never a dead route.
  const programRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/program",
    beforeLoad: () => {
      const repo = selectedRepo();
      throw redirect({ to: repo ? `/rep/${repo.owner}/${repo.name}${PROJECT_ROOT}` : "/repositories" } as never);
    },
  });
  // Settings (XTRM-1103): `/settings` opens its first section; an unknown section does too.
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    beforeLoad: () => {
      throw redirect({ to: sectionHref(SECTION_ORDER[0]!) } as never);
    },
  });
  const settingsSectionRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings/$section",
    beforeLoad: ({ params }) => {
      if (!SECTION_ORDER.includes(params.section as SettingsSection)) throw redirect({ to: sectionHref(SECTION_ORDER[0]!) } as never);
    },
    component: function SettingsSectionRoute() {
      const { section } = settingsSectionRoute.useParams();
      return <SettingsPage key={section} section={section as SettingsSection} />;
    },
  });

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
    // Retired repository governance route (ADR-002 D1): the same repository's Project root.
    createRoute({
      getParentRoute: () => repoRoute,
      path: "/governance/program",
      beforeLoad: ({ params }) => {
        const { owner, repo } = params as { owner: string; repo: string };
        throw redirect({ to: `/rep/${owner}/${repo}${PROJECT_ROOT}` } as never);
      },
    }),
    // Project subtree (ADR-002 D2): the root is Overview; every section is URL-addressable and a
    // typed coming-state until its own issue lands, never invented UI.
    ...PROJECT_SECTIONS.map((s) => {
      const Surface = PROJECT_SURFACES[s.id];
      return createRoute({
        getParentRoute: () => repoRoute,
        path: s.repoPath,
        validateSearch: PROJECT_SEARCH[s.id],
        component: Surface ? () => <Surface /> : () => <DeferredSurface title={s.label} icon={s.icon} reason={s.deferred ?? `${s.label} is not implemented yet`} />,
      });
    }),
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
    settingsSectionRoute,
    ...deferredModes,
    ...systemRoutes,
    repoRoute.addChildren(repoChildren),
  ]);
  return createRouter({ routeTree, history, defaultPreload: false });
}
