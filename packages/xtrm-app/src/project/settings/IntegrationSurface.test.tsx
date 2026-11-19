import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { StatusBoardAdapter } from "../../adapters/status-board/types.ts";
import { fixtureAdapters } from "../../adapters/index.tsx";
import { FIXTURE_BOARD_REPO, createStatusBoardFixtureAdapter } from "../../adapters/status-board/fixture.ts";
import { createAppRouter } from "../../app/router.tsx";

function renderIntegration(board: StatusBoardAdapter) {
  const history = createMemoryHistory({ initialEntries: [`/rep/${FIXTURE_BOARD_REPO}/project/settings`] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: { ...fixtureAdapters, statusBoard: board }, history, queryClient });
  render(<RouterProvider router={router} />);
  return board;
}

const field = (testId: string) => screen.getByTestId(testId).textContent ?? "";

describe("Project Integration", () => {
  it("renders every resolved binding field and the sync health, paths only", async () => {
    const board = createStatusBoardFixtureAdapter();
    renderIntegration(board);
    await screen.findByRole("region", { name: "Integration" });

    const binding = await board.binding(FIXTURE_BOARD_REPO);
    if (!binding.configured || !binding.statusBoard || !binding.jira) throw new Error("the fixture must bind this repository");

    await waitFor(() => expect(field("integration-repository")).toBe(binding.repository));
    expect(field("integration-resolved-by")).toBe("the repository slug");
    expect(field("integration-pm-project")).toBe(binding.pmProject);
    expect(field("integration-substrate-project")).toBe(binding.substrateProject);
    expect(field("integration-board-site")).toBe(binding.statusBoard.site);
    expect(field("integration-state-dir")).toBe(binding.statusBoard.stateDir);
    expect(field("integration-jira-site")).toBe(binding.jira.site);
    expect(field("integration-jira-project")).toBe(binding.jira.project);

    // Credential evidence is a path plus a flag: never a value.
    expect(field("integration-key-file")).toBe(`${binding.statusBoard.keyFile} — readable`);
    expect(screen.getByTestId("integration-credential-note").textContent).toMatch(/never returns a credential value/);

    // Sync health: the schedule and the unit, the last sync and the drift count.
    await waitFor(() => expect(field("health-drift")).toBe("0 records"));
    expect(field("health-unit")).toBe("running");
    expect(field("health-schedule")).toBe("active");
    expect(field("health-run")).toBe("no sync is running");
    expect(field("health-freshness")).toBe("fresh");
    // The fixture reads the clock per call, so the stamp is shaped, not equality-matched.
    expect(field("health-last-sync")).toMatch(/ago · \d{4}-\d{2}-\d{2}T/);
    expect(screen.getByTestId("health-unit").getAttribute("data-unverified")).toBeNull();
  });

  it("renders a null health fact as unverified with its own reason, never as down", async () => {
    const board = createStatusBoardFixtureAdapter();
    const base = await board.health(FIXTURE_BOARD_REPO);
    const unverified: StatusBoardAdapter = {
      ...board,
      health: async () => ({
        ...base,
        lastSyncOkAt: null,
        driftCount: null,
        unitActive: null,
        unitActiveReason: "probe_timeout",
        scheduleActive: null,
        scheduleActiveReason: "non_user_session",
        runInProgress: null,
        runInProgressReason: "unit_not_found",
        stale: null,
      }),
    };
    renderIntegration(unverified);
    const region = await screen.findByRole("region", { name: "Integration" });

    await waitFor(() => expect(field("health-unit")).toContain("unverified"));
    expect(field("health-unit")).toContain("probe timed out");
    expect(field("health-schedule")).toContain("does not run as a user session");
    expect(field("health-run")).toContain("unit was not found");
    expect(field("health-drift")).toContain("unverified");
    expect(field("health-last-sync")).toBe("not reported");
    expect(screen.getByTestId("health-unit").getAttribute("data-unverified")).toBe("true");

    // The unverified facts must not be restated as a failure the probe never observed.
    expect(region.textContent).not.toMatch(/\bdown\b/i);
    expect(region.textContent).not.toContain("not running");
    expect(region.textContent).not.toContain("not active");
  });

  it("lists the contract gaps the adapters report, and a collection it cannot read", async () => {
    const board = createStatusBoardFixtureAdapter({ records: [{ path: "workers/odd", id: "odd", updatedAt: null, doc: { status: 7 } }] });
    const failing: StatusBoardAdapter = {
      ...board,
      listProposals: async () => {
        throw new Error("status board answered 500");
      },
    };
    renderIntegration(failing);
    await screen.findByRole("region", { name: "Integration" });

    await waitFor(() => expect(screen.getAllByTestId("integration-gap").length).toBeGreaterThan(0));
    const gap = screen.getAllByTestId("integration-gap")[0]!;
    expect(gap.textContent).toContain("workers/odd");
    expect(gap.textContent).toContain("status");
    expect(field("integration-gap-failed-proposals")).toContain("could not be read");
    expect(field("integration-gap-failed-proposals")).toContain("status board answered 500");
    // An unreadable collection is a gap: the page must not report a clean scan.
    expect(screen.queryByTestId("integration-gap-none")).toBeNull();
    await waitFor(() => expect(field("integration-gap-count")).toMatch(/^[1-9]\d* gaps?$/));
  });

  it("states an unbound repository and reads no health at all", async () => {
    const board = createStatusBoardFixtureAdapter();
    let healthRead = 0;
    const unbound: StatusBoardAdapter = {
      ...board,
      health: async (repository) => {
        healthRead += 1;
        return board.health(repository);
      },
    };
    const history = createMemoryHistory({ initialEntries: ["/rep/mercury/other/project/settings"] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter({ adapters: { ...fixtureAdapters, statusBoard: unbound }, history, queryClient });
    render(<RouterProvider router={router} />);

    await screen.findByRole("region", { name: "Integration" });
    await waitFor(() => expect(field("integration-binding-state")).toContain("not integrated"));
    expect(screen.queryByTestId("integration-health")).toBeNull();
    expect(screen.queryByTestId("integration-gaps")).toBeNull();
    expect(healthRead).toBe(0);
  });
});
