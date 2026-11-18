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

  it("indents in a fixed gutter, so key, chip and title share one column", async () => {
    renderIssues();
    await firstRow();
    const rows = Array.from(document.querySelectorAll('[role="button"]')).filter((el) => /XTRM-\d/.test(el.textContent ?? ""));
    const top = rows[0] as HTMLElement;
    // The child row is XTRM-301 — a fixture issue whose parent is XTRM-300 — selected by its own
    // reference through the row action label, not by the shape of the rendered locator.
    const child = rows.find((el) => el.querySelector('button[aria-label="Copy XTRM-301"]')) as HTMLElement | undefined;
    expect(child, "the fixture renders at least one child row").toBeTruthy();

    // jsdom has no layout, so the guard is the mechanism: one gutter width for the list, and the
    // indent carried only by that gutter's padding. The pixel check lives in e2e/issue-rows.spec.ts.
    for (const row of [top, child!]) {
      const gutter = row.querySelector("span[style*='--indent-col']") as HTMLElement | null;
      expect(gutter, "the leading gutter is a constant-width span").not.toBeNull();
      expect(gutter!.style.width).toBe("calc(var(--indent-col) + 1.25rem)");
      const titleCell = row.firstElementChild!.firstElementChild as HTMLElement;
      expect(titleCell.style.paddingLeft, "no depth-dependent padding on the title cell").toBe("");
    }
    const depthOf = (row: HTMLElement) => (row.querySelector("span[style*='--indent-col']") as HTMLElement).style.paddingLeft;
    expect(depthOf(child!)).not.toBe(depthOf(top));
  });

  it("keeps the title flexible and the one action in the trailing slot", async () => {
    renderIssues();
    const { row, key } = await firstRow();
    const titleCell = row.firstElementChild!.firstElementChild as HTMLElement;
    const title = titleCell.querySelector("span.truncate") as HTMLElement;
    expect(title.className.split(/\s+/)).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "truncate"]));
    // The action must not live inside the title cell: it would sit right after the truncated title.
    expect(within(titleCell).queryAllByRole("button", { name: `Copy ${key.textContent}` })).toHaveLength(0);

    const grid = titleCell.parentElement as HTMLElement;
    const trailing = grid.lastElementChild as HTMLElement;
    const copy = within(trailing).getByRole("button", { name: `Copy ${key.textContent}` });
    expect(copy).toBeTruthy();
    expect(trailing.className).toContain("justify-end");
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
