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

  it("indents the leading cluster and gives the depth back to the key cell, so key, chip and title share one column", async () => {
    renderIssues();
    await firstRow();
    const rows = Array.from(document.querySelectorAll('[role="button"]')).filter((el) => /XTRM-\d/.test(el.textContent ?? ""));
    const byRef = (ref: string) => rows.find((el) => el.querySelector(`button[aria-label="Copy ${ref}"]`)) as HTMLElement | undefined;
    const top = byRef("XTRM-300");
    const child = byRef("XTRM-301");
    const grandchild = byRef("XTRM-303");
    expect(top, "the fixture renders the root row").toBeTruthy();
    expect(child, "the fixture renders a depth-1 row").toBeTruthy();
    expect(grandchild, "the fixture renders a depth-3 row").toBeTruthy();

    // jsdom has no layout, so the guard is the mechanism: no list-wide gutter; the leading cluster
    // carries the row's depth and the key cell subtracts exactly that width, so the chip and title
    // stay on one x. The pixel check lives in e2e/issue-rows.spec.ts.
    for (const row of [top!, child!, grandchild!]) {
      expect(row.querySelector("span[style*='--indent-col']"), "no list-wide indent gutter").toBeNull();
      const leading = row.querySelector("[data-row-leading]") as HTMLElement | null;
      const keyCell = row.querySelector("[data-key-cell]") as HTMLElement | null;
      expect(leading, "the leading cluster is the row's own indent").not.toBeNull();
      expect(keyCell, "the key cell absorbs the depth").not.toBeNull();
      expect(leading!.style.width).toBe("calc(var(--row-indent) + 1.25rem)");
      expect(leading!.style.paddingLeft).toBe("var(--row-indent)");
      expect(keyCell!.style.width).toBe("calc(var(--key-col) - var(--row-indent))");
    }
    const depthOf = (row: HTMLElement) => (row.querySelector("[data-key-cell]")!.parentElement!.parentElement as HTMLElement).style.getPropertyValue("--row-indent");
    expect(depthOf(top!)).toBe("0rem");
    expect(depthOf(child!)).toBe("1.25rem");
    expect(depthOf(grandchild!)).toBe("3.75rem");
  });

  it("shows the primary locator alone and keeps the alias in the tooltip (XTRM-898)", async () => {
    renderIssues();
    await firstRow();
    // XTRM-303 is the fixture's deepest row: locator XTRM-300.1.2.1 under MMD-shaped data.
    const deep = document.querySelector('button[aria-label="Copy XTRM-303"]')!.closest('[role="button"]') as HTMLElement;
    const keyCell = deep.querySelector("[data-key-cell]") as HTMLElement;
    expect(keyCell.textContent).toBe("XTRM-300.1.2.1");
    expect(keyCell.getAttribute("title")).toBe("XTRM-300.1.2.1 / XTRM-303");
  });

  it("keeps the title flexible and the one action in the trailing slot", async () => {
    renderIssues();
    const { row, key } = await firstRow();
    const titleCell = row.firstElementChild!.firstElementChild as HTMLElement;
    const title = titleCell.querySelector("span.flex-1.truncate") as HTMLElement;
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
