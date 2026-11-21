import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { fixtureResearch } from "../adapters/research/fixture.ts";
import fixture from "../adapters/research/__fixtures__/xtrm-research-fixture.json";
import { isInvalidManifestRow, type Metric, type ResearchAdapter, type RunListRow, type RunSummary, type SampleRecord, type TailCursor, type TailEvent } from "../adapters/research/types.ts";
import { MODES, modeForPath } from "./destinations.ts";
import { createAppRouter } from "./router.tsx";

// Research is registered as a workspace mode, following the established mode pattern (XTRM-433 slice 2):
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

// Each Research list view has its own read: the Experiments surface is registry-sourced
// (`listExperiments`) so a zero-run definition still appears, while Recent Runs reads `listRuns`.
const RESEARCH_LIST_VIEWS = [
  {
    url: "/research/experiments",
    loading: "Loading experiments",
    empty: "No experiment definitions are registered.",
    errorTitle: "Research registry unavailable",
    emptyOverride: { listExperiments: async () => [], listRuns: async () => [] },
    pendingOverride: { listExperiments: () => new Promise<never>(() => {}) },
    settled: "dup-detect-baseline",
  },
  {
    url: "/research/runs",
    loading: "Loading runs",
    empty: "No runs recorded yet.",
    errorTitle: "Research bridge unavailable",
    emptyOverride: { listRuns: async () => [] },
    pendingOverride: { listRuns: () => new Promise<never>(() => {}) },
    settled: "Latest conclusion",
  },
] as const;

