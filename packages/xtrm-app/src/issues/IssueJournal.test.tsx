import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { IssueDetail, JournalEntry } from "../adapters/index.tsx";
import { JournalTab } from "./IssueJournal.tsx";

function entry(sequence: number): JournalEntry {
  return {
    id: `jrn_${sequence}`,
    sequence,
    kind: "note",
    revision: 1,
    createdAt: 1_700_000_000_000 + sequence,
    summary: `Entry ${sequence}`,
    identity: { participantId: null, activationId: null, attemptId: null, sessionId: null },
    semantic: null,
    result: null,
    mechanical: null,
    executionContext: null,
  };
}

function issue(journal: JournalEntry[], journalTotal: number): IssueDetail {
  return { ref: "XTRM-1", journal, journalTotal, journalError: null, linkEvents: [] } as unknown as IssueDetail;
}

function renderTab(detail: IssueDetail, onLoadOlder?: (before: number) => Promise<JournalEntry[]>) {
  render(<JournalTab issue={detail} canWrite={false} onAdd={() => Promise.resolve()} focusSequence={null} onLoadOlder={onLoadOlder} />);
}

const page = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => entry(to - i));

describe("journal paging", () => {
  it("loads older full-body pages with the oldest loaded sequence as the cursor", async () => {
    const load = vi.fn((before: number) => Promise.resolve([entry(before - 1)]));
    renderTab(issue(page(51, 100), 1000), load);
    expect(screen.getByText(/Showing 50 of 1000 entries/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Load \d+ older/ }));
    expect(load).toHaveBeenCalledWith(51);
    // The page is appended at the bottom, so the rendered window does not move.
    expect(await screen.findByRole("button", { name: "Show 1 older" })).toBeTruthy();
    expect(screen.getByText(/Showing 50 of 1000 entries/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show 1 older" }));
    expect(screen.getByText("Entry 50")).toBeTruthy();
  });

  it("keeps the newest page and says so when the CLI cannot page", () => {
    // An ascending read starts at sequence 1 and still leaves entries unread.
    renderTab(issue(page(1, 2000), 2500), () => Promise.resolve([]));
    expect(screen.getByText(/paging needs substrate 0\.3\.1 or newer/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Load \d+ older/ })).toBeNull();
    expect(screen.getByText(/Showing 50 of 2500 entries/)).toBeTruthy();
  });

  it("reports a failed journal read instead of looking empty", () => {
    renderTab({ ...issue([], 12), journalError: "substrate bridge returned 500" } as IssueDetail);
    const status = screen.getByRole("status");
    expect(within(status).getByText(/Could not read the journal: substrate bridge returned 500/)).toBeTruthy();
    expect(screen.queryByText("No journal entries yet.")).toBeNull();
  });
});
