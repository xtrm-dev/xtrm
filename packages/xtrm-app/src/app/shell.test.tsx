import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "./router.tsx";

function renderAt(url: string) {
  const history = createMemoryHistory({ initialEntries: [url] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const substrate = createFixtureSubstrate();
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate }, history, queryClient });
  render(<RouterProvider router={router} />);
  return { router, history, substrate };
}

const drawer = () => screen.queryByTestId("inspector-drawer");
const search = (router: ReturnType<typeof renderAt>["router"]) => router.state.location.search as Record<string, unknown>;

describe("Console v2 shell", () => {
  it("redirects / to the default repository Issues surface with top bar, sidebar, and inspector rail", async () => {
    const { router } = renderAt("/");
    expect(await screen.findByRole("region", { name: "XTRM Issues" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/rep/xtrm-dev/xtrm/work/issues");
    expect(screen.getByTestId("top-bar")).toBeTruthy();
    expect(screen.queryByTestId("global-rail")).toBeNull();
    expect(screen.getByTestId("context-sidebar")).toBeTruthy();
    expect(screen.getByTestId("inspector-rail")).toBeTruthy();
    // Hierarchical locator is the primary key; the flat ref follows dimmed.
    expect(await screen.findByText("XTRM-300.1")).toBeTruthy();
    expect(screen.getAllByText("/ XTRM-301").length).toBeGreaterThan(0);
  });

  it("groups destinations as Workspace, GitHub and System, with Project's repository sub-routes nested", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/work/issues");
    const sidebar = await screen.findByTestId("context-sidebar");
    for (const header of ["Workspace", "GitHub", "System"]) {
      expect(within(sidebar).getByRole("button", { name: new RegExp(`^${header}$`) })).toBeTruthy();
    }
    for (const label of ["Activity", "Issues", "Project", "Agents", "Observability", "Research", "Pull requests", "GitHub Issues", "Releases", "Repository content", "CI/CD", "Specialists", "Skills"]) {
      expect(within(sidebar).getAllByText(label).length).toBeGreaterThan(0);
    }
    // Graph and Repository observability left navigation; Project's own rows are visible immediately.
    expect(within(sidebar).queryByText("Repository observability")).toBeNull();
    for (const label of ["Overview", "Timeline", "Questions", "Workers", "Follow-ups", "Jira", "Integration"]) {
      expect(within(sidebar).getAllByText(label).length).toBeGreaterThan(0);
    }
    // No user-visible string says "Program" (ADR-002 D1).
    expect(within(sidebar).queryByText(/Program/)).toBeNull();

    // The disclosure chevron collapses the nested rows without navigating.
    fireEvent.click(within(sidebar).getByRole("button", { name: "Collapse Project" }));
    await waitFor(() => expect(within(sidebar).queryByText("Overview")).toBeNull());

    // The Project row resolves to the selected repository, never the retired global route.
    fireEvent.click(within(sidebar).getByRole("button", { name: /^Project/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/rep/xtrm-dev/xtrm/project"));
    expect((await screen.findByRole("region", { name: "Overview" })).textContent).toContain("Overview is not part of this vertical");
  });

  it("renders deferred modes as explicit placeholders, not broken routes", async () => {
    renderAt("/agents");
    expect(await screen.findByText("Agents is not part of this vertical")).toBeTruthy();
  });

  it("inspecting expands the rail into a CONTEXTUAL drawer whose left edge is the rail, never over the sidebar", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/work/issues");
    fireEvent.click(await screen.findByText("XTRM-300.1"));
    const el = await screen.findByTestId("inspector-drawer");
    // Default open state floats over the main column; only PINNED is an in-flow column.
    expect(el.dataset.variant).toBe("overlay");
    const dock = screen.getByTestId("inspector-dock");
    expect(dock.dataset.state).toBe("contextual");
    expect(dock.contains(el)).toBe(true);
    expect(dock.contains(screen.getByTestId("inspector-rail"))).toBe(true);
    expect(screen.getByTestId("inspector-rail").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("context-sidebar").contains(el)).toBe(false);
    await waitFor(() => expect(search(router).inspect).toBe("issue:XTRM-301"));
    expect(await within(el).findByText("Problem")).toBeTruthy();
    expect(within(el).getByText("Readiness")).toBeTruthy();
  });

  it("opening pushes the sidebar; maximize keeps the push and close restores it", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-301");
    const el = await screen.findByTestId("inspector-drawer");
    // Deep-link open already pushed the sidebar to its rail in the same motion.
    expect(screen.getByTestId("sidebar-reopen-rail")).toBeTruthy();

    fireEvent.click(within(el).getByRole("button", { name: "Maximize drawer" }));
    await waitFor(() => expect(drawer()?.dataset.variant).toBe("maximized"));
    expect(screen.getByTestId("sidebar-reopen-rail")).toBeTruthy();

    fireEvent.click(within(drawer()!).getByRole("button", { name: "Restore drawer" }));
    await waitFor(() => expect(drawer()?.dataset.variant).toBe("overlay"));
    // Restore keeps the push (inspector still open); only close brings the sidebar back.
    expect(screen.getByTestId("sidebar-reopen-rail")).toBeTruthy();

    fireEvent.click(screen.getByTestId("inspector-rail"));
    await waitFor(() => expect(drawer()).toBeNull());
    await waitFor(() => expect(screen.getByTestId("sidebar-collapse-edge")).toBeTruthy());
  });

  it("restores a pinned drawer from a deep link and keeps it across navigation", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-302&drawer=pinned");
    const el = await screen.findByTestId("inspector-drawer");
    expect(el.dataset.variant).toBe("column");
    expect(screen.getByTestId("inspector-dock").dataset.state).toBe("pinned");
    // Push collapsed the sidebar; reopen it to navigate (user owns it now).
    fireEvent.click(screen.getByTestId("sidebar-reopen-rail"));
    fireEvent.click(within(await screen.findByTestId("context-sidebar")).getByText("Activity"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/rep/xtrm-dev/xtrm/code/activity"));
    expect(drawer()?.dataset.variant).toBe("column");
    await waitFor(() => expect(search(router)).toMatchObject({ inspect: "issue:XTRM-302", drawer: "pinned" }));
  });

  it("navigates Project sub-routes from the sidebar and keeps the selected repository", async () => {
    const { router } = renderAt("/rep/mercury/market-data/project");
    const sidebar = await screen.findByTestId("context-sidebar");
    fireEvent.click(within(sidebar).getByRole("button", { name: "Timeline" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/rep/mercury/market-data/project/timeline"));
    expect((await screen.findByRole("region", { name: "Timeline" })).textContent).toContain("Project Timeline arrives with XTRM-818");
    // The Overview row is the section root only, so it is not selected on a child route.
    expect(within(sidebar).getByRole("button", { name: "Timeline" }).getAttribute("aria-current")).toBe("true");
    expect(within(sidebar).getByRole("button", { name: "Overview" }).getAttribute("aria-current")).toBeNull();
  });

  it("Ctrl+B toggles the contextual sidebar and Escape closes the drawer", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/activity?inspect=issue:XTRM-300");
    await screen.findByTestId("inspector-drawer");
    // Deep-link push starts collapsed; Ctrl+B reopens (user owns it now).
    expect(screen.getByTestId("sidebar-reopen-rail")).toBeTruthy();
    act(() => void fireEvent.keyDown(window, { key: "b", ctrlKey: true }));
    expect(await screen.findByTestId("sidebar-collapse-edge")).toBeTruthy();
    // The same light edge collapses the open sidebar.
    fireEvent.click(screen.getByTestId("sidebar-collapse-edge"));
    expect(await screen.findByTestId("sidebar-reopen-rail")).toBeTruthy();
    act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    await waitFor(() => expect(drawer()).toBeNull());
  });

  it("clicking the expanded rail edge folds the drawer back into the rail", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-301");
    await screen.findByTestId("inspector-drawer");
    fireEvent.click(screen.getByTestId("inspector-rail"));
    await waitFor(() => expect(drawer()).toBeNull());
    expect(screen.getByTestId("inspector-dock").dataset.state).toBe("closed");
    expect(screen.getByTestId("inspector-rail").getAttribute("aria-expanded")).toBe("false");
  });

  it("opens global search from the top bar and inspects a result", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/activity");
    fireEvent.click(within(await screen.findByTestId("top-bar")).getByRole("button", { name: "Search" }));
    const input = await screen.findByPlaceholderText("Search xtrm");
    fireEvent.change(input, { target: { value: "XTRM-305" } });
    fireEvent.click(await screen.findByText(/Root-export readiness types/));
    await waitFor(() => expect(drawer()).toBeTruthy());
  });
});

describe("Jira-style issue editing", () => {
  const page = (ref: string) => `/rep/xtrm-dev/xtrm/work/issues/${ref}`;

  it("edits the title in place and persists through the adapter", async () => {
    const { substrate } = renderAt(page("XTRM-301"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit title" }));
    const box = await screen.findByRole("textbox", { name: "Issue title" });
    fireEvent.change(box, { target: { value: "Rail keyboard model v2" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByRole("heading", { name: "Rail keyboard model v2" })).toBeTruthy();
    expect((await substrate.getIssue("XTRM-301")).title).toBe("Rail keyboard model v2");
  });

  it("changes status and priority from the details panel", async () => {
    const { substrate } = renderAt(page("XTRM-301"));
    const details = await screen.findByRole("complementary", { name: "Details" });
    fireEvent.click(within(details).getByRole("button", { name: /^Priority:/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /P0 · Highest/ }));
    await waitFor(async () => expect((await substrate.getIssue("XTRM-301")).priority).toBe(0));
    fireEvent.click(within(details).getByRole("button", { name: /^Status:/ }));
    fireEvent.click(await screen.findByRole("menuitemradio", { name: /Deferred/ }));
    await waitFor(async () => expect((await substrate.getIssue("XTRM-301")).lifecycle).toBe("deferred"));
  });

  it("edits a contract list field as structured items and keeps other fields untouched", async () => {
    const { substrate } = renderAt(page("XTRM-301"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit Constraints" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add item" }));
    const items = screen.getAllByRole("textbox", { name: /^Constraints item/ });
    fireEvent.change(items[items.length - 1]!, { target: { value: "Reads only through the typed service" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await substrate.getIssue("XTRM-301")).contract.constraints).toContain("Reads only through the typed service"));
    const after = await substrate.getIssue("XTRM-301");
    expect(after.contract.scope).toEqual(["packages/xtrm-app shell and adapters"]);
    expect(after.revision).toBe(3);
  });

  it("normalizes an imported contract into typed fields after review", async () => {
    const { substrate } = renderAt(page("XTRM-302"));
    expect(await screen.findByText(/imported with its sections inside Problem/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review mapping" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await substrate.getIssue("XTRM-302")).contract.scope).toEqual(["reserved 44px rail", "restore last width"]));
    const c = (await substrate.getIssue("XTRM-302")).contract;
    expect(c.nonGoals).toEqual(["global rail changes"]);
    expect(c.validation.map((v) => v.text)).toEqual(["collapse/restore round-trips", "Mod+B toggles"]);
    expect(c.problem).not.toContain("## SCOPE");
    await waitFor(() => expect(screen.queryByText(/imported with its sections inside Problem/)).toBeNull());
  });

  it("adds a journal entry through the markdown source editor", async () => {
    const { substrate } = renderAt(page("XTRM-303"));
    fireEvent.click(await screen.findByRole("button", { name: "Add a journal entry…" }));
    fireEvent.click(await screen.findByRole("radio", { name: "finding" }));
    fireEvent.click(screen.getByRole("tab", { name: "Markdown" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Markdown source" }), { target: { value: "Found **the** root cause" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await substrate.getIssue("XTRM-303")).journal[0]).toMatchObject({ kind: "finding", summary: "Found **the** root cause" }));
  });

  it("renders issue keys in contract prose as reference chips that navigate, leaving look-alikes as text", async () => {
    const { router } = renderAt(page("XTRM-301"));
    // XTRM-305 is a child of XTRM-300, so the chip leads with its locator.
    const chip = await screen.findByRole("button", { name: /^XTRM-300\.5 / });
    expect(chip.getAttribute("data-reference")).toBe("@issue:XTRM-305");
    expect(screen.getByText(/UTF-8 is not a reference/)).toBeTruthy();
    fireEvent.click(chip);
    await waitFor(() => expect(router.state.location.pathname).toBe(page("XTRM-305")));
  });

  it("opens the full issue page from the drawer", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-304");
    const el = await screen.findByTestId("inspector-drawer");
    fireEvent.click(within(el).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(page("XTRM-304")));
    expect(await screen.findByRole("complementary", { name: "Details" })).toBeTruthy();
  });
});

describe("Issues board", () => {
  const openBoard = async () => {
    fireEvent.click(await screen.findByRole("radio", { name: "Board" }));
    return screen.findByTestId("issue-board");
  };

  it("moves a card to Deferred from its menu and writes the lifecycle through the adapter", async () => {
    const { substrate } = renderAt("/rep/xtrm-dev/xtrm/work/issues");
    await openBoard();
    const todo = await screen.findByTestId("board-column-todo");
    const card = within(todo).getAllByTestId("board-card")[0]!;
    const ref = card.getAttribute("aria-label")!.split(" ")[0]!;
    fireEvent.click(within(card).getByRole("button", { name: `Move ${ref}` }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Deferred" }));
    await waitFor(async () => expect((await substrate.getIssue(ref)).lifecycle).toBe("deferred"));
    await waitFor(() => expect(within(screen.getByTestId("board-column-deferred")).getByRole("button", { name: new RegExp(`^${ref} `) })).toBeTruthy());
  });

  it("drops a dragged card on Done but refuses derived columns", async () => {
    const { substrate } = renderAt("/rep/xtrm-dev/xtrm/work/issues");
    await openBoard();
    const card = within(await screen.findByTestId("board-column-todo")).getAllByTestId("board-card")[0]!;
    const ref = card.getAttribute("aria-label")!.split(" ")[0]!;
    const dataTransfer = { setData() {}, effectAllowed: "" };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(screen.getByTestId("board-column-ready"), { dataTransfer });
    expect((await substrate.getIssue(ref)).lifecycle).toBe("open");
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(screen.getByTestId("board-column-done"), { dataTransfer });
    await waitFor(async () => expect((await substrate.getIssue(ref)).lifecycle).toBe("done"));
  });

  it("clicking a card inspects it in the drawer", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/work/issues");
    await openBoard();
    const card = within(await screen.findByTestId("board-column-todo")).getAllByTestId("board-card")[0]!;
    const ref = card.getAttribute("aria-label")!.split(" ")[0]!;
    fireEvent.click(card);
    await waitFor(() => expect(search(router).inspect).toBe(`issue:${ref}`));
  });
});