describe("Research destination", () => {
  it("appears in the sidebar and is reachable by its Mod+<n> shortcut", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/work/issues");
    const rail = await screen.findByTestId("context-sidebar");
    expect(within(rail).getByRole("button", { name: "Research" })).toBeTruthy();

    fireEvent.click(within(rail).getByRole("button", { name: "Research" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/research/experiments"));
  });

  it("selects Research with the keyboard shortcut for its mode position", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/work/issues");
    await screen.findByTestId("context-sidebar");
    // Mod+<n> binds to MODES[n-1], so the key is derived from the position rather
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
    const row = (label: string) => within(sidebar).getByText(label).closest('[role="button"]') as HTMLElement;
    expect(await within(row("Experiments")).findByText("2")).toBeTruthy();
    expect(within(row("Recent Runs")).getByText("3")).toBeTruthy();
  });

  it("navigating to a deferred sidebar group renders the shared deferred placeholder, not invented UI", async () => {
    const { router } = renderAt("/research/experiments");
    const sidebar = await screen.findByTestId("context-sidebar");
    fireEvent.click(within(sidebar).getByText("Workloads"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/research/workloads"));
    expect(await screen.findByText("Workloads is not part of this vertical")).toBeTruthy();
  });

  it("renders the registry-sourced experiment list, including a definition with zero runs, and keeps the invalid_manifest run visible", async () => {
    renderAt("/research/experiments");
    expect(await screen.findByText("dup-detect-baseline")).toBeTruthy();
    expect(screen.getByText("2 runs")).toBeTruthy();
    // A definition no run references is still listed, with its count stated explicitly.
    expect(screen.getByText("zero-run-baseline")).toBeTruthy();
    expect(screen.getByText("0 runs")).toBeTruthy();

    expect(screen.getByText("Unreadable run — no resolvable experiment")).toBeTruthy();
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
    // One sidebar, and it is the shared one in Research mode.
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
    // The sources list lives in a drop-up popover: the trigger alone carries the live count.
    const trigger = await screen.findByLabelText("Data sources");
    fireEvent.click(trigger);
    const panel = await screen.findByRole("dialog");
    const row = within(panel).getByText("Research").closest("div")!;
    expect(row.querySelector('[data-testid="source-state"]')?.textContent).toBe("fixture");
  });

  it("follows the adapter's source rather than a hard-coded string", async () => {
    renderWithResearch("/research/runs", { source: "live" });
    const trigger = await screen.findByLabelText("Data sources");
    fireEvent.click(trigger);
    const panel = await screen.findByRole("dialog");
    const row = within(panel).getByText("Research").closest("div")!;
    expect(row.querySelector('[data-testid="source-state"]')?.textContent).toBe("live");
  });
});

describe("Research list states come from the adapter", () => {
  const onlyInvalid = async (): Promise<RunListRow[]> => (await fixtureResearch.listRuns()).filter(isInvalidManifestRow);

  it("keeps the unreadable-run group when every run row is invalid_manifest, instead of falling back to the empty state", async () => {
    renderWithResearch("/research/experiments", { listRuns: onlyInvalid });
    expect(await screen.findByText("Unreadable run — no resolvable experiment")).toBeTruthy();
    expect(screen.getByLabelText("run-c unknown experiment")).toBeTruthy();
    expect(screen.queryByText("No experiment definitions are registered.")).toBeNull();
  });

  it.each(RESEARCH_LIST_VIEWS)("renders the empty state at $url when the adapter lists nothing", async ({ url, empty, emptyOverride }) => {
    renderWithResearch(url, emptyOverride);
    expect(await screen.findByText(empty)).toBeTruthy();
  });

  it.each(RESEARCH_LIST_VIEWS)("renders the error state at $url when the adapter rejects", async ({ url, empty, errorTitle, emptyOverride }) => {
    const failure = new Error("xtrm-research exited 1: no such command");
    const failing = "listExperiments" in emptyOverride ? { listExperiments: async (): Promise<never> => { throw failure; } } : { listRuns: async (): Promise<never> => { throw failure; } };
    renderWithResearch(url, failing);
    expect(await screen.findByText(errorTitle)).toBeTruthy();
    expect(screen.getByText(failure.message)).toBeTruthy();
    // An adapter failure is never reported as "nothing here".
    expect(screen.queryByText(empty)).toBeNull();
  });

  it.each(RESEARCH_LIST_VIEWS)("renders the loading state at $url before the adapter resolves", async ({ url, loading, pendingOverride }) => {
    renderWithResearch(url, pendingOverride);
    expect(await screen.findByLabelText(loading)).toBeTruthy();
  });

  it.each(RESEARCH_LIST_VIEWS)("reads only the list verbs at $url: no per-run `run show` or `metrics` lookup behind the list", async ({ url, settled }) => {
    const getRun = vi.fn(fixtureResearch.getRun);
    const getMetrics = vi.fn(fixtureResearch.getMetrics);
    renderWithResearch(url, { getRun, getMetrics });
    // Wait for the resolved list, so the assertion follows a settled render, not an unmounted one.
    expect(await screen.findByText(settled)).toBeTruthy();
    expect(getRun).not.toHaveBeenCalled();
    expect(getMetrics).not.toHaveBeenCalled();
  });
});

describe("Experiment detail surface", () => {
  it("opens a registry definition with zero runs from its list row and renders every declared semantic field", async () => {
    const { router } = renderAt("/research/experiments");
    fireEvent.click(await screen.findByLabelText("zero-run-baseline"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/research/experiments/zero-run-baseline"));

    const main = await screen.findByRole("region", { name: "Experiment zero-run-baseline" });
    const zeroRun = fixture.experimentShowZeroRun as Record<string, unknown>;
    expect(within(main).getByText(String(zeroRun.description))).toBeTruthy();
    expect(within(main).getByText(String(zeroRun.research_question))).toBeTruthy();
    expect(within(main).getByText(String(zeroRun.hypothesis))).toBeTruthy();
    expect(within(main).getByText(/Named dataset/)).toBeTruthy();
    expect(within(main).getByText("Supports the hypothesis if")).toBeTruthy();
    expect(within(main).getByText("Falsifies the hypothesis if")).toBeTruthy();
    expect(within(main).getByText("This experiment does not establish")).toBeTruthy();
    // Glossary entry renders its label, direction and unit, not a bare id.
    expect(within(main).getByText("Accuracy")).toBeTruthy();
    expect(within(main).getByText(/↑ higher is better/)).toBeTruthy();
    // Declared charts are listed even though no run can populate them.
    expect(within(main).getByText("Accuracy by run")).toBeTruthy();
    expect(within(main).getByText("No runs reference this experiment.")).toBeTruthy();
  });

  it("shows the runs that reference an experiment and opens run analysis from one", async () => {
    const { router } = renderAt("/research/experiments/dup-detect-baseline");
    const main = await screen.findByRole("region", { name: "Experiment dup-detect-baseline" });
    const related = await within(main).findByRole("region", { name: "Related runs" });
    expect(await within(related).findByLabelText("run-a")).toBeTruthy();
    expect(within(related).getByLabelText("run-b")).toBeTruthy();
    fireEvent.click(within(related).getByLabelText("run-a"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/research/runs/run-a"));
  });

  it("renders an explicit unavailable state for an experiment definition the registry does not carry", async () => {
    const failure = new Error("no experiment definition 'ghost' under /srv/registry");
    renderWithResearch("/research/experiments/ghost", {
      getExperiment: async () => {
        throw failure;
      },
    });
    expect(await screen.findByText("Experiment definition unavailable: ghost")).toBeTruthy();
    expect(screen.getByText(failure.message)).toBeTruthy();
  });
});

describe("Run analysis surface (XTRM-433 slice 3)", () => {
  it("opens from a run row and renders manifest/versions, lineage, metrics with a null-interval method, and annotations", async () => {
    const { router } = renderAt("/research/runs");
    fireEvent.click(await screen.findByLabelText("run-a"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/research/runs/run-a"));

    const main = await screen.findByRole("region", { name: "Run run-a" });
    expect(within(main).getByText("dup-detect-baseline@v1")).toBeTruthy();
    expect(within(main).getByText(/v1 · v1 · gen_ai\/v1\.28/)).toBeTruthy();

    // exact-match::latency_ms has null se/ci95: the method stands in for the missing interval.
    expect(within(main).getByText("no interval — single-sample-no-variance")).toBeTruthy();
    expect(within(main).getByText("Baseline lands at chance accuracy, as hypothesised.")).toBeTruthy();
    expect(await within(main).findByRole("region", { name: "Charts" })).toBeTruthy();
    expect(within(main).getByRole("article", { name: "Accuracy by run" })).toBeTruthy();
    expect((await within(main).findByLabelText("accuracy chart")).textContent).toContain("baseline");
  });

  it("renders the sample table from samples.jsonl, including input/output/candidate and the usage-unavailable state with its null_reason", async () => {
    renderAt("/research/runs/run-a");
    const main = await screen.findByRole("region", { name: "Run run-a" });
    const first = await within(main).findByLabelText("s-0");
    expect(within(first).getByText("42 in / 7 out")).toBeTruthy();
    // input/output/candidate come from the sample record, not from any event's data field.
    expect(within(first).getByText(/a-0/)).toBeTruthy();
    expect(within(first).getAllByText(/\"duplicate\":false/).length).toBeGreaterThan(0);
    expect(within(within(main).getByLabelText("s-1")).getByText("usage unavailable — not_exposed_by_provider")).toBeTruthy();
    // Telemetry is a separate view, labelled as such, never merged into the sample table.
    expect(within(main).getByRole("region", { name: "Telemetry events" })).toBeTruthy();
  });

  it("renders an explicit error naming the run when its manifest is unreadable, never a crash", async () => {
    const failure = new Error("unknown run: run-ghost");
    renderWithResearch("/research/runs/run-ghost", {
      getRun: async () => {
        throw failure;
      },
    });
    expect(await screen.findByText("Run manifest unreadable: run-ghost")).toBeTruthy();
    expect(screen.getByText(failure.message)).toBeTruthy();
  });

  it("renders an explicit 'Accounting provenance unavailable' state instead of a blank when the manifest carries no readable accounting block", async () => {
    const runShow = { ...fixture.runShowA, manifest: { ...fixture.runShowA.manifest, accounting: undefined } };
    renderWithResearch("/research/runs/run-a", { getRun: async () => ({ manifest: runShow.manifest as never, status: "success", annotations: [] }) });
    expect(await screen.findByText("Accounting provenance unavailable")).toBeTruthy();
  });

  it("opens the canonical inspector for a metric, a sample and an annotation, never a Research-owned panel", async () => {
    renderAt("/research/runs/run-a");
    const main = await screen.findByRole("region", { name: "Run run-a" });
    fireEvent.click(await within(main).findByLabelText("exact-match::latency_ms"));
    let drawer = await screen.findByTestId("inspector-drawer");
    expect(within(drawer).getByText("no interval — single-sample-no-variance")).toBeTruthy();

    fireEvent.click(within(main).getByLabelText("s-1"));
    drawer = await screen.findByTestId("inspector-drawer");
    expect((await within(drawer).findAllByText("not_exposed_by_provider", { exact: false })).length).toBeGreaterThan(0);

    fireEvent.click(within(main).getByLabelText("conclusion"));
    drawer = await screen.findByTestId("inspector-drawer");
    expect(await within(drawer).findByText("Baseline lands at chance accuracy, as hypothesised.")).toBeTruthy();
  });

  it("opens run provenance from a lineage reference, with an Open action back to the full page", async () => {
    renderAt("/research/runs/run-b");
    const main = await screen.findByRole("region", { name: "Run run-b" });
    fireEvent.click(await within(main).findByText("retry_of → run-a"));
    const drawer = await screen.findByTestId("inspector-drawer");
    expect(await within(drawer).findByText("Open run analysis")).toBeTruthy();
  });
});

describe("Comparison surface (XTRM-433 slice 3)", () => {
  it("prompts for a baseline and a candidate when neither is selected", async () => {
    renderAt("/research/compare");
    expect(await screen.findByText("Select a baseline and at least one candidate run to compare")).toBeTruthy();
  });

  it("renders baseline vs candidate metric deltas over the shared sample set", async () => {
    renderAt("/research/compare?baseline=run-a&candidate=run-b");
    expect(await screen.findByText("run-a (baseline)")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "run-b" })).toBeTruthy();
    // run-b has no metrics in the fixture: an absent metric renders "not reported", not blank.
    expect(screen.getAllByText("not reported").length).toBeGreaterThan(0);
  });

  it("renders an explicit failure naming the comparison and the reason, never an empty table, when compare() fails as a whole", async () => {
    const reason = (fixture.compareInvalidEnvelope as { error: string }).error;
    renderWithResearch("/research/compare?baseline=run-a&candidate=run-missing", {
      compare: async () => {
        throw new Error(reason);
      },
    });
    expect(await screen.findByText("Comparison failed: run-a vs run-missing")).toBeTruthy();
    expect(screen.getByText(reason)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("is reachable by selecting two or more runs from Recent Runs and choosing Compare", async () => {
    const { router } = renderAt("/research/runs");
    fireEvent.click(await screen.findByLabelText("Select run-a for comparison"));
    fireEvent.click(screen.getByLabelText("Select run-b for comparison"));
    fireEvent.click(await screen.findByText("Compare 2 runs"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/research/compare"));
    expect(router.state.location.search).toMatchObject({ baseline: "run-a", candidate: ["run-b"] });
  });
});

// --- slice 3 edge cases -----------------------------------------------------
// Every state below is driven through an adapter override, never through the captured
// fixture: the fixture is regenerated from the real Python package (scripts/
// generate-research-fixtures.py) and must keep recording one honest run, not a catalogue of
// pathological shapes.

const summary = (metrics: Record<string, Metric>): RunSummary => ({ metrics, sampleCount: 1, eventCount: 1 });

/** se is null, ci95 is present. */
const CI_ONLY: Metric = { value: 0.5, se: null, ci95: [0.1, 0.9], n: 4, method: "bootstrap-percentile" };
/** The reverse: se is present, ci95 is null. */
const SE_ONLY: Metric = { value: 2, se: 0.25, ci95: null, n: 4, method: "normal-approx-no-interval" };

async function openDrawer(el: HTMLElement) {
  await waitFor(() => expect(el.textContent!.length).toBeGreaterThan("Inspector".length + 3));
}

describe("A metric renders value, interval and method together, whichever half is null", () => {
  const getMetrics = async () => summary({ "m::ci-only": CI_ONLY, "m::se-only": SE_ONLY });

  it("shows the interval when only se is null, and the method in place of the interval when only ci95 is null — never a value on its own", async () => {
    renderWithResearch("/research/runs/run-a", { getMetrics });
    const ciOnly = await screen.findByLabelText("m::ci-only");
    expect(within(ciOnly).getByText("95% CI [0.1, 0.9]")).toBeTruthy();
    expect(within(ciOnly).getByText("bootstrap-percentile")).toBeTruthy();

    const seOnly = screen.getByLabelText("m::se-only");
    expect(within(seOnly).getByText("no interval — normal-approx-no-interval")).toBeTruthy();
    // Both rows name their method, so the value never stands alone with nothing qualifying it.
    for (const row of [ciOnly, seOnly]) expect(row.textContent).toMatch(/bootstrap-percentile|normal-approx-no-interval/);
  });

  it("puts the method in the SE field of the drawer when se is null but the interval is present", async () => {
    renderWithResearch("/research/runs/run-a?inspect=research-metric%3Arun-a%7Cm%3A%3Aci-only", { getMetrics });
    const drawer = await screen.findByTestId("inspector-drawer");
    await openDrawer(drawer);
    expect(within(drawer).getByText("[0.100, 0.900]")).toBeTruthy();
    // The SE row's value cell, asserted exactly. `drawer.textContent` can never end in "SE" (the
    // last row is always Method), so a blank, a 0 or a literal `null` in the SE row passed that
    // suffix check; the exact text fails all three.
    const seCell = within(drawer).getByText("SE").parentElement!.querySelector("dd")!;
    expect(seCell.textContent).toBe("n/a — bootstrap-percentile");
  });

  it("puts the method in the interval field of the drawer when ci95 is null but se is present", async () => {
    renderWithResearch("/research/runs/run-a?inspect=research-metric%3Arun-a%7Cm%3A%3Ase-only", { getMetrics });
    const drawer = await screen.findByTestId("inspector-drawer");
    await openDrawer(drawer);
    expect(within(drawer).getByText("no interval — normal-approx-no-interval")).toBeTruthy();
    expect(within(drawer).getByText("0.250")).toBeTruthy();
  });

  it("renders se and n alongside the interval in the run analysis table, never a value on its own", async () => {
    renderWithResearch("/research/runs/run-a", { getMetrics });
    const ciOnly = await screen.findByLabelText("m::ci-only");
    expect(within(ciOnly).getByText("95% CI [0.1, 0.9]")).toBeTruthy();
    expect(within(ciOnly).getByText("se n/a — bootstrap-percentile")).toBeTruthy();
    expect(within(ciOnly).getByText("n=4")).toBeTruthy();

    const seOnly = screen.getByLabelText("m::se-only");
    expect(within(seOnly).getByText("se=0.25")).toBeTruthy();
    expect(within(seOnly).getByText("n=4")).toBeTruthy();
    expect(within(seOnly).getByText("normal-approx-no-interval")).toBeTruthy();
  });

  it("renders se, n and method alongside the interval in a comparison cell", async () => {
    const compare = async () => ({ "run-a": summary({ "m::ci-only": CI_ONLY, "m::se-only": SE_ONLY }), "run-b": summary({ "m::ci-only": SE_ONLY, "m::se-only": CI_ONLY }) });
    renderWithResearch("/research/compare?baseline=run-a&candidate=run-b", { compare });
    const table = await screen.findByRole("table");
    // One row per metric key (sorted): m::ci-only, then m::se-only. Cell 1 of each row is the
    // baseline's; the shared widget must carry the whole tuple there, not just value + interval.
    const rows = within(table).getAllByRole("row").slice(1);
    const baselineCell = (row: HTMLElement) => within(row).getAllByRole("cell")[1]!;

    const ciOnly = baselineCell(rows[0]!);
    expect(within(ciOnly).getByText("0.5")).toBeTruthy();
    expect(within(ciOnly).getByText("95% CI [0.1, 0.9]")).toBeTruthy();
    expect(within(ciOnly).getByText("se n/a — bootstrap-percentile")).toBeTruthy();
    expect(within(ciOnly).getByText("n=4")).toBeTruthy();
    expect(within(ciOnly).getByText("bootstrap-percentile")).toBeTruthy();

    const seOnly = baselineCell(rows[1]!);
    expect(within(seOnly).getByText("2")).toBeTruthy();
    expect(within(seOnly).getByText("no interval — normal-approx-no-interval")).toBeTruthy();
    expect(within(seOnly).getByText("se=0.25")).toBeTruthy();
    expect(within(seOnly).getByText("n=4")).toBeTruthy();
  });

  it("declares as many header columns as a body row has cells", async () => {
    renderAt("/research/compare?baseline=run-a&candidate=run-b");
    const table = await screen.findByRole("table");
    const [header, firstBodyRow] = within(table).getAllByRole("row");
    // A candidate header spans two columns (its value and its delta) through CSS grid. A grid
    // span is invisible to assistive technology, so the span must also be declared as
    // aria-colspan: without it the header row claims a column the body never has.
    const declared = within(header!)
      .getAllByRole("columnheader")
      .reduce((total, cell) => total + Number(cell.getAttribute("aria-colspan") ?? 1), 0);
    expect(declared).toBe(firstBodyRow!.children.length);
    expect(screen.getByRole("columnheader", { name: "run-b" }).getAttribute("aria-colspan")).toBe("2");
  });
});

describe("Usage with some fields null and some present under one null_reason", () => {
  const MIXED_SAMPLE: SampleRecord = {
    sampleId: "s-mixed",
    index: 1,
    status: "ok",
    input: { pair: ["a-mixed", "b-mixed"] },
    output: { duplicate: false },
    candidate: { duplicate: false, confidence: 0.5 },
    // One null_reason covers every null field; the present fields are real readings.
    usage: { source: "provider_api", inputTokens: 42, outputTokens: null, requestModel: "always-no-1", responseModel: null, latencyMs: 118.5, nullReason: "provider omitted completion tokens" },
    createdAt: "2026-09-17T12:00:00+00:00",
  };
  const getSamples = async () => [MIXED_SAMPLE];

  it("renders the present values and the reason for the null ones in the drawer, never a zero", async () => {
    renderWithResearch("/research/runs/run-a?inspect=research-sample%3Arun-a%7Cs-mixed", { getSamples });
    const drawer = await screen.findByTestId("inspector-drawer");
    await openDrawer(drawer);
    expect(within(drawer).getByText("42")).toBeTruthy();
    expect(within(drawer).getByText("always-no-1")).toBeTruthy();
    expect(within(drawer).getByText("118.5 ms")).toBeTruthy();
    // Output tokens and response model are null: both show the one reason, neither shows 0.
    expect(within(drawer).getAllByText("unavailable — provider omitted completion tokens")).toHaveLength(2);
    expect(within(drawer).queryByText("0")).toBeNull();
  });

  it("names the reason for a null token count in the sample row, rather than printing `null`", async () => {
    renderWithResearch("/research/runs/run-a", { getSamples });
    const row = await screen.findByLabelText("s-mixed");
    expect(row.textContent).not.toMatch(/\bnull\b/);
    expect(row.textContent).toContain("provider omitted completion tokens");
  });
});

describe("Experiment-defined comparison charts", () => {
  it("renders the same chart contract over the selected runs and names missing values honestly", async () => {
    renderAt("/research/compare?baseline=run-a&candidate=run-b");
    const charts = await screen.findByRole("region", { name: "Charts" });
    expect(within(charts).getByRole("article", { name: "Accuracy by run" })).toBeTruthy();
    expect((await within(charts).findByLabelText("accuracy chart")).textContent).toContain("not reported");
  });

  it("keeps one heading in the charts region and names every chart on its own article", async () => {
    renderAt("/research/compare?baseline=run-a&candidate=run-b");
    const charts = await screen.findByRole("region", { name: "Charts" });
    // A chart is a card, not a heading: one heading names the group, and each chart is identified
    // by its article's accessible name. Asserted as a sequence, because a per-level presence check
    // still passes after someone flattens the group heading into the charts themselves.
    const headings = within(charts).getAllByRole("heading");
    expect(headings).toHaveLength(1);
    expect(headings[0]!.textContent).toBe("Charts");
    const articles = within(charts).getAllByRole("article");
    expect(articles.length).toBeGreaterThan(0);
    for (const article of articles) {
      expect((article.getAttribute("aria-label") ?? "").trim().length).toBeGreaterThan(0);
    }
  });
});

describe("Comparison with nothing in common", () => {
  it("marks every cell of a metric the run does not report as 'not reported' and its delta as absent, never 0", async () => {
    // Two runs, disjoint metric keys: the union has two rows and each has exactly one real value.
    // Declared so that insertion order (z::only first, from the baseline) differs from sorted
    // order: removing the sort in RunComparisonSurface changes the rendered row order and fails
    // the assertion below, which pins sorted order.
    const compare = async () => ({
      "run-a": summary({ "z::only": { value: 1, se: null, ci95: null, n: 1, method: "m1" } }),
      "run-b": summary({ "a::only": { value: 2, se: null, ci95: null, n: 1, method: "m2" } }),
    });
    renderWithResearch("/research/compare?baseline=run-a&candidate=run-b", { compare });
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[0]!.textContent)).toEqual(["a::only", "z::only"]);
    for (const row of rows) {
      expect(within(row).getAllByText("not reported")).toHaveLength(1);
      // The delta cell is the last one: absent, not a zero that would read as "no change".
      const cells = within(row).getAllByRole("cell");
      expect(cells[cells.length - 1]!.textContent).toBe("—");
    }
    expect(within(table).queryByText("0")).toBeNull();
  });

  it("keeps the baseline's metrics visible when a candidate reports none at all", async () => {
    // compareAB already models this (run-b carries `metrics: {}`); asserted here on the delta
    // column, which the slice-2 test does not reach.
    renderAt("/research/compare?baseline=run-a&candidate=run-b");
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const cells = within(row).getAllByRole("cell");
      expect(within(row).getAllByText("not reported")).toHaveLength(1);
      expect(cells[cells.length - 1]!.textContent).toBe("—");
    }
  });
});

describe("Research drawers open from the URL alone, and name what is missing", () => {
  // `?inspect=<kind>:<ref>` is the canonical deep link (shell/layout.ts §9.1). Research refs are
  // `<runId>|<detail>`, so the `|` is percent-encoded in the URL.
  it.each([
    { kind: "research-run", ref: "run-a", expect: "Run provenance" },
    { kind: "research-metric", ref: "run-a|exact-match::accuracy", expect: "exact-match::accuracy" },
    { kind: "research-sample", ref: "run-a|s-1", expect: "s-1" },
    { kind: "research-annotation", ref: "run-a|0", expect: "conclusion" },
  ])("opens the $kind drawer with no prior interaction", async ({ kind, ref, expect: text }) => {
    renderAt(`/research/runs?inspect=${encodeURIComponent(`${kind}:${ref}`)}`);
    const drawer = await screen.findByTestId("inspector-drawer");
    await openDrawer(drawer);
    expect(await within(drawer).findByText(text)).toBeTruthy();
    // The shared dock owns the only drawer in the document, and the work surface renders none of
    // the drawer's content: moving research detail into a Research-owned panel adds a second
    // drawer, or the same content, outside the dock and fails here.
    const dock = screen.getByTestId("inspector-dock");
    expect(screen.getAllByTestId("inspector-drawer")).toEqual([drawer]);
    expect(dock.contains(drawer)).toBe(true);
    expect(within(screen.getByTestId("primary-region")).queryByText(text)).toBeNull();
  });

  it.each([
    { what: "a run that does not exist", ref: "research-run:run-ghost", expect: "Run manifest unreadable: run-ghost" },
    { what: "a metric the run does not report", ref: "research-metric:run-a|nope::missing", expect: "nope::missing is not reported for run-a" },
    { what: "a sample not in the run's sample records", ref: "research-sample:run-a|s-404", expect: "s-404 is not in this run's sample records" },
    { what: "an annotation index past the end", ref: "research-annotation:run-a|99", expect: "Annotation is outside the loaded log" },
    { what: "a sample of a run with no records", ref: "research-sample:run-ghost|s-0", expect: "Sample records unavailable for run-ghost" },
  ])("renders a named not-found state, not a blank drawer, for $what", async ({ ref, expect: text }) => {
    renderAt(`/research/runs?inspect=${encodeURIComponent(ref)}`);
    const drawer = await screen.findByTestId("inspector-drawer");
    expect(await within(drawer).findByText(text, { exact: false })).toBeTruthy();
  });
});

describe("No Research surface renders a money figure", () => {
  // Rev 10: cost does not exist in packages/research. manifest.accounting records what a run was
  // accounted against, never what it cost, so a currency symbol anywhere is an invented number.
  const MONEY = /[$€£¥₹]|\b(?:USD|EUR|GBP|dollars?|cents?)\b|\bcost\b/i;

  it.each(["/research/experiments", "/research/runs", "/research/runs/run-a", "/research/compare?baseline=run-a&candidate=run-b"])("renders no currency at %s", async (url) => {
    renderAt(url);
    const main = await screen.findByTestId("primary-region");
    // Wait for the settled surface: an empty skeleton trivially contains no currency.
    await waitFor(() => expect(main.textContent!.length).toBeGreaterThan(80));
    expect(main.textContent).not.toMatch(MONEY);
  });

  it.each(["research-run:run-a", "research-metric:run-a|exact-match::accuracy", "research-sample:run-a|s-0", "research-annotation:run-a|0"])("renders no currency in the %s drawer either", async (ref) => {
    renderAt(`/research/runs?inspect=${encodeURIComponent(ref)}`);
    const drawer = await screen.findByTestId("inspector-drawer");
    await openDrawer(drawer);
    expect(drawer.textContent).not.toMatch(MONEY);
  });
});

describe("Run analysis resolves the versioned Experiment/Workload/QuestionSpec behind a run", () => {
  // The run page must render scientific meaning from the *definitions the manifest references*,
  // never from prose copied into the manifest (Jira XTRM-99 c.13438). Each adapter call below is
  // the only source of one part of the page, so a regression that re-inlines semantics into the
  // manifest — or drops the definition fetch — fails here.
  const v2 = {
    manifest: {
      ...fixture.runShowA.manifest,
      experiment: { id: "planning-ready-v2", version: "v1", content_hash: "sha256:" + "a".repeat(64) },
      workload: { id: "planning-ready", version: "v1", content_hash: "sha256:" + "b".repeat(64) },
    },
    status: "success",
    annotations: [
      {
        kind: "result_summary",
        evidence_status: "exploratory",
        result_summary: {
          plain_language: "Atomic System One checks recovered most ready contracts and escalated the uncertain ones.",
          supported_claims: ["P(success_observable) carries signal"],
          unsupported_claims: ["production adoption"],
          caveats: ["labels are adjudicated"],
          decision: "keep the incumbent readiness logic until outcome labels exist",
        },
      },
    ],
  };
  const experiment = {
    id: "planning-ready-v2",
    version: "v1",
    description: "Does an atomic System One policy decide Planning contract readiness?",
    hypothesis: "Atomic checks separate ready from draft contracts better than one holistic judgment.",
    research_question: "Can atomic System One checks decide whether a Planning contract is ready?",
    primary_outcomes: ["test.false_ready_rate"],
    success_criteria: ["false-READY rate below the holistic arm's"],
    falsification_criteria: ["no separation from the holistic arm"],
    non_claims: ["no production adoption"],
    metric_glossary: {
      // ids mirror the persisted metric leaves ("test." partition prefix): a bare
      // name resolves to nothing and renders an empty chart
      "test.false_ready_rate": {
        label: "False READY rate",
        description: "Share of non-ready contracts the policy marked READY.",
        direction: "lower_better",
        interpretation: "0 means no non-ready contract was accepted.",
      },
    },
    terminology: { Noul: "P(yes) for a yes/no question, with no separate confidence field." },
    named_datasets: ["test.false_ready_rate"],
    legend: { "test.false_ready_rate": "false READY rate", "jev-latest": "System One answers from the resolved Jev model" },
  };
  const workload = { id: "planning-ready", version: "v1", questions: [{ id: "planning-ready.success_observable", version: "v1" }] };
  const questionSpec = {
    id: "planning-ready.success_observable",
    version: "v1",
    type: "noul",
    instructions: "Judge whether SUCCESS names an observable outcome.",
    criteria: { true: "an operator can run or see the result", false: "success is a feeling or an intention" },
  };

  const adapters = {
    getRun: async () => v2 as never,
    getExperiment: async () => experiment,
    getWorkload: async () => workload,
    getQuestionSpec: async () => questionSpec,
  };

  it("shows why, what would count, the structured result, and the primitive types", async () => {
    renderWithResearch("/research/runs/run-a", adapters);
    const main = await screen.findByRole("region", { name: "Run run-a" });

    // WHY — question and hypothesis stay distinct, and the run's own rationale is present.
    expect(await within(main).findByText(experiment.research_question)).toBeTruthy();
    expect(within(main).getByText(experiment.hypothesis)).toBeTruthy();
    // Canonical System One terminology comes from the versioned Experiment definition.
    expect(within(main).getByText(/no separate confidence field/)).toBeTruthy();

    // WHAT WOULD COUNT.
    expect(within(main).getByText("Supports the hypothesis if")).toBeTruthy();
    expect(within(main).getByText("Falsifies the hypothesis if")).toBeTruthy();
    expect(within(main).getByText("no production adoption")).toBeTruthy();

    // WHAT IT MEANS — plain language, claims, caveats and decision.
    const result = within(main).getByRole("region", { name: "Result" });
    expect(within(result).getByText(/recovered most ready contracts/)).toBeTruthy();
    expect(within(result).getByText("P(success_observable) carries signal")).toBeTruthy();
    expect(within(result).getByText(/keep the incumbent readiness logic/)).toBeTruthy();

    // METHOD — the System One question with its actual primitive type and criteria.
    expect(await within(main).findByText("noul")).toBeTruthy();
    expect(within(main).getByText(questionSpec.instructions)).toBeTruthy();
    expect(within(main).getByText("an operator can run or see the result")).toBeTruthy();
  });

  it("renders each metric with its glossary meaning and direction, not a bare identifier", async () => {
    const getMetrics = async () => summary({ "planning-eval::test.false_ready_rate": { value: 0.07, se: null, ci95: [0.02, 0.12], n: 40, method: "cluster-bootstrap" } });
    renderWithResearch("/research/runs/run-a", { ...adapters, getMetrics });
    const main = await screen.findByRole("region", { name: "Run run-a" });
    expect(await within(main).findByText("False READY rate")).toBeTruthy();
    expect(within(main).getByText(/Share of non-ready contracts/)).toBeTruthy();
    expect(within(main).getByText(/↓ lower is better/)).toBeTruthy();
    expect(await within(main).findByText(questionSpec.instructions)).toBeTruthy();
  });
});

describe("Research page outlines", () => {
  // XTRM-954. Each route's outline is pinned as a SEQUENCE of (level, text) in rendered order, not as
  // a set of levels: a per-level presence check passes when someone flattens a group, and a
  // "never jumps more than one level" check passes when a sibling is rendered one level too deep,
  // because 2 then 3 is a legal nesting step. Pinned sequences fail on both. The expectation is
  // fixture-coupled on purpose: adding a section to a Research page should be a visible edit here.
  //
  // The invariant: the first heading on a page is level 1 or 2, depth never exceeds 4 (XTRM-940
  // seq 6), and a level-3 heading is a group inside a page — which is why the experiment page's
  // nested "Charts" group is the only level-3 entry, and the run page's "Charts" section is level 2.
  const PAGES = [
    {
      url: "/research/experiments",
      ready: () => screen.findByText("dup-detect-baseline"),
      expected: ["2 Unreadable run — no resolvable experiment"],
    },
    {
      url: "/research/experiments/dup-detect-baseline",
      ready: () => screen.findByText("Metric glossary"),
      expected: ["2 Definition", "2 Metric glossary", "2 Declared charts", "3 Charts", "2 Related runs"],
    },
    {
      url: "/research/runs/run-a",
      ready: () => screen.findByText("Manifest & versions"),
      expected: [
        "2 Why this run",
        "2 Method",
        "2 Metrics",
        "2 Charts",
        "2 Samples",
        "2 Telemetry events",
        "2 Annotations",
        "2 Manifest & versions",
      ],
    },
    {
      url: "/research/compare?baseline=run-a&candidate=run-b",
      ready: () => screen.findByRole("table", { name: "Metric comparison" }),
      expected: ["2 Charts"],
    },
  ] as const;

  it.each(PAGES)("starts at level 2 and nests its groups: $url", async ({ url, ready, expected }) => {
    renderAt(url);
    await ready();
    // The chart group mounts after first paint; waiting for it makes the sequence the complete one.
    await screen.findByText("Charts").catch(() => null);
    const actual = screen
      .queryAllByRole("heading")
      .map((h) => `${Number(h.tagName.slice(1))} ${h.textContent}`);
    expect(actual, "a Research page opens at level 2, never deeper than 4, and renders a group at 3").toEqual([...expected]);
  });

  it("leaves the runs list heading-free, as the other list surfaces are", async () => {
    renderAt("/research/runs");
    await screen.findByText("Latest conclusion");
    // Deliberate, recorded at the Runs section in ResearchSurface.tsx: a list surface carries its
    // name in the toolbar and its outline is the column headers. The literal is 0, not "fewer than a
    // detail page" — an agreement between two routes can be satisfied by a page that is uniformly
    // wrong, and an exception recorded only in prose is indistinguishable from an oversight the day
    // someone adds a heading here by accident.
    expect(
      screen.queryAllByRole("heading").map((h) => h.textContent),
      "a list surface's name lives in the toolbar and its outline is the column headers: IssuesSurface.tsx and PullsSurface.tsx each emit zero headings, so /research/runs gains a page title only by amending XTRM-954 rule (10)",
    ).toHaveLength(0);
  });
});
