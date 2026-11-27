import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";
import { settingAnchor } from "../lib/settings/index.ts";

// XTRM-1151: the sidebar's row reset must compare the open state with the model's default, not with
// the state's truthiness. This file runs with DEFAULT_APP_SETTINGS["layout.sidebarOpen"] flipped to
// false — the reviewer's failure scenario — and the shell open, so a mutant that reads
// `isDefault: Boolean(layout.sidebar.open)` hides the reset while the model still disagrees with the
// shell. Restore is open !== default in both directions, so the truthiness test only survives while
// the default is true.
vi.mock("../lib/settings/schema.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/settings/schema.ts")>();
  return { ...actual, DEFAULT_APP_SETTINGS: { ...actual.DEFAULT_APP_SETTINGS, "layout.sidebarOpen": false } };
});

async function mount(url: string) {
  const history = createMemoryHistory({ initialEntries: [url] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate: createFixtureSubstrate() }, history, queryClient });
  render(<RouterProvider router={router} />);
  await screen.findByRole("region", { name: "Settings" });
  return router;
}

const page = () => screen.getByRole("region", { name: "Settings" });
const rowOf = (key: string) => document.getElementById(settingAnchor(key as never));

describe("/settings with the sidebar default flipped to false", () => {
  it("shows the reset while the shell differs from the default, and resets it to the default", async () => {
    localStorage.setItem("xtrm.console.layout.v1", JSON.stringify({ sidebarOpen: true, sidebarWidth: 264 }));
    await mount("/settings/layout");
    const open = rowOf("layout.sidebarOpen")!;
    expect(within(open).getByTestId("setting-value").textContent).toBe("On");
    expect(within(page()).queryByRole("button", { name: "Reset Layout" })).toBeTruthy();
    fireEvent.click(within(open).getByRole("button", { name: "Reset Sidebar open" }));
    await waitFor(() => expect(within(open).getByTestId("setting-value").textContent).toBe("Off"));
    expect(within(open).queryByRole("button", { name: "Reset Sidebar open" })).toBeNull();
    expect(JSON.parse(localStorage.getItem("xtrm.console.layout.v1")!)["sidebarOpen"]).toBe(false);
  });
});
