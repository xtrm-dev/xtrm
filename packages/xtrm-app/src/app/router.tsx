import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Outlet, createRootRoute, createRoute, createRouter, redirect, type RouterHistory } from "@tanstack/react-router";
import { AdaptersProvider, type Adapters } from "../adapters/index.tsx";
import { AppShell } from "../shell/AppShell.tsx";
import { DEFAULT_REPO } from "../shell/context.tsx";
import { validateDrawerSearch } from "../shell/layout.ts";
import { ActivitySurface } from "../surfaces/ActivitySurface.tsx";
import { IssuesSurface } from "../surfaces/IssuesSurface.tsx";
import { ProgramSurface } from "../surfaces/ProgramSurface.tsx";
import { DeferredSurface, RepositoriesSurface } from "../surfaces/other.tsx";
import { GLOBAL_DESTINATIONS, REPO_SECTIONS } from "./destinations.ts";

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

  const deferredGlobal = GLOBAL_DESTINATIONS.filter((d) => d.deferred).map((d) =>
    createRoute({ getParentRoute: () => rootRoute, path: d.path, component: () => <DeferredSurface title={d.label} icon={d.icon} reason={d.deferred!} /> }),
  );

  const repositoriesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/repositories", component: RepositoriesSurface });
  const programRoute = createRoute({ getParentRoute: () => rootRoute, path: "/program", component: () => <ProgramSurface /> });

  const repoRoute = createRoute({ getParentRoute: () => rootRoute, path: "/rep/$owner/$repo", component: Outlet });
  const repoChildren = [
    createRoute({ getParentRoute: () => repoRoute, path: "/work/issues", component: IssuesSurface }),
    createRoute({ getParentRoute: () => repoRoute, path: "/code/activity", component: ActivitySurface }),
    createRoute({ getParentRoute: () => repoRoute, path: "/governance/program", component: () => <ProgramSurface repoScoped /> }),
    ...REPO_SECTIONS.flatMap((s) => s.items)
      .filter((i) => i.repoPath && i.deferred)
      .map((i) => createRoute({ getParentRoute: () => repoRoute, path: i.repoPath!, component: () => <DeferredSurface title={i.label} icon={i.icon} reason={i.deferred!} /> })),
    createRoute({
      getParentRoute: () => repoRoute,
      path: "/agent/$sessionId",
      component: () => <DeferredSurface title="Agent session" icon="agent" reason="Reserved route for the Agent/Frames tranche (wave H)." />,
    }),
  ];

  const routeTree = rootRoute.addChildren([indexRoute, repositoriesRoute, programRoute, ...deferredGlobal, repoRoute.addChildren(repoChildren)]);
  return createRouter({ routeTree, history, defaultPreload: false });
}
