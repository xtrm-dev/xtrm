import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../../adapters/index.tsx";
import { FIXTURE_BOARD_REPO, createStatusBoardFixtureAdapter } from "../../adapters/status-board/fixture.ts";
import type { StatusBoardAdapter } from "../../adapters/status-board/types.ts";
import { fixtureSubstrate } from "../../adapters/substrate/fixture.ts";
import type { Adapters } from "../../adapters/index.tsx";
import { createAppRouter } from "../../app/router.tsx";
import { WORKERS_LAYOUT_GRAPH } from "./layout-fixture.ts";

/** The fixture board repo resolves the fixture substrate's second binding (market-data). */
const substrate = fixtureSubstrate;

function renderWorkers(search = "", adapters: Adapters = { ...fixtureAdapters, substrate }) {
  const history = createMemoryHistory({ initialEntries: [`/rep/${FIXTURE_BOARD_REPO}/project/workers${search}`] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters, history, queryClient });
  render(<RouterProvider router={router} />);
  return router;
}

describe("Project Workers", () => {
  it("draws the dispatch chain: the lead, the worker it launched, and that worker's activation", async () => {
    const board = createStatusBoardFixtureAdapter();
    renderWorkers("", { ...fixtureAdapters, substrate, statusBoard: board });

    const region = await screen.findByRole("region", { name: "Workers" });
    expect(region.textContent).toContain("mercury/market-data");
    expect(await screen.findByTestId("project-binding")).toBeTruthy();

    // The chain comes from the graph, not from `reportsTo` on the board.
    const rows = await screen.findAllByTestId("worker-row");
    const names = rows.map((r) => r.textContent ?? "");
    const lead = names.findIndex((t) => t.includes("console-lead"));
    const worker = names.findIndex((t) => t.includes("board-worker"));
    const activation = names.findIndex((t) => t.includes("test-engineer"));
    expect(lead).toBeGreaterThanOrEqual(0);
    expect(worker).toBeGreaterThan(lead);
    expect(activation).toBeGreaterThan(worker);
    expect(rows[lead]!.textContent).toContain("lead");
    expect(rows[worker]!.textContent).toContain("worker");
    expect(rows[activation]!.textContent).toContain("activation");

    // The worker row carries the board status joined on the issue ref, and its issue chip.
    expect(rows[worker]!.textContent).toContain("working");
    expect(rows[worker]!.textContent).toContain("XTRM-817");
    // The PR rides the trail of the issue it delivered. pr-reviewer sits in the group the
    // tree keeps collapsed on live data, so open it before reading that row.
    fireEvent.click(await screen.findByTestId("workers-unknown-toggle"));
    expect(await screen.findByTestId("workers-tree")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("workers-tree").textContent).toContain("#912"));
  });

  it("groups a worker with no dispatcher edge and a graph-less board worker under unknown dispatcher", async () => {
    const board = createStatusBoardFixtureAdapter();
    renderWorkers("", { ...fixtureAdapters, substrate, statusBoard: board });
    const unknown = await screen.findByRole("region", { name: "Unknown dispatcher" });
    // The group starts collapsed, with its count, so a live graph's hundreds of rows stay unmounted.
    expect(unknown.textContent).toContain("unknown dispatcher (2)");
    expect(unknown.textContent).not.toContain("pr-reviewer");
    fireEvent.click(screen.getByTestId("workers-unknown-toggle"));
    // pr-reviewer's binding predates the dispatcher write path; sre-ops has no binding at all.
    await waitFor(() => expect(unknown.textContent).toContain("pr-reviewer"));
    expect(unknown.textContent).toContain("sre-ops");
  });

  it("counts the same rows the board reports, and the archived control changes the list by the archived count", async () => {
    const board: StatusBoardAdapter = createStatusBoardFixtureAdapter();
    const archive = board.listWorkers;
    // Archive one real board row so the control has something to reveal.
    board.listWorkers = async (repository, opts) => {
      const page = await archive(repository, opts);
      const records = page.records.map((r, i) => (i === 0 ? { ...r, doc: { ...r.doc, status: "archived" } } : r));
      return { ...page, records };
    };
    renderWorkers("?view=list", { ...fixtureAdapters, substrate, statusBoard: board });

    await screen.findByTestId("workers-list");
    // The list labels its trailing values, so ctx and claim are not unlabelled numbers at the row's end.
    const columns = screen.getByTestId("workers-columns");
    expect(columns.getAttribute("aria-hidden")).toBe("true");
    for (const label of ["state", "issue", "PR", "ctx", "claim"]) expect(columns.textContent).toContain(label);
    const source = await board.listWorkers(FIXTURE_BOARD_REPO);
    await waitFor(() => expect(screen.getByTestId("workers-count").textContent).toBe(`${source.records.length} workers`));
    expect(screen.getAllByTestId("worker-flat-row")).toHaveLength(source.records.length - 1);

    const toggle = screen.getByRole("checkbox", { name: "Include archived workers" });
    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getAllByTestId("worker-flat-row")).toHaveLength(source.records.length));
  });

  // XTRM-918: the console's board read covered a small window of the issues the graph names, so a
  // session row on an issue outside that window had a key and no title. The title is read by ref.
  it("names a session row whose issue the board list does not carry", async () => {
    const outside = {
      ...substrate,
      dispatchGraph: async () => structuredClone(WORKERS_LAYOUT_GRAPH),
      listIssues: async (projectId: string) => (await substrate.listIssues(projectId)).filter((i) => !["XTRM-302", "XTRM-303"].includes(i.ref)),
    };
    renderWorkers("", { ...fixtureAdapters, substrate: outside, statusBoard: createStatusBoardFixtureAdapter() });

    const rows = await screen.findAllByTestId("worker-row");
    const session = rows.find((row) => row.getAttribute("data-kind") === "session");
    expect(session, "the graph's nameless session is a row").toBeTruthy();
    // Its issue key stays, and the title arrives from the per-ref read once that resolves.
    expect(session!.textContent).toContain("XTRM-302");
    await waitFor(() => expect(session!.textContent).toContain("Contextual sidebar reopen rail (B1)"));
  });

  it("keeps the tree when the graph cannot be read, and says so", async () => {
    const failing = {
      ...substrate,
      dispatchGraph: async () => {
        throw new Error("no answer in 219 ms");
      },
    };
    renderWorkers("", { ...fixtureAdapters, substrate: failing, statusBoard: createStatusBoardFixtureAdapter() });
    expect(await screen.findByTestId("graph-error")).toBeTruthy();
    // The board rows stay visible rather than the surface going blank.
    expect((await screen.findByTestId("workers-board-only")).textContent).toContain("board-worker");
  });
});
