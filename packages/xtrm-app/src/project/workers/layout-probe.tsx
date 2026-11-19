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
 * The probe mounts the real app router so the surface renders with the shell's own width, the
 * issue index resolves titles, and the reference chips behave as they do on the deployed console.
 * The only substitution is the dispatch graph read.
 */
const substrate = {
  ...fixtureSubstrate,
  dispatchGraph: async () => structuredClone(WORKERS_LAYOUT_GRAPH),
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
