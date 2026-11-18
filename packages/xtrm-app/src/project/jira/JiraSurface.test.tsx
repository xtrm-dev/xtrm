import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../../adapters/index.tsx";
import { createFixtureSubstrate } from "../../adapters/substrate/fixture.ts";
import { createAppRouter } from "../../app/router.tsx";

function renderJira(repo: string) {
  const history = createMemoryHistory({ initialEntries: [`/rep/${repo}/project/jira`] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const adapters = { ...fixtureAdapters, substrate: createFixtureSubstrate() };
  render(<RouterProvider router={createAppRouter({ adapters, history, queryClient })} />);
}

describe("jira surface", () => {
  it("lists the bound project with remote status, assignee, link state and a browse link", async () => {
    renderJira("mercury/market-data");
    await screen.findByRole("region", { name: "Jira" });

    const row = await screen.findByTestId("jira-row-MMD-551");
    expect(within(row).getByText("Ship the Project surface")).toBeTruthy();
    // The status comes from the fetched remote issue: the dot label and the cell both name it.
    expect(within(row).getAllByText("In Progress").length).toBeGreaterThan(0);
    expect(within(row).getByText("Console lead")).toBeTruthy();
    expect(within(row).getByText("in sync")).toBeTruthy();

    const browse = within(row).getByRole("link", { name: /MMD-551/ });
    expect(browse.getAttribute("href")).toBe("https://example.atlassian.net/browse/MMD-551");
    expect(browse.getAttribute("target")).toBe("_blank");
    expect(browse.getAttribute("rel")).toBe("noreferrer");

    expect(within(row).getByRole("button", { name: "XTRM-816" })).toBeTruthy();
    expect(screen.getByTestId("jira-binding").textContent).toContain("MMD");
  });

  it("marks a key with no Substrate binding as unlinked and offers no dead Substrate link", async () => {
    renderJira("mercury/market-data");
    const row = await screen.findByTestId("jira-row-MMD-612");
    expect(within(row).getByText("unlinked")).toBeTruthy();
    expect(within(row).getByText("—")).toBeTruthy();
    expect(within(row).queryByRole("button")).toBeNull();
  });

  it("says the repository is not linked instead of listing an empty project", async () => {
    renderJira("xtrm-dev/xtrm");
    const reason = await screen.findByTestId("jira-unbound-reason");
    expect(reason.textContent).toContain("xtrm-dev/xtrm has no Jira binding");
    expect(screen.getByText("This repository is not linked to Jira")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Jira issues in the bound project" })).toBeNull();
  });
});
