import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fixtureAdapters } from "../../adapters/index.tsx";
import { FIXTURE_BOARD_REPO, createStatusBoardFixtureAdapter } from "../../adapters/status-board/fixture.ts";
import type { StatusBoardAdapter } from "../../adapters/status-board/types.ts";
import { createAppRouter } from "../../app/router.tsx";

const CLAIM_WINDOW_MS = 2 * 60 * 60 * 1000;

function renderOverview(adapters = fixtureAdapters, repository = FIXTURE_BOARD_REPO) {
  const history = createMemoryHistory({ initialEntries: [`/rep/${repository}/project`] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters, history, queryClient });
  render(<RouterProvider router={router} />);
  return router;
}

describe("Project Overview", () => {
  it("composes the header, now/next and attention counts from the board records", async () => {
    const board = createStatusBoardFixtureAdapter();
    renderOverview({ ...fixtureAdapters, statusBoard: board });

    const region = await screen.findByRole("region", { name: "Overview" });
    expect(region.textContent).toContain("mercury/market-data");
    expect((await screen.findByTestId("project-binding")).textContent).toBe("bound");
    // Freshness follows the health read, so it settles with the composed surface.
    await screen.findByTestId("attention-count");
    expect(screen.getByTestId("project-freshness").textContent).toContain("synced");

    expect(await screen.findByText("Project Overview lands on the fixture first")).toBeTruthy();
    expect(screen.getByText(/board\/next/)).toBeTruthy();

    // Independent count of the source records, not the list's own helpers.
    const [questions, answers, workers] = await Promise.all([
      board.listQuestions(FIXTURE_BOARD_REPO),
      board.listAnswers(FIXTURE_BOARD_REPO),
      board.listWorkers(FIXTURE_BOARD_REPO),
    ]);
    const answered = new Set(answers.records.map((answer) => answer.path.replace(/^answers\//, "")));
    const unanswered = questions.records.filter((question) => !question.doc.ref || !answered.has(question.doc.ref));
    const now = Date.now();
    const blocked = workers.records.filter((worker) => worker.doc.status === "blocked");
    const blockedNames = new Set(blocked.map((worker) => worker.doc.name));
    const expiring = workers.records.filter(
      (worker) =>
        !blockedNames.has(worker.doc.name) &&
        worker.doc.claimUntil !== undefined &&
        Date.parse(worker.doc.claimUntil) <= now + CLAIM_WINDOW_MS,
    );
    const attentionWorkers = workers.records.filter((worker) => blockedNames.has(worker.doc.name) || expiring.includes(worker));

    // The board keys answers by question id (`answers/<qid>`), while this list still matches by the
    // question's ref; every fixture question therefore reads as unanswered here (XTRM-877 owns the
    // matcher). The Questions surface itself matches by id.
    expect(unanswered).toHaveLength(3);
    expect(attentionWorkers).toHaveLength(2);

    const total = await screen.findByTestId("attention-count");
    expect(total.textContent).toBe(String(unanswered.length + attentionWorkers.length));
    expect(screen.getByTestId("attention-count-question").textContent).toMatch(/^Question\s*3$/);
    expect(screen.getByTestId("attention-count-blocked").textContent).toBe(`Blocked ${blocked.length}`);
    expect(screen.getByTestId("attention-count-claim-expiring").textContent).toBe(`Claim expiring ${expiring.length}`);
    // No follow-up in the fixture carries a due date, and the only proposal is settled.
    expect(screen.queryByTestId("attention-count-follow-up-due")).toBeNull();
    expect(screen.queryByTestId("attention-count-proposal")).toBeNull();
  });

  it("renders only the unintegrated state for an unbound repository and reads no collection", async () => {
    const board = createStatusBoardFixtureAdapter();
    const binding = vi.spyOn(board, "binding");
    const health = vi.spyOn(board, "health");
    const collections = [
      vi.spyOn(board, "listQuestions"),
      vi.spyOn(board, "listAnswers"),
      vi.spyOn(board, "listWorkers"),
      vi.spyOn(board, "listFollowUps"),
      vi.spyOn(board, "listProposals"),
      vi.spyOn(board, "listStatus"),
      vi.spyOn(board, "listSchedule"),
      vi.spyOn(board, "boardNext"),
      vi.spyOn(board, "record"),
    ];
    renderOverview({ ...fixtureAdapters, statusBoard: board }, "acme/unbound");

    expect(await screen.findByTestId("integration-unbound")).toBeTruthy();
    expect(screen.getByText(/No project-management binding names acme\/unbound/)).toBeTruthy();
    await waitFor(() => expect(binding).toHaveBeenCalledTimes(1));
    // The binding is the one resolution the surface must make; no collection and no health probe follows it.
    for (const spy of [health, ...collections]) expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("attention-count")).toBeNull();
    expect(screen.queryByText("Now / next")).toBeNull();
  });

  it("keeps the records and adds one read-only banner when the sync is stale", async () => {
    const board = createStatusBoardFixtureAdapter();
    const stale: StatusBoardAdapter = {
      ...board,
      async health(repository) {
        return { ...(await board.health(repository)), stale: true };
      },
    };
    renderOverview({ ...fixtureAdapters, statusBoard: stale }, FIXTURE_BOARD_REPO);

    const banner = await screen.findByTestId("integration-stale");
    expect(banner.textContent).toContain("The board sync is stale");
    expect(banner.textContent).toContain("read-only");
    expect(await screen.findByTestId("attention-count")).toBeTruthy();
  });

  it("links an attention row to the surface that owns the record", async () => {
    const router = renderOverview();
    const row = await screen.findByRole("button", { name: /Is the board sync healthy\?/ });
    fireEvent.click(row);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/rep/${FIXTURE_BOARD_REPO}/project/questions`));
  });

  it("keeps the destination hint out of the row name and reveals it on hover", async () => {
    renderOverview();
    const row = await screen.findByRole("button", { name: /Is the board sync healthy\?/ });
    // The hint names the destination; a row's own detail may legitimately contain an arrow
    // (a question's recommendation renders as `→ <rec>`), so the assertion targets the hint.
    expect(screen.queryByRole("button", { name: /→ Questions/ })).toBeNull();
    expect(row.getAttribute("title")).toContain("Is the board sync healthy?");
    const hint = within(row).getByText("→ Questions");
    expect(hint.getAttribute("aria-hidden")).toBe("true");
    expect(hint.className).toContain("opacity-0");
    expect(hint.className).toContain("group-hover/row:opacity-100");
    expect(hint.className).toContain("group-focus-within/row:opacity-100");
  });

  it("links a blocked worker row to the Workers surface", async () => {
    const router = renderOverview();
    fireEvent.click(await screen.findByRole("button", { name: /quant-reviewer is blocked/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/rep/${FIXTURE_BOARD_REPO}/project/workers`));
  });
});
