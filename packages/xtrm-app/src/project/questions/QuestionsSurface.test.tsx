import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fixtureAdapters } from "../../adapters/index.tsx";
import { FIXTURE_BOARD_REPO, createStatusBoardFixtureAdapter } from "../../adapters/status-board/fixture.ts";
import type { BoardRecord, Question, StatusBoardAdapter } from "../../adapters/status-board/types.ts";
import { createAppRouter } from "../../app/router.tsx";

function renderBoard(board: StatusBoardAdapter) {
  const history = createMemoryHistory({ initialEntries: [`/rep/${FIXTURE_BOARD_REPO}/project/questions`] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: { ...fixtureAdapters, statusBoard: board }, history, queryClient });
  render(<RouterProvider router={router} />);
  return board;
}

function renderQuestions() {
  return renderBoard(createStatusBoardFixtureAdapter());
}

/** A synthetic board question, in the shape the document mapper hands a surface. */
function question(path: string, doc: Omit<Question, "owner">): BoardRecord<Question> {
  // `mapQuestionDocument` names the owner from the document's path segment; the surface groups by
  // `doc.owner`, so a synthetic row carries the same value.
  return { path, id: `test-${doc.id}`, createdAt: null, updatedAt: null, doc: { ...doc, owner: path.split("/")[1]! }, gaps: [] };
}

/** The fixture plus three unanswered questions of different ages, under three owners. */
function olderBoard(): StatusBoardAdapter {
  const base = createStatusBoardFixtureAdapter();
  const at = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  const extra = [
    question("questions/sre-ops", { id: "q-201-oldest", ref: "XTRM-801", q: "Is the oldest open question still open?", at: at(10) }),
    question("questions/quant-lead", { id: "q-202-mid", ref: "XTRM-802", q: "Is the middle open question still open?", at: at(5) }),
    question("questions/MMD-4417-engine-lead", { id: "q-203-new", ref: "XTRM-803", q: "Is the newest open question still open?", at: at(0.5) }),
  ];
  return {
    ...base,
    listQuestions: async (repository, opts) => {
      const page = await base.listQuestions(repository, opts);
      return { ...page, records: [...page.records, ...extra] };
    },
  };
}

function sections(): HTMLElement[] {
  return screen.getAllByTestId("question-section");
}

function sectionRows(section: HTMLElement): string[] {
  return Array.from(section.querySelectorAll("[data-question-id]")).map((row) => row.getAttribute("data-question-id") ?? "");
}

