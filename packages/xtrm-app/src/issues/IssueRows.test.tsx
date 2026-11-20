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

/** The first rendered issue row, resolved through its copy action, so no title or alias is assumed. */
async function firstRow() {
  await screen.findByRole("region", { name: "XTRM Issues" });
  const copies = await screen.findAllByRole("button", { name: /^Copy XTRM-\d+$/ }, { timeout: 5000 });
  const ref = copies[0]!.getAttribute("aria-label")!.replace("Copy ", "");
  const row = copies[0]!.closest('[role="button"]') as HTMLElement | null;
  expect(row).not.toBeNull();
  return { row: row!, ref };
}

describe("Issues list rows (XTRM-856)", () => {
  it("reads key, then status chip, then title, with text-size icons", async () => {
    renderIssues();
    const { row } = await firstRow();

    const key = row.querySelector("[data-key-text]") as HTMLElement | null;
    expect(key).not.toBeNull();
    const chip = row.querySelector('[data-slot="badge"]') as HTMLElement | null;
    expect(chip).not.toBeNull();
    const title = row.querySelector("span.truncate > span[title]") as HTMLElement | null;
    expect(title).not.toBeNull();

    // The order is the contract: key, then the state carrier, then the title.
    expect(key!.compareDocumentPosition(chip!) & FOLLOWING).toBeTruthy();
    expect(chip!.compareDocumentPosition(title!) & FOLLOWING).toBeTruthy();

    // One line, one gap: the key cell, the chip and the title are siblings under the same small gap.
    const line = row.querySelector("[data-key-cell]")!.parentElement as HTMLElement;
    expect(Array.from(line.children)).toEqual([row.querySelector("[data-row-leading]"), row.querySelector("[data-key-cell]"), chip, title!.parentElement]);
    expect(line.className.split(/\s+/)).toContain("gap-1.5");

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

  it("indents the leading cluster and lets the key, the chip and the title flow inline (XTRM-926)", async () => {
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

    // jsdom has no layout, so the guard is the mechanism: no list-wide gutter and no computed key
    // column — the key cell is only as wide as its own content, and the chip follows it. The pixel
    // check lives in e2e/issue-rows.spec.ts.
    for (const row of [top!, child!, grandchild!]) {
      expect(row.querySelector("span[style*='--indent-col']"), "no list-wide indent gutter").toBeNull();
      const leading = row.querySelector("[data-row-leading]") as HTMLElement | null;
      const keyCell = row.querySelector("[data-key-cell]") as HTMLElement | null;
      expect(leading, "the leading cluster is the row's own indent").not.toBeNull();
      expect(keyCell, "the key cell holds the row's key").not.toBeNull();
      expect(leading!.style.width).toBe("calc(var(--row-indent) + 1.25rem)");
      expect(leading!.style.paddingLeft).toBe("var(--row-indent)");
      // No width is computed: neither an inline one nor a key-column variable on the line.
      expect(keyCell!.style.width).toBe("");
      expect(keyCell!.parentElement!.style.getPropertyValue("--key-col")).toBe("");
    }
    const depthOf = (row: HTMLElement) => (row.querySelector("[data-key-cell]")!.parentElement!.parentElement as HTMLElement).style.getPropertyValue("--row-indent");
    expect(depthOf(top!)).toBe("0rem");
    expect(depthOf(child!)).toBe("1.25rem");
    expect(depthOf(grandchild!)).toBe("3.75rem");
  });

  it("shows the locator and the unique ref inline when they differ (XTRM-926)", async () => {
    renderIssues();
    await firstRow();
    // XTRM-303 is the fixture's deepest row: locator XTRM-300.1.2.1 under MMD-shaped data.
    const deep = document.querySelector('button[aria-label="Copy XTRM-303"]')!.closest('[role="button"]') as HTMLElement;
    const keyCell = deep.querySelector("[data-key-cell]") as HTMLElement;
    expect(keyCell.textContent).toBe("XTRM-300.1.2.1 / XTRM-303");
    expect(keyCell.querySelector("[data-key-text] .text-ink-faint")?.textContent).toBe(" / XTRM-303");
    // The tooltip keeps the full address for a list narrow enough to truncate the key.
    expect(keyCell.getAttribute("title")).toBe("XTRM-300.1.2.1 / XTRM-303");
  });

  it("keeps the title flexible and the one action in the trailing slot", async () => {
    renderIssues();
    const { row, ref } = await firstRow();
    const titleCell = row.firstElementChild!.firstElementChild as HTMLElement;
    const title = titleCell.querySelector("span.flex-1.truncate") as HTMLElement;
    expect(title.className.split(/\s+/)).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "truncate"]));
    // The action must not live inside the title cell: it would sit right after the truncated title.
    expect(within(titleCell).queryAllByRole("button", { name: `Copy ${ref}` })).toHaveLength(0);

    const grid = titleCell.parentElement as HTMLElement;
    const trailing = grid.lastElementChild as HTMLElement;
    const copy = within(trailing).getByRole("button", { name: `Copy ${ref}` });
    expect(copy).toBeTruthy();
    expect(trailing.className).toContain("justify-end");
  });

  it("carries one copy action at the row end and no expand action", async () => {
    renderIssues();
    const { row, ref } = await firstRow();

    // The Inspector opens on click and the page on double-click, so the row has no `open` action.
    expect(within(row).queryAllByRole("button", { name: /^Open / })).toHaveLength(0);

    const copy = within(row).getByRole("button", { name: `Copy ${ref}` });
    expect(copy.className.split(/\s+/)).toContain("size-5");
    expect(copy.querySelector("svg")!.getAttribute("width")).toBe("13");
    // Revealed on hover and on keyboard focus, never at rest.
    const wrapper = copy.parentElement!;
    expect(wrapper.className).toContain("opacity-0");
    expect(wrapper.className).toContain("group-hover/row:opacity-100");
    expect(wrapper.className).toContain("group-focus-within/row:opacity-100");
  });
  it("keeps header and rows on one column set when the list drops its low-value columns (XTRM-911)", async () => {
    // jsdom has no layout, so the surface sizes itself from the viewport: a 900px surface drops the
    // two rollups, and neither header nor row may keep a cell for them.
    const viewport = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    renderIssues();
    const { row } = await firstRow();
    if (viewport) Object.defineProperty(window, "innerWidth", viewport);
    const head = document.querySelector('[data-testid="issues-table-head"]') as HTMLElement;
    const headers = Array.from(head.querySelectorAll('[role="columnheader"]')).map((h) => (h.textContent ?? "").toLowerCase());
    const cells = Array.from(row.querySelectorAll("[data-column]")).map((c) => c.getAttribute("data-column") ?? "");
    expect(cells).not.toContain("events");
    expect(headers.some((h) => h.includes("events"))).toBe(false);
    expect(cells.length + 1).toBe(headers.length);
    for (const cell of cells) expect(headers.some((h) => h.replace(/[^a-z]/g, "") === cell)).toBe(true);
  });

});
