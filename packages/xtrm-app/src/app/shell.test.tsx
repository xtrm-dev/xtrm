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
  it("redirects / to the default repository Issues surface with top bar, mode rail, sidebar, and inspector rail", async () => {
    const { router } = renderAt("/");
    expect(await screen.findByRole("region", { name: "XTRM Issues" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/rep/xtrm-dev/xtrm/work/issues");
    expect(screen.getByTestId("top-bar")).toBeTruthy();
    expect(screen.getByTestId("global-rail")).toBeTruthy();
    expect(screen.getByTestId("context-sidebar")).toBeTruthy();
    expect(screen.getByTestId("inspector-rail")).toBeTruthy();
    expect(await screen.findByText("XTRM-301")).toBeTruthy();
  });

  it("rail selects modes; the sidebar only shows the active mode's context", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/work/issues");
    const sidebar = await screen.findByTestId("context-sidebar");
    expect(within(sidebar).getByText("Issues")).toBeTruthy();
    expect(within(sidebar).getByText("GitHub Issues")).toBeTruthy();
    // Modes live only in the rail: no Program/Agents navigation rows in the Work sidebar.
    expect(within(sidebar).queryByRole("button", { name: /^Program/ })).toBeNull();
    expect(within(sidebar).queryByRole("button", { name: /^Agents/ })).toBeNull();

    fireEvent.click(within(screen.getByTestId("global-rail")).getByRole("button", { name: "Program" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/program"));
    expect(await within(screen.getByTestId("context-sidebar")).findByText("Workstreams")).toBeTruthy();
  });

  it("renders deferred modes as explicit placeholders, not broken routes", async () => {
    renderAt("/agents");
    expect(await screen.findByText("Agents is not part of this vertical")).toBeTruthy();
  });

  it("inspecting opens a CONTEXTUAL drawer contained in the primary region, never over the rails", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/work/issues");
    fireEvent.click(await screen.findByText("XTRM-301"));
    const el = await screen.findByTestId("inspector-drawer");
    expect(el.dataset.variant).toBe("overlay");
    expect(screen.getByTestId("primary-region").contains(el)).toBe(true);
    expect(screen.getByTestId("global-rail").contains(el)).toBe(false);
    expect(screen.getByTestId("context-sidebar").contains(el)).toBe(false);
    await waitFor(() => expect(search(router).inspect).toBe("issue:XTRM-301"));
    expect(await within(el).findByText("Problem")).toBeTruthy();
    expect(within(el).getByText("Readiness")).toBeTruthy();
  });

  it("maximize collapses the sidebar to the reopen rail; restore brings it back", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-301");
    const el = await screen.findByTestId("inspector-drawer");
    fireEvent.click(within(el).getByRole("button", { name: "Maximize drawer" }));
    await waitFor(() => expect(drawer()?.dataset.variant).toBe("maximized"));
    expect(screen.getByTestId("sidebar-reopen-rail")).toBeTruthy();
    expect(screen.queryByTestId("context-sidebar")).toBeNull();
    expect(screen.getByTestId("primary-region").contains(drawer())).toBe(true);

    fireEvent.click(within(drawer()!).getByRole("button", { name: "Restore drawer" }));
    await waitFor(() => expect(screen.getByTestId("context-sidebar")).toBeTruthy());
    expect(drawer()?.dataset.variant).toBe("overlay");
  });

  it("restores a pinned drawer from a deep link and keeps it across navigation", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-302&drawer=pinned");
    const el = await screen.findByTestId("inspector-drawer");
    expect(el.dataset.variant).toBe("column");
    expect(screen.queryByTestId("inspector-rail")).toBeNull();
    fireEvent.click(within(screen.getByTestId("context-sidebar")).getByText("Activity"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/rep/xtrm-dev/xtrm/code/activity"));
    expect(drawer()?.dataset.variant).toBe("column");
    await waitFor(() => expect(search(router)).toMatchObject({ inspect: "issue:XTRM-302", drawer: "pinned" }));
  });

  it("traverses Program → issue in the drawer stack and back", async () => {
    renderAt("/program");
    fireEvent.click(await screen.findByText("XTRM Console v2"));
    const el = await screen.findByTestId("inspector-drawer");
    fireEvent.click(await within(el).findByText("@issue:XTRM-300"));
    expect(await within(drawer()!).findByText("Readiness")).toBeTruthy();
    fireEvent.click(within(drawer()!).getByRole("button", { name: "Back" }));
    expect(await within(drawer()!).findByText("Executable work")).toBeTruthy();
    // Program shows references, never the referenced issue's lifecycle state.
    expect(within(drawer()!).queryByText("Readiness")).toBeNull();
  });

  it("Ctrl+B toggles the contextual sidebar and Escape closes the drawer", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/activity?inspect=issue:XTRM-300");
    await screen.findByTestId("inspector-drawer");
    act(() => void fireEvent.keyDown(window, { key: "b", ctrlKey: true }));
    expect(await screen.findByTestId("sidebar-reopen-rail")).toBeTruthy();
    act(() => void fireEvent.keyDown(window, { key: "b", ctrlKey: true }));
    expect(await screen.findByTestId("context-sidebar")).toBeTruthy();
    act(() => void fireEvent.keyDown(window, { key: "Escape" }));
    await waitFor(() => expect(drawer()).toBeNull());
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

  it("opens the full issue page from the drawer", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-304");
    const el = await screen.findByTestId("inspector-drawer");
    fireEvent.click(within(el).getByRole("button", { name: "Open" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(page("XTRM-304")));
    expect(await screen.findByRole("complementary", { name: "Details" })).toBeTruthy();
  });
});
