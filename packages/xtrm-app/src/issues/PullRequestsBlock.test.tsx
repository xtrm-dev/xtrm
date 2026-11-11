import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";

function renderIssue(ref: string) {
  const history = createMemoryHistory({ initialEntries: [`/rep/xtrm-dev/xtrm/work/issues/${ref}`] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate: createFixtureSubstrate() }, history, queryClient });
  render(<RouterProvider router={router} />);
}

describe("issue page pull-request surface", () => {
  it("shows created_from before mentioned, the sources and the manual gate badge", async () => {
    renderIssue("XTRM-301");
    const section = await screen.findByRole("region", { name: "Pull requests" });
    const labels = within(section).getAllByText(/^(Created from|Mentioned)$/).map((n) => n.textContent);
    expect(labels).toEqual(["Created from", "Mentioned"]);
    expect(within(section).getByText("gate refuse")).toBeTruthy();
    expect(within(section).getByText(/provenance/)).toBeTruthy();
    expect(within(section).getByText(/title/)).toBeTruthy();
  });

  it("renders link events in the activity timeline with findings as warnings", async () => {
    renderIssue("XTRM-301");
    const timeline = await screen.findByRole("list", { name: "Pull-request events" });
    expect(within(timeline).getByText("link created")).toBeTruthy();
    const finding = within(timeline).getByText("link finding");
    expect(finding.closest("li")!.className).toContain("text-danger");
  });
});
