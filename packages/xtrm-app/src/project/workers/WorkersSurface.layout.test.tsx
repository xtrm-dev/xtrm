import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters, type Adapters } from "../../adapters/index.tsx";
import { FIXTURE_BOARD_REPO, createStatusBoardFixtureAdapter } from "../../adapters/status-board/fixture.ts";
import { fixtureSubstrate } from "../../adapters/substrate/fixture.ts";
import { createAppRouter } from "../../app/router.tsx";
import { LAYOUT_SESSION_UUID, WORKERS_LAYOUT_GRAPH } from "./layout-fixture.ts";

/**
 * The live shapes that broke the Worker row (XTRM-912): a node that delivered five PRs, and
 * sessions the graph names only by a machine id. Layout itself is measured in the browser by
 * `e2e/project-workers.spec.ts` against the same fixture; this suite pins the content rules.
 */
function renderLayout() {
  const adapters: Adapters = {
    ...fixtureAdapters,
    substrate: { ...fixtureSubstrate, dispatchGraph: async () => structuredClone(WORKERS_LAYOUT_GRAPH) },
    statusBoard: createStatusBoardFixtureAdapter(),
  };
  const history = createMemoryHistory({ initialEntries: [`/rep/${FIXTURE_BOARD_REPO}/project/workers`] });
  const router = createAppRouter({ adapters, history, queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) });
  render(<RouterProvider router={router} />);
}

const rowFor = async (text: string) => {
  const rows = await screen.findAllByTestId("worker-row", undefined, { timeout: 4000 });
  const row = rows.find((r) => (r.textContent ?? "").includes(text));
  if (!row) throw new Error(`no worker row contains ${text}`);
  return row;
};

describe("Workers tree on the live shape", () => {
  it("collapses a five-PR trail into the first key and +N, with every PR in the popover", async () => {
    renderLayout();
    const row = await rowFor("layout-worker");
    const trail = within(row).getByTestId("worker-pr-trail");
    expect(trail.textContent).toContain("#637");
    expect(trail.textContent).not.toContain("#1604");
    const more = within(trail).getByLabelText("4 more pull requests");
    expect(more.textContent).toBe("+4");

    fireEvent.click(more);
    expect(await screen.findByText("#1604")).toBeTruthy();
    expect(screen.getByText("#1542")).toBeTruthy();
    // The popover names the repository of every PR, which the row itself never repeats.
    expect(screen.getAllByText("mercuryintelligence/market-data").length).toBeGreaterThan(0);
  });

  it("names a session with no human name by its issue key and title, and keeps the UUID in the tooltip", async () => {
    renderLayout();
    const row = await rowFor("Contextual sidebar reopen rail (B1)");
    expect(row.getAttribute("data-kind")).toBe("session");
    // The name cell carries the issue key the console uses (the hierarchical locator) and the title.
    const name = within(row).getByTestId("worker-name");
    expect(name.textContent).toContain("XTRM-300.1.2");
    expect(row.textContent).not.toContain(LAYOUT_SESSION_UUID);
    expect(name.getAttribute("title")).toBe(LAYOUT_SESSION_UUID);
  });

  it("keeps the unknown-dispatcher group collapsed with its count, and renders its rows when opened", async () => {
    renderLayout();
    const unknown = await screen.findByTestId("workers-unknown");
    const toggle = within(unknown).getByTestId("workers-unknown-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toMatch(/unknown dispatcher \(\d+\)/);
    expect(unknown.textContent).not.toContain("Inspector Drawer state machine and URL restore");
    expect(within(unknown).queryAllByTestId("worker-row")).toHaveLength(0);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // The nameless unknown sessions get the same treatment: issue key plus title, never a bare UUID.
    await waitFor(() => expect(unknown.textContent).toContain("Inspector Drawer state machine and URL restore"));
    expect(unknown.textContent).not.toContain("01a1db81-4a5c-7df1-9c0e-1a9f6b2f9e31");
  });

  it("states the omitted binding count in plain words", async () => {
    renderLayout();
    const header = await screen.findByTestId("graph-count");
    expect(header.textContent).toContain("the graph read is capped, so 1289 bindings are not shown");
  });
});
