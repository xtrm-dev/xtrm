import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";

/** XTRM-856: the issue row per design §4.3 — key, then status chip, then title; one row action. */
function renderIssues() {
  const history = createMemoryHistory({ initialEntries: ["/rep/xtrm-dev/xtrm/work/issues"] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter({ adapters: { ...fixtureAdapters, substrate: createFixtureSubstrate() }, history, queryClient });
  render(<RouterProvider router={router} />);
  return router;
}

const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;

/** The first rendered issue row, resolved from its key cell so the assertion does not depend on a title. */
async function firstRow() {
  await screen.findByRole("region", { name: "XTRM Issues" });
  const keys = await screen.findAllByText(/^XTRM-3\d\d$/, undefined, { timeout: 5000 });
  const row = keys[0].closest('[role="button"]') as HTMLElement | null;
  expect(row).not.toBeNull();
  return { row: row!, key: keys[0] };
}

describe("Issues list rows (XTRM-856)", () => {
  it("reads key, then status chip, then title, with text-size icons", async () => {
    renderIssues();
    const { row, key } = await firstRow();

    const chip = row.querySelector('[data-slot="badge"]') as HTMLElement | null;
    expect(chip).not.toBeNull();
    const title = row.querySelector("span.truncate > span[title]") as HTMLElement | null;
    expect(title).not.toBeNull();

    // The order is the contract: key, then the state carrier, then the title.
    expect(key.compareDocumentPosition(chip!) & FOLLOWING).toBeTruthy();
    expect(chip!.compareDocumentPosition(title!) & FOLLOWING).toBeTruthy();

    // The chip stays the state carrier: a fixed column, an xs label, and the hint as its tooltip.
    const chipTokens = chip!.className.split(/\s+/);
    expect(chipTokens).toContain("w-[4.25rem]");
    expect(chipTokens).toContain("h-4");
    expect((chip!.getAttribute("title") ?? "").length).toBeGreaterThan(0);

    // No row glyph is larger than the text: 13px is the `text` icon size.
    const titleCell = row.firstElementChild?.firstElementChild as HTMLElement;
    const widths = Array.from(titleCell.querySelectorAll("svg")).map((svg) => svg.getAttribute("width"));
    expect(widths.length).toBeGreaterThan(0);
    expect(widths.every((w) => w === "13")).toBe(true);
  });

  it("carries one copy action at the row end and no expand action", async () => {
    renderIssues();
    const { row, key } = await firstRow();

    // The Inspector opens on click and the page on double-click, so the row has no `open` action.
    expect(within(row).queryAllByRole("button", { name: /^Open / })).toHaveLength(0);

    const copy = within(row).getByRole("button", { name: `Copy ${key.textContent}` });
    expect(copy.className.split(/\s+/)).toContain("size-5");
    expect(copy.querySelector("svg")!.getAttribute("width")).toBe("13");
    // Revealed on hover and on keyboard focus, never at rest.
    const wrapper = copy.parentElement!;
    expect(wrapper.className).toContain("opacity-0");
    expect(wrapper.className).toContain("group-hover/row:opacity-100");
    expect(wrapper.className).toContain("group-focus-within/row:opacity-100");
  });
});
