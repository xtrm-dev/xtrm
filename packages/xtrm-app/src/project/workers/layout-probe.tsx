import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { fixtureAdapters } from "../../adapters/index.tsx";
import { FIXTURE_BOARD_REPO } from "../../adapters/status-board/fixture.ts";
import { fixtureSubstrate } from "../../adapters/substrate/fixture.ts";
import { createAppRouter } from "../../app/router.tsx";
import "../../styles.css";
import { WORKERS_LAYOUT_GRAPH } from "./layout-fixture.ts";

/**
 * Browser probe for the Workers layout (XTRM-912), not a product surface. `e2e/project-workers.spec.ts`
 * loads this page to measure the live-shaped fixture in a real browser: rows whose PR trail or
 * session name overflows are only visible with layout, which jsdom does not compute.
 *
 * The probe mounts the real app router so the surface renders with the shell's own width and the
 * reference chips behave as they do on the deployed console. Two reads are substituted: the dispatch
 * graph, and the board list, which is shortened to the window the deployed page carried.
 */
/**
 * The board read as the deployed console saw it (XTRM-918): the graph names about 395 issues, the
 * board list carried a small window of them, so the fixture's own graph issues are not in it. Every
 * title a nameless row prints therefore arrives from the per-ref read, which is what the browser test
 * measures; before that read existed the row showed only its key.
 */
const substrate = {
  ...fixtureSubstrate,
  dispatchGraph: async () => structuredClone(WORKERS_LAYOUT_GRAPH),
  listIssues: async (projectId: string) => (await fixtureSubstrate.listIssues(projectId)).filter((i) => !["XTRM-301", "XTRM-302", "XTRM-303", "XTRM-304"].includes(i.ref)),
};

const router = createAppRouter({
  adapters: { ...fixtureAdapters, substrate },
  history: createMemoryHistory({ initialEntries: [`/rep/${FIXTURE_BOARD_REPO}/project/workers`] }),
  queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
