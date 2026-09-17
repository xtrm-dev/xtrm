import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { fixtureResearch } from "../adapters/research/fixture.ts";
import { isInvalidManifestRow, type ResearchAdapter, type RunListRow } from "../adapters/research/types.ts";
import { MODES, modeForPath } from "./destinations.ts";
import { createAppRouter } from "./router.tsx";

// Research is registered as a sixth mode, following the Program pattern (XTRM-433 slice 2):
// reachable from the global rail, its own shortcut, a sidebar with four groups, and two
// list-only work-surface views built on the fixture research adapter.

function renderAt(url: string) {
  const history = createMemoryHistory({ initialEntries: [url] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: fixtureAdapters, history, queryClient });
  render(<RouterProvider router={router} />);
  return { router };
}

/** Same render, with the research adapter overridden. Every failure, empty and loading case
 * below is driven through the adapter, never by stubbing fetch: the surfaces read the adapter
 * only, so the adapter is the single seam that can produce those states. */
function renderWithResearch(url: string, research: Partial<ResearchAdapter>) {
  const history = createMemoryHistory({ initialEntries: [url] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: { ...fixtureAdapters, research: { ...fixtureResearch, ...research } }, history, queryClient });
  render(<RouterProvider router={router} />);
  return { router };
}

const RESEARCH_VIEWS = [
  { url: "/research/experiments", loading: "Loading experiments", empty: "No experiments have a run yet." },
  { url: "/research/runs", loading: "Loading runs", empty: "No runs recorded yet." },
] as const;