describe("Project Questions", () => {
  it("leads with the unanswered questions, then the answered group collapsed below", async () => {
    renderQuestions();
    const region = await screen.findByRole("region", { name: "Questions" });
    expect(region.textContent).toContain(FIXTURE_BOARD_REPO);

    // The fixture carries three questions: two open under one owner, one under another, plus an
    // owner document with `rows: []` that contributes no group. Every number here is a literal.
    await waitFor(() => expect(screen.getByTestId("questions-count").textContent).toBe("3 questions · 2 answered"));
    expect(screen.getAllByTestId("question-row")).toHaveLength(3);

    // Unanswered first, open; the answered backlog below, closed by default and counted.
    const [unanswered, answered] = sections() as [HTMLElement, HTMLDetailsElement];
    expect(unanswered.getAttribute("data-section")).toBe("unanswered");
    expect(answered.getAttribute("data-section")).toBe("answered");
    expect(answered.open).toBe(false);
    expect(unanswered.querySelector("[data-testid='question-section-count']")!.textContent).toBe("1");
    expect(answered.querySelector("summary [data-testid='question-section-count']")!.textContent).toBe("2");

    // Owner grouping stays inside each section: the same owner can appear in both.
    expect(Array.from(unanswered.querySelectorAll("[data-testid='question-group']")).map((group) => group.getAttribute("data-owner"))).toEqual([
      "MMD-4417-engine-lead",
    ]);
    expect(Array.from(answered.querySelectorAll("[data-testid='question-group']")).map((group) => group.getAttribute("data-owner"))).toEqual([
      "MMD-4417-engine-lead",
      "sre-ops",
    ]);

    // XTRM-918: one owner in both sections means two groups with the same owner, so the region name
    // carries the section as well — two identically named regions cannot be told apart.
    const labels = [unanswered, answered].flatMap((section) =>
      Array.from(section.querySelectorAll("[data-testid='question-group']")).map((group) => group.getAttribute("aria-label")),
    );
    expect(labels).toEqual(["Unanswered, owner MMD-4417-engine-lead", "Answered, owner MMD-4417-engine-lead", "Answered, owner sre-ops"]);
    expect(new Set(labels).size).toBe(labels.length);

    // The unanswered row is the operator's work and reads first; inside a group the
    // longest-waiting question leads.
    expect(screen.getAllByTestId("question-row").map((item) => item.getAttribute("data-question-id"))).toEqual([
      "q-104-board-pressure",
      "q-104-surface-order",
      "q-105-sync-health",
    ]);

    const row = screen.getAllByTestId("question-row")[0]!;
    expect(row.textContent).toContain("XTRM-820");
    expect(row.textContent).toContain("Does the console show board pressure per repository");
    expect(row.textContent).toContain("Per repository");
    expect(row.textContent).toContain("each repository binds its own board");
    // The age is relative to now; the fixture's first question is hours old, so it is not "—".
    expect(screen.getAllByTestId("question-age")[0]!.textContent).toMatch(/ago|just now|\d{4}/);
  });

  it("orders the unanswered section oldest first across owners and opens the answered backlog on demand", async () => {
    renderBoard(olderBoard());
    await screen.findByRole("region", { name: "Questions" });
    await waitFor(() => expect(screen.getByTestId("questions-count").textContent).toBe("6 questions · 2 answered"));

    const [unanswered, answered] = sections() as [HTMLElement, HTMLDetailsElement];
    // Oldest-first across owners: -10h (sre-ops), -5h (quant-lead), then the MMD group with its
    // -2h and -30m rows. Alphabetical owner order would read MMD first; age order does not.
    expect(Array.from(unanswered.querySelectorAll("[data-testid='question-group']")).map((group) => group.getAttribute("data-owner"))).toEqual([
      "sre-ops",
      "quant-lead",
      "MMD-4417-engine-lead",
    ]);
    expect(sectionRows(unanswered)).toEqual(["q-201-oldest", "q-202-mid", "q-104-board-pressure", "q-203-new"]);
    expect(unanswered.querySelector("[data-testid='question-section-count']")!.textContent).toBe("4");

    // Answered stays closed by default, with its count; expanding it reveals its rows in the same
    // oldest-first owner grouping.
    expect(answered.open).toBe(false);
    expect(answered.querySelector("summary [data-testid='question-section-count']")!.textContent).toBe("2");
    expect(sectionRows(answered)).toEqual(["q-104-surface-order", "q-105-sync-health"]);
    fireEvent.click(answered.querySelector("summary")!);
    expect(answered.open).toBe(true);

    // The sections together carry every row, and the toolbar counts are unchanged.
    expect(screen.getAllByTestId("question-row")).toHaveLength(6);
    expect(sectionRows(unanswered).length + sectionRows(answered).length).toBe(6);
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
    renderBoard(truncated);

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

    // The read is the binding, the health and the two collections; no record write follows. The
    // answered disclosure is a native <details>, so opening it still writes nothing.
    const writes = vi.spyOn(board, "record");
    const answered = sections()[1]!;
    fireEvent.click(answered.querySelector("summary")!);
    await waitFor(() => expect(screen.getByTestId("questions-list")).toBeTruthy());
    expect(writes).not.toHaveBeenCalled();
    writes.mockRestore();
  });
});
