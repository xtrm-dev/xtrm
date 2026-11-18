import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(finding.closest("li")!.className).toContain("text-accent-ink");
  });
});

describe("board PR column", () => {
  it("renders the header, the cell and sorts by the linked number", async () => {
    const history = createMemoryHistory({ initialEntries: ["/rep/xtrm-dev/xtrm/work/issues"] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate: createFixtureSubstrate() }, history, queryClient });
    render(<RouterProvider router={router} />);
    const header = await screen.findByRole("columnheader", { name: /PR/ });
    expect(header).toBeTruthy();
    // The column shows the key alone: the state lives in the colour, the glyph and the aria-label.
    const key = await screen.findByLabelText("Pull request #211, merged");
    expect(key.textContent).toContain("#211");
    expect(key.className).toContain("text-accent-ink");
    expect(key.querySelector("svg")).not.toBeNull();
    fireEvent.click(within(header).getByRole("button"));
    expect(header.getAttribute("aria-sort")).not.toBe("none");
  });
});

describe("pull request live state", () => {
  it("renders live state, merge date, title and source labels", async () => {
    const history = createMemoryHistory({ initialEntries: ["/rep/xtrm-dev/xtrm/work/issues/XTRM-301"] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate: createFixtureSubstrate() }, history, queryClient });
    render(<RouterProvider router={router} />);
    const section = await screen.findByRole("region", { name: "Pull requests" });
    expect(within(section).getByText("Add console feature")).toBeTruthy();
    const merged = within(section).getByText("Merged");
    expect(merged.closest("[data-slot='badge']")).toBeTruthy();
    expect(merged.closest("[data-slot='badge']")!.className).toContain("bg-accent-soft");
    expect(within(section).getByText("Unknown")).toBeTruthy();
    expect(within(section).getByText(/provenance/)).toBeTruthy();
  });
});
