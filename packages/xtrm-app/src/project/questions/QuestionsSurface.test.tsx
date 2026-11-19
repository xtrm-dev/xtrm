import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fixtureAdapters } from "../../adapters/index.tsx";
import { FIXTURE_BOARD_REPO, createStatusBoardFixtureAdapter } from "../../adapters/status-board/fixture.ts";
import { createAppRouter } from "../../app/router.tsx";
import { answeredQids, groupQuestions } from "./QuestionsSurface.tsx";

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
    const board = renderQuestions();
    const region = await screen.findByRole("region", { name: "Questions" });
    expect(region.textContent).toContain(FIXTURE_BOARD_REPO);

    const source = await board.listQuestions(FIXTURE_BOARD_REPO);
    await waitFor(() => expect(screen.getByTestId("questions-count").textContent).toBe(`${source.records.length} questions · 2 answered`));
    // The count is the store's own question count, not a rendered subset.
    expect(screen.getAllByTestId("question-row")).toHaveLength(source.records.length);

    const groups = groupQuestions(source.records.map((record) => record.doc));
    expect(screen.getAllByTestId("question-group").map((group) => group.getAttribute("data-owner"))).toEqual(groups.map((group) => group.owner));
    // An owner document with `rows: []` contributes no group.
    expect(groups.map((group) => group.owner)).toEqual(["MMD-4417-engine-lead", "sre-ops"]);

    const first = groups[0]!.rows[0]!;
    const row = screen.getAllByTestId("question-row")[0]!;
    expect(row.getAttribute("data-question-id")).toBe(first.id);
    expect(row.textContent).toContain(first.ref);
    expect(row.textContent).toContain(first.q);
    expect(row.textContent).toContain(first.rec);
    expect(row.textContent).toContain(first.why);
    // The age is relative to now; the fixture's first question is hours old, so it is not "—".
    expect(screen.getAllByTestId("question-age")[0]!.textContent).toMatch(/ago|just now|\d{4}/);
    // The longest-waiting question leads its group.
    expect(groups[0]!.rows.map((question) => question.id)).toEqual(["q-104-surface-order", "q-104-board-pressure"]);
  });

  it("states answered/unanswered from the answers/<qid> records, not from a guess", async () => {
    const board = renderQuestions();
    const region = await screen.findByRole("region", { name: "Questions" });
    await screen.findAllByTestId("question-row");

    const [questions, answers] = await Promise.all([board.listQuestions(FIXTURE_BOARD_REPO), board.listAnswers(FIXTURE_BOARD_REPO)]);
    const answered = answeredQids(answers.records);
    expect(answered.size).toBe(answers.records.length);

    for (const question of questions.records.map((record) => record.doc)) {
      const row = region.querySelector(`[data-question-id="${question.id}"]`);
      expect(row).not.toBeNull();
      const state = row!.getAttribute("data-question-state");
      expect(state).toBe(answered.has(question.id) ? "answered" : "unanswered");
    }

    // The fixture carries both states: one owner question answered, one not, and a stale answer
    // whose question the board no longer carries (real boards keep closed answers).
    expect(screen.getAllByText("answered")).toHaveLength(2);
    expect(screen.getAllByText("unanswered")).toHaveLength(1);
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
