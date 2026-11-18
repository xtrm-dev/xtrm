import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fixtureAdapters, type Adapters } from "../../adapters/index.tsx";
import { FIXTURE_BOARD_REPO, createStatusBoardFixtureAdapter } from "../../adapters/status-board/fixture.ts";
import { createAppRouter } from "../../app/router.tsx";

const DAY = 86_400_000;
const utcDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

function renderTimeline(adapters: Adapters = fixtureAdapters, path = `/rep/${FIXTURE_BOARD_REPO}/project/timeline`) {
  const history = createMemoryHistory({ initialEntries: [path] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters, history, queryClient });
  render(<RouterProvider router={router} />);
  return router;
}

/** The day's own events, read straight from the adapter rather than from the surface's helpers. */
async function eventsOf(board: ReturnType<typeof createStatusBoardFixtureAdapter>, day: string) {
  const page = await board.listSchedule(FIXTURE_BOARD_REPO);
  return page.records.map((record) => record.doc).filter((event) => event.day === day);
}

describe("Project Timeline", () => {
  it("shows exactly the events of the chosen day, in time order, with one now marker", async () => {
    const board = createStatusBoardFixtureAdapter();
    renderTimeline({ ...fixtureAdapters, statusBoard: board });

    const region = await screen.findByRole("region", { name: "Timeline" });
    expect(region.textContent).toContain("mercury/market-data");
    expect(screen.getByTestId("timeline-timezone").textContent).toBe("UTC");

    const today = utcDay(0);
    await screen.findByTestId(`day-group-${today}`);
    const events = await eventsOf(board, today);
    expect(events.map((event) => event.id)).toEqual(["evt-3", "evt-4"]);

    const rows = screen.getAllByTestId(/^event-row-/);
    expect(rows.map((row) => row.getAttribute("data-event-id"))).toEqual(events.map((event) => event.id));
    expect(screen.getByTestId(`day-count-${today}`).textContent).toBe(String(events.length));

    expect(screen.getByText("handover")).toBeTruthy();
    expect(screen.getByText("pr")).toBeTruthy();
    expect(screen.getByText("Shift handover")).toBeTruthy();
    expect(screen.getByText("Project is a repository section")).toBeTruthy();

    const markers = screen.getAllByTestId("now-marker");
    expect(markers).toHaveLength(1);
    // The marker separates what has started from what has not.
    expect(rows[0]?.compareDocumentPosition(markers[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(markers[0]!.compareDocumentPosition(rows[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("steps a day at a time, dates the URL, and returns to today", async () => {
    const board = createStatusBoardFixtureAdapter();
    const router = renderTimeline({ ...fixtureAdapters, statusBoard: board });
    const today = utcDay(0);
    const yesterday = utcDay(-1);
    const tomorrow = utcDay(1);
    await screen.findByTestId(`day-group-${today}`);

    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    await screen.findByTestId(`day-group-${yesterday}`);
    await waitFor(() => expect(router.state.location.search).toMatchObject({ day: yesterday }));
    expect(screen.queryByTestId("now-marker")).toBeNull();
    expect(screen.getAllByTestId(/^event-row-/)).toHaveLength((await eventsOf(board, yesterday)).length);

    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    await screen.findByTestId(`day-group-${today}`);
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    await screen.findByTestId(`day-group-${tomorrow}`);
    const tomorrowEvents = await eventsOf(board, tomorrow);
    expect(tomorrowEvents.map((event) => event.id)).toEqual(["evt-5"]);
    expect(screen.getAllByTestId(/^event-row-/).map((row) => row.getAttribute("data-event-id"))).toEqual(["evt-5"]);
    expect(screen.queryByTestId("now-marker")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Today" }));
    await screen.findByTestId(`day-group-${today}`);
    expect(screen.getByTestId("timeline-day").getAttribute("data-day")).toBe(today);
  });

  it("renders the empty state for a day the board carries nothing for", async () => {
    const empty = utcDay(9);
    renderTimeline(fixtureAdapters, `/rep/${FIXTURE_BOARD_REPO}/project/timeline?day=${empty}`);

    await screen.findByTestId("timeline-empty-day");
    expect(screen.getByTestId("timeline-day").getAttribute("data-day")).toBe(empty);
    expect(screen.queryByTestId(`day-group-${empty}`)).toBeNull();
    expect(screen.queryByTestId("now-marker")).toBeNull();
    expect(screen.getByText(`schedule/${empty} carries no event.`)).toBeTruthy();
  });

  it("exposes the record's provenance in the per-event detail row", async () => {
    renderTimeline();
    const row = await screen.findByTestId("event-row-evt-4");
    fireEvent.click(row);

    const detail = await screen.findByTestId("event-detail-evt-4");
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(detail.textContent).toContain("XTRM-816");
    expect(detail.textContent).toContain("Project is a repository section");
    expect(detail.textContent).toContain("https://github.com/xtrm-dev/xtrm/pull/417");
    expect(detail.textContent).toContain("console-lead");

    fireEvent.click(row);
    await waitFor(() => expect(screen.queryByTestId("event-detail-evt-4")).toBeNull());
  });

  it("keeps an unknown kind as the word the board carried, with its note source", async () => {
    const today = utcDay(0);
    const at = new Date(Date.now() + 3_600_000).toISOString();
    const board = createStatusBoardFixtureAdapter({
      records: [
        {
          path: `schedule/${today}`,
          id: "rec-schedule-today",
          updatedAt: null,
          doc: { date: today, events: [{ id: "evt-x", at, kind: "ceremony", label: "Retro", status: "planned", note: "moved one hour", noteSrc: "manager", createdBy: "manager" }] },
        },
      ],
    });
    renderTimeline({ ...fixtureAdapters, statusBoard: board });

    const row = await screen.findByTestId("event-row-evt-x");
    expect(row.textContent).toContain("ceremony");
    fireEvent.click(row);
    const detail = await screen.findByTestId("event-detail-evt-x");
    expect(detail.textContent).toContain("moved one hour (source: manager)");
    expect(detail.textContent).toContain("manager");
  });

  it("reads no schedule for an unbound repository and renders only the unintegrated state", async () => {
    const board = createStatusBoardFixtureAdapter();
    const binding = vi.spyOn(board, "binding");
    const health = vi.spyOn(board, "health");
    const schedule = vi.spyOn(board, "listSchedule");
    renderTimeline({ ...fixtureAdapters, statusBoard: board }, "/rep/acme/unbound/project/timeline");

    await screen.findByTestId("integration-unbound");
    expect(binding).toHaveBeenCalledTimes(1);
    expect(health).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(screen.queryByTestId("timeline-day")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next day" })).toBeTruthy();
  });
});
