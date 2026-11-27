import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";
import { DEVICE_SETTINGS_KEY } from "../lib/settings/index.ts";

// XTRM-1100: the sidebar drop-up as the System & settings menu.

async function mount(url = "/rep/xtrm-dev/xtrm/work/issues") {
  const history = createMemoryHistory({ initialEntries: [url] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate: createFixtureSubstrate() }, history, queryClient });
  render(<RouterProvider router={router} />);
  await screen.findByTestId("context-sidebar");
  return router;
}

const trigger = () => screen.getByRole("button", { name: "Data sources" });
const menu = () => screen.queryByRole("dialog", { name: "Data sources" });
const storedTheme = () => JSON.parse(localStorage.getItem(DEVICE_SETTINGS_KEY.console) ?? "{}")["appearance.theme"];

async function openMenu() {
  fireEvent.click(trigger());
  return await screen.findByRole("dialog", { name: "Data sources" });
}

describe("System & settings menu", () => {
  it("keeps the status block first, then Appearance, then the Go to rows", async () => {
    await mount();
    const panel = await openMenu();
    const status = within(panel).getByTestId("board-transport");
    const appearance = within(panel).getByRole("region", { name: "Appearance" });
    const goTo = within(panel).getByRole("navigation", { name: "Go to" });
    expect(within(panel).getAllByTestId("source-state")).toHaveLength(4);
    expect(status.compareDocumentPosition(appearance) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(appearance.compareDocumentPosition(goTo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const rows = within(goTo).getAllByRole("button").map((b) => b.textContent);
    expect(rows[0]).toMatch(/^Appearance/);
    expect(rows[1]).toMatch(/^Connections/);
    expect(rows[2]).toBe("Project integrationxtrm-dev/xtrm");
    expect(rows[3]).toMatch(/^All settings/);
    expect(rows[4]).toBe("Change host target…");
  });

  it("opens on Mod+, and opens a collapsed sidebar first", async () => {
    await mount();
    expect(menu()).toBeNull();
    fireEvent.keyDown(window, { key: ",", ctrlKey: true });
    expect(await screen.findByRole("dialog", { name: "Data sources" })).toBeTruthy();
    fireEvent.keyDown(menu()!, { key: "Escape" });
    await waitFor(() => expect(menu()).toBeNull());

    const sidebarState = () => screen.getByTestId("context-sidebar").closest("[data-state]")?.getAttribute("data-state");
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    await waitFor(() => expect(sidebarState()).toBe("collapsed"));
    fireEvent.keyDown(window, { key: ",", metaKey: true });
    await waitFor(() => expect(sidebarState()).toBe("expanded"));
    expect(await screen.findByRole("dialog", { name: "Data sources" })).toBeTruthy();
  });

  it("offers the theme as a three-way radio group that applies in place", async () => {
    await mount();
    const panel = await openMenu();
    const group = within(panel).getByRole("radiogroup", { name: "Theme" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["System", "Light", "Dark"]);
    expect(within(group).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true");
    // jsdom's matchMedia reports no light preference, so System resolves to dark.
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(within(panel).getByTestId("goto-appearance").textContent).toBe("AppearanceSystem · Dark");

    fireEvent.click(within(group).getByRole("radio", { name: "Light" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(within(group).getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("true");
    expect(storedTheme()).toBe("light");
    // In place: the menu stays open.
    expect(menu()).not.toBeNull();

    // Left/Right move the choice, as native radios do, and keep focus on the chosen radio.
    within(group).getByRole("radio", { name: "Light" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement?.textContent).toBe("Dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(storedTheme()).toBe("dark");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement?.textContent).toBe("System");
    expect(storedTheme()).toBe("system");
  });

  it("reads the legacy theme key until the settings document holds a choice", async () => {
    localStorage.setItem("xtrm.console.theme.v1", "light");
    await mount();
    const panel = await openMenu();
    expect(within(panel).getByRole("radio", { name: "Light" }).getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("reaches the Appearance block and the Go to rows with the arrow keys", async () => {
    await mount();
    const panel = await openMenu();
    const popup = document.querySelector<HTMLElement>("[data-expand-popover]")!;
    // Opening does not land on a control: the first ArrowDown reaches the first status row.
    expect(document.activeElement?.closest("[role=radiogroup],nav")).toBeNull();
    fireEvent.keyDown(popup, { key: "ArrowDown" });
    expect(document.activeElement?.hasAttribute("data-popover-row")).toBe(true);
    for (let i = 0; i < 30 && document.activeElement?.getAttribute("data-testid") !== "change-host"; i++) fireEvent.keyDown(popup, { key: "ArrowDown" });
    expect(document.activeElement).toBe(within(panel).getByTestId("change-host"));
  });

  it("navigates from the Go to rows and closes the menu", async () => {
    const router = await mount();
    fireEvent.click(within(await openMenu()).getByTestId("goto-settings"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings"));
    await waitFor(() => expect(menu()).toBeNull());

    fireEvent.click(within(await openMenu()).getByTestId("goto-project"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/rep/xtrm-dev/xtrm/project/settings"));

    fireEvent.click(within(await openMenu()).getByTestId("goto-appearance"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings"));
  });

  it("opens the host connection panel from Change host target…, then drops the request from the URL", async () => {
    const router = await mount();
    fireEvent.click(within(await openMenu()).getByTestId("change-host"));
    await waitFor(() => expect(router.state.location.pathname).toBe("/agent"));
    expect(await screen.findByTestId("host-connection")).toBeTruthy();
    await waitFor(() => expect((router.state.location.search as Record<string, unknown>).host).toBeUndefined());
  });
});
