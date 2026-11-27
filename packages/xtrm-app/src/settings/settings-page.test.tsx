import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";
import { DEFAULT_APP_SETTINGS, DEVICE_SETTINGS_KEY, SECTION_ORDER, SETTING_KEYS, SETTING_LABELS, SETTINGS_SECTIONS, sectionOf, settingAnchor } from "../lib/settings/index.ts";
import { WHERE_TO_CHANGE } from "./model.ts";

// XTRM-1103: the /settings route tree.

async function mount(url: string, overrides: Partial<typeof fixtureAdapters> = {}) {
  const history = createMemoryHistory({ initialEntries: [url] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate: createFixtureSubstrate(), ...overrides }, history, queryClient });
  render(<RouterProvider router={router} />);
  await screen.findByRole("region", { name: "Settings" });
  return router;
}

const page = () => screen.getByRole("region", { name: "Settings" });
const rowOf = (key: (typeof SETTING_KEYS)[number]) => document.getElementById(settingAnchor(key));

describe("/settings routes", () => {
  it("opens the first section from /settings and from an unknown section", async () => {
    const router = await mount("/settings");
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/general"));
    const other = await mount("/settings/nonsense");
    await waitFor(() => expect(other.state.location.pathname).toBe("/settings/general"));
  });

  it("drives the navigation and the breadcrumb from the shared section labels", async () => {
    const router = await mount("/settings/layout");
    const nav = within(page()).getByRole("navigation", { name: "Settings sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(SECTION_ORDER.map((id) => SETTINGS_SECTIONS[id].label));
    expect(within(nav).getByRole("link", { name: "Layout" }).getAttribute("aria-current")).toBe("page");
    const crumbs = within(page()).getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.textContent).toContain("Settings");
    expect(within(crumbs).getByText("Layout").closest("[aria-current]")?.getAttribute("aria-current")).toBe("page");
    expect(within(page()).getByRole("heading", { level: 1 }).textContent).toBe("Layout");

    fireEvent.click(within(nav).getByRole("link", { name: "Advanced" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/settings/advanced"));
    expect(within(page()).getByRole("heading", { level: 1 }).textContent).toBe("Advanced");
  });

  it("gives every setting in the inventory a home: one anchored row in its own section", async () => {
    const homes = new Map<string, string>();
    for (const section of SECTION_ORDER) {
      await mount(`/settings/${section}`);
      for (const row of document.querySelectorAll<HTMLElement>("[data-setting]")) {
        const key = row.getAttribute("data-setting")!;
        expect(homes.has(key), `${key} has two homes`).toBe(false);
        homes.set(key, section);
        expect(row.id).toBe(settingAnchor(key as (typeof SETTING_KEYS)[number]));
        expect(within(row).getByText(SETTING_LABELS[key as (typeof SETTING_KEYS)[number]])).toBeTruthy();
      }
      document.body.innerHTML = "";
    }
    for (const key of SETTING_KEYS) expect(homes.get(key), key).toBe(sectionOf(key));
  });

  it("says where to change every setting this page cannot change yet", () => {
    const changeable = new Set(["appearance.theme", "layout.sidebarOpen", "layout.sidebarWidth", "layout.inspectorWidth"]);
    for (const key of SETTING_KEYS) if (!changeable.has(key)) expect(WHERE_TO_CHANGE[key], key).toBeTruthy();
  });

  it("shows a row reset and a section reset only when a value differs from the default", async () => {
    await mount("/settings/appearance");
    const theme = rowOf("appearance.theme")!;
    expect(within(theme).queryByRole("button", { name: "Reset Theme" })).toBeNull();
    expect(within(page()).queryByRole("button", { name: "Reset Appearance" })).toBeNull();

    fireEvent.click(within(theme).getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(within(theme).getByTestId("setting-source").textContent).toBe("This device");
    fireEvent.click(within(theme).getByRole("button", { name: "Reset Theme" }));
    expect(within(theme).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true");
    expect(within(theme).queryByRole("button", { name: "Reset Theme" })).toBeNull();
    expect(JSON.parse(localStorage.getItem(DEVICE_SETTINGS_KEY.console)!)["appearance.theme"]).toBe("system");

    fireEvent.click(within(theme).getByRole("radio", { name: "Light" }));
    fireEvent.click(within(page()).getByRole("button", { name: "Reset Appearance" }));
    expect(within(theme).getByRole("radio", { name: "System" }).getAttribute("aria-checked")).toBe("true");
  });

  it("resets layout values through the shell's own layout state", async () => {
    localStorage.setItem("xtrm.console.layout.v1", JSON.stringify({ sidebarOpen: true, sidebarWidth: 300, inspectorWidth: 700 }));
    await mount("/settings/layout");
    const width = rowOf("layout.sidebarWidth")!;
    expect(within(width).getByTestId("setting-value").textContent).toBe("300px");
    expect(within(width).getByTestId("setting-source").textContent).toBe("This device");
    fireEvent.click(within(width).getByRole("button", { name: "Reset Sidebar width" }));
    await waitFor(() => expect(within(width).getByTestId("setting-value").textContent).toBe("264px"));
    expect(within(width).queryByRole("button", { name: "Reset Sidebar width" })).toBeNull();
    // Rows the page cannot change say where to change them.
    expect(within(rowOf("layout.foldedGroups")!).getByText(/Threads sidebar/)).toBeTruthy();
  });

  it("offers the theme as a radio group with one tab stop and arrow keys that select", async () => {
    await mount("/settings/appearance");
    const group = within(rowOf("appearance.theme")!).getByRole("radiogroup", { name: "Theme" });
    const radios = within(group).getAllByRole("radio");
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    radios[0]!.focus();
    fireEvent.keyDown(radios[0]!, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Light");
    expect(document.activeElement?.getAttribute("aria-checked")).toBe("true");
    expect(within(group).getAllByRole("radio").map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("puts the GitHub account in Connections, with the host target action", async () => {
    const router = await mount("/settings/connections");
    expect(await within(page()).findByTestId("github-account")).toBeTruthy();
    expect(within(page()).getByRole("region", { name: "Account" })).toBeTruthy();
    fireEvent.click(within(page()).getByRole("button", { name: "Change host target…" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/agent"));
    expect(await screen.findByTestId("host-connection")).toBeTruthy();
  });

  it("reports project overrides as derived and links to the Integration facts", async () => {
    await mount("/settings/project");
    expect(within(rowOf("project.jiraSite")!).getByTestId("setting-value").textContent).toBe("Derived (no override)");
    expect(within(page()).getByRole("link", { name: "Integration page" }).getAttribute("href")).toBe("/rep/xtrm-dev/xtrm/project/settings");
  });

  it("scrolls the row a deep link points at into view, with the page's own alignment", async () => {
    // The router's own hash restoration also calls scrollIntoView, and it passes `true`
    // (router-core scroll-restoration.js). Recording the argument separates the two, so this
    // test observes SettingsPage's effect and not the router's.
    const calls: { id: string; options: unknown }[] = [];
    const spy = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (this: Element, options?: boolean | ScrollIntoViewOptions) {
      calls.push({ id: this.id, options });
    });
    try {
      await mount("/settings/connections#connections-sshTarget");
      const pageCall = () => calls.find((c) => c.id === "connections-sshTarget" && (c.options as ScrollIntoViewOptions | undefined)?.block === "start");
      await waitFor(() => expect(pageCall()).toBeTruthy());
      expect(pageCall()!.options).toEqual({ block: "start" });
      expect(rowOf("connections.sshTarget")!.id).toBe("connections-sshTarget");
    } finally {
      spy.mockRestore();
    }
  });

  it("marks host values unknown and says so when the agent host does not answer", async () => {
    const failing = { ...fixtureAdapters.agentHost, status: () => Promise.reject(new Error("bridge down")) };
    await mount("/settings/connections", { agentHost: failing });
    const alert = await within(page()).findByRole("alert", { name: "Agent host unavailable" });
    expect(alert.textContent).toContain("bridge down");
    const target = rowOf("connections.sshTarget")!;
    expect(within(target).getByTestId("setting-value").textContent).toBe("Unknown");
    expect(within(target).getByTestId("setting-source").textContent).toBe("Unknown: the host did not answer");
    // Device-scoped rows on the same page keep their own values.
    expect(within(rowOf("connections.peers")!).getByTestId("setting-value").textContent).toBe("None");
  });

  it("resets the theme and the sidebar to the model's defaults", async () => {
    // Seeded off the default and read back against DEFAULT_APP_SETTINGS, so the row reset is pinned
    // to the model's value rather than to a literal.
    const defaultOpen = DEFAULT_APP_SETTINGS["layout.sidebarOpen"];
    localStorage.setItem("xtrm.console.layout.v1", JSON.stringify({ sidebarOpen: !defaultOpen, sidebarWidth: 264 }));
    await mount("/settings/layout");
    const open = rowOf("layout.sidebarOpen")!;
    expect(within(open).getByTestId("setting-value").textContent).toBe(defaultOpen ? "Off" : "On");
    fireEvent.click(within(open).getByRole("button", { name: "Reset Sidebar open" }));
    await waitFor(() => expect(within(open).getByTestId("setting-value").textContent).toBe(defaultOpen ? "On" : "Off"));
    expect(within(open).queryByRole("button", { name: "Reset Sidebar open" })).toBeNull();

    fireEvent.click(within(page()).getByRole("link", { name: "Appearance" }));
    await waitFor(() => expect(rowOf("appearance.theme")).not.toBeNull());
    const theme = rowOf("appearance.theme")!;
    fireEvent.click(within(theme).getByRole("radio", { name: "Light" }));
    fireEvent.click(within(theme).getByRole("button", { name: "Reset Theme" }));
    expect(JSON.parse(localStorage.getItem(DEVICE_SETTINGS_KEY.console)!)["appearance.theme"]).toBe(DEFAULT_APP_SETTINGS["appearance.theme"]);
  });
});