describe("Research destination", () => {
  it("appears in the global rail and is reachable by its Mod+<n> shortcut", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/work/issues");
    const rail = await screen.findByTestId("global-rail");
    expect(within(rail).getByRole("button", { name: "Research" })).toBeTruthy();

    fireEvent.click(within(rail).getByRole("button", { name: "Research" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/research/experiments"));
  });

  it("selects Research with the keyboard shortcut for its rail position", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/work/issues");
    await screen.findByTestId("global-rail");
    // Mod+<n> binds to MODES[n-1] (ModeRail), so the key is derived from the position rather
    // than hard-coded: inserting a mode before Research must not silently pass this test.
    const position = MODES.findIndex((m) => m.id === "research") + 1;
    expect(position).toBeGreaterThan(0);
    fireEvent.keyDown(window, { key: String(position), ctrlKey: true });
    await waitFor(() => expect(router.state.location.pathname).toBe("/research/experiments"));
  });

  it("lists all four contextual sidebar groups, the two live ones counting exactly what the adapter returned", async () => {
    // Two distinct experiments across three rows, one of them invalid_manifest: Experiments must
    // count distinct resolvable experiment ids (2), Recent Runs must count every row, including
    // the unresolvable one (3). Stated here rather than borrowed from the slice-1 fixture, so a
    // later slice growing that fixture cannot break this test for an unrelated reason.
    const rows: RunListRow[] = [
      { id: "run-x", status: "success", experiment: "exp-a", variant: "v1", trigger: "baseline", purpose: "p", latestConclusion: null, evidenceStatus: null },
      { id: "run-y", status: "success", experiment: "exp-b", variant: "v1", trigger: "baseline", purpose: "p", latestConclusion: null, evidenceStatus: null },
      { id: "run-z", status: "invalid_manifest", error: "manifest unreadable" },
    ];
    renderWithResearch("/research/experiments", { listRuns: async () => rows });
    const sidebar = await screen.findByTestId("context-sidebar");
    expect(within(sidebar).getByText("Experiments")).toBeTruthy();
    expect(within(sidebar).getByText("Recent Runs")).toBeTruthy();
    expect(within(sidebar).getByText("Saved Comparisons")).toBeTruthy();
    expect(within(sidebar).getByText("Workloads")).toBeTruthy();
    expect(await within(sidebar).findByText("2")).toBeTruthy();
    expect(within(sidebar).getByText("3")).toBeTruthy();
  });

  it("navigating to a deferred sidebar group renders the shared deferred placeholder, not invented UI", async () => {
    const { router } = renderAt("/research/experiments");
    const sidebar = await screen.findByTestId("context-sidebar");
    fireEvent.click(within(sidebar).getByText("Workloads"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/research/workloads"));
    expect(await screen.findByText("Workloads is not part of this vertical")).toBeTruthy();
  });

  it("renders the experiment list derived from listRuns(), with the invalid_manifest run grouped under Unknown experiment rather than dropped", async () => {
    renderAt("/research/experiments");
    expect(await screen.findByText("dup-detect-baseline")).toBeTruthy();
    expect(screen.getByText("2 runs")).toBeTruthy();

    expect(screen.getByText("Unknown experiment — manifest unreadable")).toBeTruthy();
    const unknown = screen.getByLabelText("run-c unknown experiment");
    expect(within(unknown).getByText(/JSONDecodeError/)).toBeTruthy();
  });

  it("renders the run list with trigger, purpose, conclusion, evidence status, no cost column, and an explicit invalid_manifest error row", async () => {
    renderAt("/research/runs");
    expect(await screen.findByLabelText("run-a")).toBeTruthy();
    const healthy = screen.getByLabelText("run-a");
    expect(within(healthy).getByText("baseline")).toBeTruthy();
    expect(within(healthy).getByText("illustrate the xtrm-app research bridge")).toBeTruthy();
    expect(within(healthy).getByText("Baseline lands at chance accuracy, as hypothesised.")).toBeTruthy();
    expect(screen.queryByText("Cost")).toBeNull();

    // The invalid_manifest row renders as an explicit error row and does not break the list.
    const invalid = screen.getByLabelText("run-c invalid manifest");
    expect(within(invalid).getByText(/JSONDecodeError/)).toBeTruthy();
    expect(screen.getByLabelText("run-b")).toBeTruthy();
  });
});

describe("Research uses the shared shell, and nothing of its own", () => {
  it("renders inside the shared shell: one rail, the shared contextual sidebar, the shared inspector rail", async () => {
    renderAt("/research/runs");
    const main = await screen.findByTestId("primary-region");
    expect(within(main).getByRole("region", { name: "Runs" })).toBeTruthy();
    expect(screen.getByTestId("top-bar")).toBeTruthy();
    expect(screen.getByTestId("inspector-rail")).toBeTruthy();
    // One mode rail, one contextual sidebar, and the sidebar is the shared one in Research mode.
    expect(screen.getAllByTestId("global-rail")).toHaveLength(1);
    const sidebars = screen.getAllByTestId("context-sidebar");
    expect(sidebars).toHaveLength(1);
    expect(sidebars[0]!.getAttribute("aria-label")).toBe("Research navigation");
    // Research contributes no navigation of its own inside the work surface.
    expect(within(main).queryByRole("navigation")).toBeNull();
  });

  it("is URL-addressable: each section renders from its own URL and /research redirects to the first section", async () => {
    const { router } = renderAt("/research");
    await waitFor(() => expect(router.state.location.pathname).toBe("/research/experiments"));
    expect(await screen.findByRole("region", { name: "Experiments" })).toBeTruthy();
    expect(modeForPath("/research/runs")).toBe("research");
    expect(modeForPath("/research/experiments")).toBe("research");
  });

  it("inspecting from a Research route opens the canonical drawer in the inspector dock", async () => {
    renderAt("/research/runs?inspect=issue:XTRM-301");
    const el = await screen.findByTestId("inspector-drawer");
    expect(await within(el).findByText("Readiness")).toBeTruthy();
    expect(screen.getByTestId("inspector-dock").contains(el)).toBe(true);
    expect(screen.getByTestId("primary-region").contains(el)).toBe(false);
  });

  it("reports the Research adapter's own source in the shared sidebar footer", async () => {
    renderAt("/research/runs");
    const footer = await screen.findByLabelText("Data sources");
    const row = (await within(footer).findByText("Research")).closest("div")!;
    expect(row.querySelector(".ml-auto")?.textContent).toBe("fixture");
  });

  it("follows the adapter's source rather than a hard-coded string", async () => {
    renderWithResearch("/research/runs", { source: "live" });
    const footer = await screen.findByLabelText("Data sources");
    const row = (await within(footer).findByText("Research")).closest("div")!;
    expect(row.querySelector(".ml-auto")?.textContent).toBe("live");
  });
});

describe("Research list states come from the adapter", () => {
  const onlyInvalid = async (): Promise<RunListRow[]> => (await fixtureResearch.listRuns()).filter(isInvalidManifestRow);

  it("keeps the unknown-experiment group when every row is invalid_manifest, instead of falling back to the empty state", async () => {
    renderWithResearch("/research/experiments", { listRuns: onlyInvalid });
    expect(await screen.findByText("Unknown experiment — manifest unreadable")).toBeTruthy();
    expect(screen.getByLabelText("run-c unknown experiment")).toBeTruthy();
    expect(screen.queryByText("No experiments have a run yet.")).toBeNull();
  });

  it.each(RESEARCH_VIEWS)("renders the empty state at $url when the adapter lists no runs", async ({ url, empty }) => {
    renderWithResearch(url, { listRuns: async () => [] });
    expect(await screen.findByText(empty)).toBeTruthy();
  });

  it.each(RESEARCH_VIEWS)("renders the error state at $url when the adapter rejects", async ({ url, empty }) => {
    const failure = new Error("xtrm-research exited 1: no such command");
    renderWithResearch(url, {
      listRuns: async () => {
        throw failure;
      },
    });
    expect(await screen.findByText("Research bridge unavailable")).toBeTruthy();
    expect(screen.getByText(failure.message)).toBeTruthy();
    // An adapter failure is never reported as "nothing here".
    expect(screen.queryByText(empty)).toBeNull();
  });

  it.each(RESEARCH_VIEWS)("renders the loading state at $url before the adapter resolves", async ({ url, loading }) => {
    renderWithResearch(url, { listRuns: () => new Promise<RunListRow[]>(() => {}) });
    expect(await screen.findByLabelText(loading)).toBeTruthy();
  });

  it.each(RESEARCH_VIEWS)("reads only listRuns() at $url: no per-run `run show` lookup behind the list", async ({ url }) => {
    const getRun = vi.fn(fixtureResearch.getRun);
    const getMetrics = vi.fn(fixtureResearch.getMetrics);
    renderWithResearch(url, { getRun, getMetrics });
    // Wait for the resolved list, so the assertion follows a settled render, not an unmounted one.
    expect(await screen.findByText(url.endsWith("runs") ? "Latest conclusion" : "dup-detect-baseline")).toBeTruthy();
    expect(getRun).not.toHaveBeenCalled();
    expect(getMetrics).not.toHaveBeenCalled();
  });
});
