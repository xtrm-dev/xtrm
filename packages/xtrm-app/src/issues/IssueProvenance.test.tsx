import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters, type IssueDetail } from "../adapters/index.tsx";
import { mapClosure } from "../adapters/substrate/live.ts";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";
import { ClosureCard } from "./IssueProvenance.tsx";
import { CARD_FRAME } from "../ui/card.tsx";

function renderIssue(ref: string) {
  const history = createMemoryHistory({ initialEntries: [`/rep/xtrm-dev/xtrm/work/issues/${ref}`] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate: createFixtureSubstrate() }, history, queryClient });
  render(<RouterProvider router={router} />);
}

describe("issue provenance surfaces", () => {
  it("links a receipt commit to GitHub and jumps from its checkpoint to the journal entry", async () => {
    renderIssue("XTRM-301");
    fireEvent.click(await screen.findByRole("tab", { name: /Provenance/ }));
    // XTRM-987: the provenance groups are the shared SectionHeader at level 4, not a hand-written h4.
    // The group must be one that carries a count: SectionHeader keeps the count in a sibling of the
    // heading, so the heading's name is exactly the title. The hand-written `h4` this replaced folded
    // the number into the heading (`Receipts 2`), which is the mutation that has to fail here — an
    // assertion on `Attestation` cannot tell the two apart, because that group has no count at all.
    const receipts = await screen.findByRole("heading", { name: /^Receipts$/, level: 4 });
    expect(receipts.textContent, "the count sits beside the heading, not inside it").toBe("Receipts");
    expect(receipts.parentElement?.textContent, "and the measured count still rides in the header").toBe("Receipts2");
    const [linked, unlinked] = await screen.findAllByTestId("receipt-row");
    expect(within(linked!).getByRole("link", { name: /abc1234567/ }).getAttribute("href")).toBe("https://github.com/xtrm-dev/xtrm/commit/abc1234567890def");
    expect(within(unlinked!).getAllByText("Not linked")).toHaveLength(2);
    expect(screen.getByTestId("attestation-card")).toBeTruthy();
    expect(screen.getAllByTestId("binding-row")).toHaveLength(1);

    fireEvent.click(within(linked!).getByRole("button", { name: "Journal #4" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: /Journal/ }).getAttribute("aria-selected")).toBe("true"));
    const entry = document.getElementById("journal-entry-4")!;
    expect(entry.getAttribute("data-kind")).toBe("checkpoint");
    expect(within(entry).getByText("act:e305f40b-220")).toBeTruthy();
    expect(within(entry).getByText("Mechanical")).toBeTruthy();
  });

  it("shows journal identity and result blocks", async () => {
    renderIssue("XTRM-301");
    const entries = await screen.findAllByTestId("journal-entry");
    expect(entries.map((e) => e.getAttribute("data-kind"))).toEqual(["checkpoint", "result", "note", "decision"]);
    expect(within(entries[1]!).getByText("Result")).toBeTruthy();
    expect(within(entries[2]!).getByText("No recorded identity")).toBeTruthy();
    expect(within(entries[3]!).getByText("$12")).toBeTruthy();
  });

  it("renders the closure card and marks a closure against an older contract revision", () => {
    const issue = { revision: 3, lifecycle: "done" } as IssueDetail;
    const closure = mapClosure({ closed: true, closedAt: Date.now(), reason: "Shipped", outcome: "completed", actor: "claude-code::x", revision: 2, contractHash: "04e5cf01f4e67301" });
    render(<ClosureCard closure={closure} issue={issue} />);
    expect(screen.getByText("completed")).toBeTruthy();
    expect(screen.getByText("Shipped")).toBeTruthy();
    expect(screen.getByTestId("closure-stale").textContent).toContain("revision 2");
    // The closure card owns one thing the shared card cannot know — its recessed fill — and must
    // not own a second frame (XTRM-989).
    expect(screen.getByTestId("closure-card").className).toContain(CARD_FRAME);
    expect(screen.getByTestId("closure-card").className).toContain("bg-deep/40");
  });

  it("frames the page details block and every provenance record with the one shared card (XTRM-989)", async () => {
    renderIssue("XTRM-301");
    // The page's details block drew `rounded-lg border border-border-muted p-4` while the board card
    // and the provenance records one tab away drew `rounded-md … px-3 py-2.5`: two radii and two
    // paddings for one record box. All three now name the same frame.
    const details = await screen.findByTestId("details-card");
    expect(details.className).toContain(CARD_FRAME);
    fireEvent.click(await screen.findByRole("tab", { name: /Provenance/ }));
    const records = [await screen.findByTestId("attestation-card"), ...(await screen.findAllByTestId("receipt-row")), ...screen.getAllByTestId("binding-row")];
    expect(records.length).toBeGreaterThan(1);
    for (const record of records) expect(record.className, `${record.getAttribute("data-testid")} must not re-draw the frame`).toContain(CARD_FRAME);
  });
});
