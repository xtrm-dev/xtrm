import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../../adapters/index.tsx";
import { FIXTURE_BOARD_REPO, createStatusBoardFixtureAdapter } from "../../adapters/status-board/fixture.ts";
import { createAppRouter } from "../../app/router.tsx";
import { groupFollowUps, priorityRank } from "./FollowUpsSurface.tsx";

function renderFollowUps() {
  const board = createStatusBoardFixtureAdapter();
  const history = createMemoryHistory({ initialEntries: [`/rep/${FIXTURE_BOARD_REPO}/project/followups`] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: { ...fixtureAdapters, statusBoard: board }, history, queryClient });
  render(<RouterProvider router={router} />);
  return board;
}

describe("Project Follow-ups", () => {
  it("lists every board follow-up, with priority, status, owner, when and its refs", async () => {
    const board = renderFollowUps();
    const region = await screen.findByRole("region", { name: "Follow-ups" });
    expect(region.textContent).toContain("mercury/market-data");

    const source = await board.listFollowUps(FIXTURE_BOARD_REPO);
    await waitFor(() => expect(screen.getByTestId("followups-count").textContent).toBe(`${source.records.length} follow-ups`));
    expect(screen.getAllByTestId("followup-row")).toHaveLength(source.records.length);

    const first = source.records[0]!.doc;
    const row = (await screen.findAllByTestId("followup-row"))[0]!;
    expect(row.textContent).toContain(first.ref);
    expect(row.textContent).toContain(first.priority ?? "—");
    expect(row.textContent).toContain(first.status ?? "unknown state");
    expect(row.textContent).toContain(first.owner ?? "unowned");
    expect(row.textContent).toContain(first.when ?? "—");
    // Every ref renders: a chip when it resolves, its plain text when it does not — never a dead link.
    for (const ref of first.refs ?? []) expect(row.textContent).toContain(ref);
    // The fixture carries one ref the issue index resolves (XTRM-317), so the chip assertion is not
    // vacuous: a resolved ref renders an interactive chip (the app inspects in place), an unresolved
    // one stays plain text, and every anchor that does exist points somewhere real.
    expect(first.refs).toContain("XTRM-317");
    const chip = row.querySelector('[data-reference*="XTRM-317"]');
    expect(chip).not.toBeNull();
    expect(chip!.tagName).toBe("BUTTON");
    expect(row.querySelector('[data-reference*="XTRM-815"]')).toBeNull();
    for (const anchor of row.querySelectorAll("a")) expect(anchor.getAttribute("href")).not.toMatch(/undefined|XTRM-\d+$/);
  });

  it("sorts groups by status and rows by priority, and ranks P0 before P10", async () => {
    const board = renderFollowUps();
    await screen.findAllByTestId("followup-row");
    const source = await board.listFollowUps(FIXTURE_BOARD_REPO);
    const groups = groupFollowUps(source.records.map((r) => r.doc));
    expect(groups.map((g) => g.status)).toEqual(["open", "deferred"]);
    for (const group of groups) {
      const ranks = group.rows.map((r) => priorityRank(r.priority));
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
    expect(priorityRank("P0")).toBe(0);
    expect(priorityRank("P10")).toBe(10);
    expect(priorityRank(undefined)).toBe(Number.POSITIVE_INFINITY);
  });
});
