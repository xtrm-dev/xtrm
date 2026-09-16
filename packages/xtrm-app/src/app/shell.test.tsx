import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createAppRouter } from "./router.tsx";

function renderAt(url: string) {
  const history = createMemoryHistory({ initialEntries: [url] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: fixtureAdapters, history, queryClient });
  render(<RouterProvider router={router} />);
  return { router, history };
}

const drawer = () => screen.queryByTestId("inspector-drawer");
const search = (router: ReturnType<typeof renderAt>["router"]) => router.state.location.search as Record<string, unknown>;

describe("Console v2 shell", () => {
  it("redirects / to the default repository Issues surface with rail, sidebar, and inspector rail", async () => {
    const { router } = renderAt("/");
    expect(await screen.findByRole("region", { name: "XTRM Issues" })).toBeTruthy();
    expect(router.state.location.pathname).toBe("/rep/xtrm-dev/xtrm/work/issues");
    expect(screen.getByTestId("global-rail")).toBeTruthy();
    expect(screen.getByTestId("context-sidebar")).toBeTruthy();
    expect(screen.getByTestId("inspector-rail")).toBeTruthy();
    expect(await screen.findByText("XTRM-300")).toBeTruthy();
  });

  it("renders deferred destinations as explicit placeholders, not broken routes", async () => {
    renderAt("/agents");
    expect(await screen.findByText("Agents is not part of this vertical")).toBeTruthy();
  });

  it("keeps XTRM Issues and GitHub Issues distinct", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/issues");
    expect(await screen.findByText("GitHub Issues is not part of this vertical")).toBeTruthy();
    const nav = screen.getByTestId("context-sidebar");
    expect(within(nav).getByText("XTRM Issues")).toBeTruthy();
    expect(within(nav).getByText("GitHub Issues")).toBeTruthy();
  });

  it("inspecting opens a CONTEXTUAL drawer contained in the primary region, never over the rails", async () => {
    const { router } = renderAt("/rep/xtrm-dev/xtrm/work/issues");
    fireEvent.click(await screen.findByText("XTRM-300"));
    const el = await screen.findByTestId("inspector-drawer");
    expect(el.dataset.variant).toBe("overlay");
    expect(screen.getByTestId("primary-region").contains(el)).toBe(true);
    expect(screen.getByTestId("global-rail").contains(el)).toBe(false);
    expect(screen.getByTestId("context-sidebar").contains(el)).toBe(false);
    await waitFor(() => expect(search(router).inspect).toBe("issue:XTRM-300"));
    expect(await within(el).findByText("Contract")).toBeTruthy();
  });

  it("maximize collapses the sidebar to the reopen rail; restore brings it back", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues?inspect=issue:XTRM-301");
    const el = await screen.findByTestId("inspector-drawer");
    fireEvent.click(within(el).getByRole("button", { name: "Maximize drawer" }));
    await waitFor(() => expect(drawer()?.dataset.variant).toBe("maximized"));
    expect(screen.getByTestId("sidebar-reopen-rail")).toBeTruthy();
    expect(screen.queryByTestId("context-sidebar")).toBeNull();
    expect(screen.getByTestId("primary-region").contains(drawer())).toBe(true);
    expect(screen.getByTestId("global-rail")).toBeTruthy();

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
    expect(within(drawer()!).queryByText(/dispatchable/)).toBeNull();
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

  it("opens global search from the sidebar field and inspects a result", async () => {
    renderAt("/rep/xtrm-dev/xtrm/code/activity");
    fireEvent.click(await screen.findByText(/Search xtrm and workspace/));
    const input = await screen.findByPlaceholderText("Search xtrm");
    fireEvent.change(input, { target: { value: "XTRM-305" } });
    fireEvent.click(await screen.findByText(/Root-export readiness types/));
    await waitFor(() => expect(drawer()).toBeTruthy());
  });
});
