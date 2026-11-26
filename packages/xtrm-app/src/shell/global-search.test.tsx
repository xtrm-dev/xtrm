import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";

function renderAt(url: string) {
  const history = createMemoryHistory({ initialEntries: [url] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const substrate = createFixtureSubstrate();
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate }, history, queryClient });
  render(<RouterProvider router={router} />);
  return { router };
}

describe("palette pull requests", () => {
  it("lists a pull request by number and opens it in the inspector", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues");
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    const input = await screen.findByPlaceholderText("Search xtrm");
    fireEvent.change(input, { target: { value: "#212" } });

    // "Pull requests" also names a sidebar destination, so the group heading is
    // read inside the palette list, not across the whole shell.
    const list = await screen.findByRole("listbox");
    expect(await within(list).findByText("Pull requests")).toBeTruthy();
    const item = await within(list).findByRole("option", { name: /rail keyboard model v2/ });
    expect(item.textContent).toContain("#212 · open");
    fireEvent.click(item);

    await waitFor(() => expect(screen.getByTestId("inspector-drawer")).toBeTruthy());
    // The inspector opened on that pull request, not on the first search hit.
    const header = await screen.findByTestId("pull-header");
    expect(header.textContent).toContain("#212");
  });
});

describe("palette issue status, hint budget, and exact pull number", () => {
  it("shows the list's status, not the raw lifecycle, for a claimed issue", async () => {
    // The fixture marks every issue open-and-ready-or-draft; make them claimed,
    // which is the case the raw lifecycle reported as "open" in the palette.
    const substrate = createFixtureSubstrate();
    const listIssues = substrate.listIssues.bind(substrate);
    const claimed = { ...substrate, listIssues: async (projectId: string) => (await listIssues(projectId)).map((i) => ({ ...i, readiness: "claimed" as const })) };
    const history = createMemoryHistory({ initialEntries: ["/rep/xtrm-dev/xtrm/work/issues"] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate: claimed }, history, queryClient });
    render(<RouterProvider router={router} />);

    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    const input = await screen.findByPlaceholderText("Search xtrm");
    fireEvent.change(input, { target: { value: "XTRM-300" } });

    const list = await screen.findByRole("listbox");
    const [item] = await within(list).findAllByRole("option", { name: /Console v2 executable shell/ });
    expect(item!.textContent).toContain("· In progress");
    expect(item!.textContent).not.toMatch(/· Open/);
  });

  it("caps the hint so it can never squeeze the label to zero", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues");
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    const input = await screen.findByPlaceholderText("Search xtrm");
    fireEvent.change(input, { target: { value: "XTRM-300" } });

    const list = await screen.findByRole("listbox");
    const [item] = await within(list).findAllByRole("option", { name: /Console v2 executable shell/ });
    const label = item!.querySelector("span.flex-1")!;
    const hint = [...item!.querySelectorAll("span")].find((s) => s.textContent?.includes("·"))!;
    expect(label.className).toContain("min-w-0");
    expect(label.className).toContain("flex-1");
    expect(label.className).toContain("truncate");
    expect(hint.className).toContain("shrink-0");
    expect(hint.className).toContain("max-w-[45%]");
  });

  it("opens a pull request past the loaded page from an exact number", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues");
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    const input = await screen.findByPlaceholderText("Search xtrm");
    // The adapter pages pull requests, so 4099 is not in the loaded list.
    fireEvent.change(input, { target: { value: "#4099" } });

    const list = await screen.findByRole("listbox");
    expect(await within(list).findByRole("option", { name: /Open pull request #4099/ })).toBeTruthy();
  });

  it("names the repository in the pull request heading when the scope is the workspace", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues");
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    const input = await screen.findByPlaceholderText("Search xtrm");
    fireEvent.change(input, { target: { value: "#212" } });

    const list = await screen.findByRole("listbox");
    fireEvent.click(screen.getByRole("radio", { name: "Workspace" }));
    // Pull requests stay repository-scoped, and the heading says which repository.
    expect(await within(list).findByText("Pull requests · xtrm")).toBeTruthy();
  });
});

describe("palette issue hint shape", () => {
  it("keeps the locator only and stays findable by the ref alias", async () => {
    renderAt("/rep/xtrm-dev/xtrm/work/issues");
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    const input = await screen.findByPlaceholderText("Search xtrm");
    // XTRM-302 is a child: locator XTRM-300.1.2, ref XTRM-302.
    fireEvent.change(input, { target: { value: "XTRM-302" } });

    const list = await screen.findByRole("listbox");
    const options = await within(list).findAllByRole("option");
    expect(options.length).toBeGreaterThan(0);
    const hints = options
      .map((o) => [...o.querySelectorAll("span")].find((s) => s.className.includes("pl-4") && s.className.includes("text-ink-faint")))
      .filter((s): s is HTMLElement => s !== undefined)
      .map((s) => s.textContent ?? "");
    // The alias never spends hint width; the locator carries the identity.
    expect(hints[0]).toMatch(/^XTRM-300\.1\.2 · /);
    expect(hints[0]).not.toContain("XTRM-302");
    // The ref is still a search key, which is what makes dropping it safe.
    expect(options.some((o) => (o.textContent ?? "").includes("XTRM-300.1.2"))).toBe(true);
  });
});
