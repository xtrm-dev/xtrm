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
    // XTRM-987: the block and its relation groups are the shared SectionHeader, so the outline is
    // 3/4 rather than a private span, and the gate badge rides in the header's aside.
    expect(within(section).getByRole("heading", { name: "Pull requests", level: 3 })).toBeTruthy();
    expect(within(section).getAllByRole("heading", { name: /^(Created from|Mentioned)$/, level: 4 })).toHaveLength(2);
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
    // The list has no header row after the 2026-11-24 ruling, so the PR number is a sort key in the
    // Order by menu instead of a clickable column head (L3/R4), and the key itself stays quiet in the
    // row because the status chip already carries the colour (§4.4 Restraint rule 1).
    const order = await screen.findByRole("button", { name: /Order by/ });
    fireEvent.click(order);
    expect(await screen.findByText("PR number")).toBeTruthy();
    fireEvent.keyDown(document.body, { key: "Escape" });

    const key = await screen.findByLabelText("Pull request #211");
    expect(key.textContent).toContain("#211");
    // A dim address: the status chip beside it owns the colour.
    expect(key.className).toContain("text-ink-muted");
    expect(key.className).not.toContain("bg-");
    expect(key.getAttribute("title")).toContain("created_from");
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
    expect(merged.closest("[data-slot='badge']")!.className).toContain("bg-chip-accent");
    expect(within(section).getByText("Unknown")).toBeTruthy();
    expect(within(section).getByText(/provenance/)).toBeTruthy();
  });
});
