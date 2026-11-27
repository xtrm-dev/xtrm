import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";

/** XTRM-855: the Issues toolbar is built from the §4.2 primitives, so no control is a chip. */
function renderIssues() {
  const history = createMemoryHistory({ initialEntries: ["/rep/xtrm-dev/xtrm/work/issues"] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate: createFixtureSubstrate() }, history, queryClient });
  render(<RouterProvider router={router} />);
  return router;
}

describe("Issues toolbar (XTRM-855)", () => {
  it("renders the primary action in ink and every filter as a ghost control", async () => {
    renderIssues();
    expect(await screen.findByRole("region", { name: "XTRM Issues" })).toBeTruthy();
    // The primary action appears once the write capability resolves; it keeps ink text.
    const primary = await screen.findByRole("button", { name: "New issue" });
    expect(primary.className.split(/\s+/)).toContain("font-medium");
    // A ghost control may carry `hover:bg-hover`; the chip it replaced carried the `bg-pressed` fill.
    for (const label of ["Status", "Priority", "Type"]) {
      const trigger = screen.getByRole("button", { name: `${label} filter` });
      const tokens = trigger.className.split(/\s+/);
      expect(tokens).toContain("text-ink-muted");
      expect(tokens).not.toContain("bg-pressed");
    }
    expect(screen.getByRole("button", { name: /Order by/ }).className.split(/\s+/)).not.toContain("bg-pressed");
  });

  it("counts the filter against the same population the facets leave visible", async () => {
    renderIssues();
    await screen.findByRole("button", { name: "New issue" });
    fireEvent.click(screen.getByRole("button", { name: "Filter this list" }));
    fireEvent.change(screen.getByLabelText("Filter issues"), { target: { value: "XTRM-359" } });
    // Unfaceted, the population is every loaded issue.
    expect(await screen.findByText("1 of 60")).toBeTruthy();

    // A Status facet narrows the population, so the denominator must narrow with it instead of
    // mixing a post-facet numerator with the all-loaded denominator ("1 of 60" for one done issue).
    // The facet is a multi-select, so every status starts checked and one click turns one off.
    fireEvent.click(screen.getByRole("button", { name: "Status filter" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Done" }));
    const narrowed = await screen.findByText(/^\d+ of \d+$/, { selector: "[title='Rows matching this filter']" });
    const total = Number(narrowed.textContent!.split(" of ")[1]);
    expect(total).toBeLessThan(60);
  });

  it("names a chosen value in the trigger and clears it from the menu", async () => {
    renderIssues();
    fireEvent.click(await screen.findByRole("button", { name: "Priority filter" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "P1" }));
    const chosen = await screen.findByRole("button", { name: "Priority filter: P1" });
    // A chosen value is ink text, not a filled chip.
    expect(chosen.className.split(/\s+/)).not.toContain("bg-pressed");
    expect(chosen.textContent).toContain("P1");
    fireEvent.click(chosen);
    fireEvent.click(await screen.findByRole("menuitem", { name: "Clear" }));
    expect(await screen.findByRole("button", { name: "Priority filter" })).toBeTruthy();
  });

  it("is a 28px filter icon until opened, then filters the loaded rows and counts them", async () => {
    renderIssues();
    await screen.findByRole("region", { name: "XTRM Issues" });
    const resting = screen.getByRole("button", { name: "Filter this list" });
    expect((resting.parentElement as HTMLElement).className).toContain("w-7");
    expect(screen.queryByLabelText("Filter issues")).toBeNull();

    fireEvent.click(resting);
    const input = screen.getByLabelText("Filter issues");
    expect(document.activeElement).toBe(input);
    expect((input.parentElement as HTMLElement).className).toContain("w-48");

    // The fixture holds 60 issues and one of them carries this ref, so the local filter reports 1 of 60.
    fireEvent.change(input, { target: { value: "XTRM-359" } });
    expect(await screen.findByText("1 of 60")).toBeTruthy();

    fireEvent.change(input, { target: { value: "no-such-issue" } });
    expect(await screen.findByText("No issues match this filter")).toBeTruthy();
  });
});
