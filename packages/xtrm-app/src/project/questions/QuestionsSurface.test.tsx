import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fixtureAdapters } from "../../adapters/index.tsx";
import { FIXTURE_BOARD_REPO, createStatusBoardFixtureAdapter } from "../../adapters/status-board/fixture.ts";
import type { StatusBoardAdapter } from "../../adapters/status-board/types.ts";
import { createAppRouter } from "../../app/router.tsx";

function renderQuestions() {
  const board = createStatusBoardFixtureAdapter();
  const history = createMemoryHistory({ initialEntries: [`/rep/${FIXTURE_BOARD_REPO}/project/questions`] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: { ...fixtureAdapters, statusBoard: board }, history, queryClient });
  render(<RouterProvider router={router} />);
  return board;
}

describe("Project Questions", () => {
  it("renders every board question grouped by owner, with ref, text, recommendation, why and age", async () => {
    renderQuestions();
    const region = await screen.findByRole("region", { name: "Questions" });
    expect(region.textContent).toContain(FIXTURE_BOARD_REPO);

    // The fixture carries three questions: two open under one owner, one under another, plus an
    // owner document with `rows: []` that contributes no group. Every number here is a literal.
    await waitFor(() => expect(screen.getByTestId("questions-count").textContent).toBe("3 questions · 2 answered"));
    expect(screen.getAllByTestId("question-row")).toHaveLength(3);
    expect(screen.getAllByTestId("question-group").map((group) => group.getAttribute("data-owner"))).toEqual(["MMD-4417-engine-lead", "sre-ops"]);

    const row = screen.getAllByTestId("question-row")[0]!;
    expect(row.getAttribute("data-question-id")).toBe("q-104-surface-order");
    expect(row.textContent).toContain("XTRM-817");
    expect(row.textContent).toContain("Should the Project Overview ship before the Jira read path");
    expect(row.textContent).toContain("Overview first; Jira in its own issue");
    expect(row.textContent).toContain("the attention list is the operator's daily read");
    // The age is relative to now; the fixture's first question is hours old, so it is not "—".
    expect(screen.getAllByTestId("question-age")[0]!.textContent).toMatch(/ago|just now|\d{4}/);
    // The longest-waiting question leads its group: 6h old, then 2h old, then the other owner.
    expect(screen.getAllByTestId("question-row").map((item) => item.getAttribute("data-question-id"))).toEqual([
      "q-104-surface-order",
      "q-104-board-pressure",
      "q-105-sync-health",
    ]);
  });

  it("states answered/unanswered from the answers/<qid> records, not from a guess", async () => {
    renderQuestions();
    const region = await screen.findByRole("region", { name: "Questions" });
    await screen.findAllByTestId("question-row");

    // Literal states, from the fixture's three questions and two answers.
    const states = Object.fromEntries(
      Array.from(region.querySelectorAll("[data-question-id]")).map((row) => [row.getAttribute("data-question-id"), row.getAttribute("data-question-state")]),
    );
    expect(states).toEqual({
      "q-104-surface-order": "answered",
      "q-104-board-pressure": "unanswered",
      "q-105-sync-health": "answered",
    });

    // The fixture carries both states, and a stale answer whose question the board no longer
    // carries (real boards keep closed answers) must not invent a fourth row.
    expect(screen.getAllByText("answered")).toHaveLength(2);
    expect(screen.getAllByText("unanswered")).toHaveLength(1);
  });

  it("names an incomplete read instead of presenting a short page as the board", async () => {
    const board = createStatusBoardFixtureAdapter();
    const truncated: StatusBoardAdapter = {
      ...board,
      listQuestions: async (repository, opts) => {
        const page = await board.listQuestions(repository, opts);
        return { ...page, records: page.records.slice(0, 1), truncated: true, gaps: [{ path: "questions/odd", field: "id", value: "<absent>" }] };
      },
    };
    const history = createMemoryHistory({ initialEntries: [`/rep/${FIXTURE_BOARD_REPO}/project/questions`] });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createAppRouter({ adapters: { ...fixtureAdapters, statusBoard: truncated }, history, queryClient });
    render(<RouterProvider router={router} />);

    await screen.findByRole("region", { name: "Questions" });
    await waitFor(() => expect(screen.getByTestId("questions-caveat").textContent).toContain("Incomplete read"));
    expect(screen.getByTestId("questions-caveat").textContent).toContain("more remain on the board");
    expect(screen.getByTestId("questions-caveat").textContent).toContain("1 record could not be read as declared");
    expect(screen.getAllByTestId("question-row")).toHaveLength(1);
  });

  it("is read-only: it names XTRM-821 and offers no control that writes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const board = renderQuestions();
    const region = await screen.findByRole("region", { name: "Questions" });
    await screen.findAllByTestId("question-row");

    expect(screen.getByTestId("questions-read-only").textContent).toContain("Answering stays on the status board until XTRM-821");
    expect(region.querySelectorAll("input, textarea, select")).toHaveLength(0);
    expect(region.querySelectorAll("form")).toHaveLength(0);
    // The fixture adapter never reaches the network; this pins that the surface itself does not either.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    // The read is the binding, the health and the two collections; no record write follows.
    const writes = vi.spyOn(board, "record");
    await waitFor(() => expect(screen.getByTestId("questions-list")).toBeTruthy());
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
  });
});
