import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fixtureAdapters } from "../adapters/index.tsx";
import { createFixtureSubstrate } from "../adapters/substrate/fixture.ts";
import { createAppRouter } from "../app/router.tsx";

/**
 * The issue row after the 2026-11-24 treatment ruling (`docs/design/console-ui-system.md`): one line,
 * no column grid, a tinted key chip, a solid status chip, and the three rollups as pills at the right
 * edge. These tests pin that grammar; the pixel checks live in e2e/issue-rows.spec.ts.
 */
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

function allRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[role="button"]')).filter((el) => /XTRM-\d/.test(el.textContent ?? "")) as HTMLElement[];
}

describe("Issues list rows", () => {
  it("reads key chip, then solid status chip, then title, at the issue list's own 13px scale", async () => {
    renderIssues();
    const { row } = await firstRow();

    const key = row.querySelector("[data-key-cell]") as HTMLElement | null;
    expect(key).not.toBeNull();
    const chip = row.querySelector('[data-slot="badge"]') as HTMLElement | null;
    expect(chip).not.toBeNull();
    const title = row.querySelector("span.truncate > span[title]") as HTMLElement | null;
    expect(title).not.toBeNull();

    // The order is the contract: key, then the state carrier, then the title.
    expect(key!.compareDocumentPosition(chip!) & FOLLOWING).toBeTruthy();
    expect(chip!.compareDocumentPosition(title!) & FOLLOWING).toBeTruthy();

    // The list key is quiet text (XTRM-1136): mono, one muted ink, no border, no fill, no fixed key column.
    const keyTokens = key!.firstElementChild!.className.split(/\s+/);
    expect(keyTokens).toContain("font-mono");
    expect(keyTokens).toContain("text-ink-muted");
    expect(keyTokens).not.toContain("border");
    expect(keyTokens.some((t) => t.startsWith("bg-"))).toBe(false);
    expect(key!.style.width).toBe("");

    // The status chip is a pill (treatment T1). A state of work is solid (filled tone, white ink); a gap
    // (Draft, Unattested, Stale, Open) is the quiet muted tint (2026-11-27 ruling).
    const chipTokens = chip!.className.split(/\s+/);
    expect(chipTokens).toContain("rounded-full");
    const quiet = ["Draft", "Unattested", "Stale", "Open"].includes(chip!.textContent ?? "");
    if (quiet) {
      expect(chipTokens).toContain("bg-hover");
      expect(chipTokens).not.toContain("text-white");
    } else {
      expect(chipTokens.some((t) => t.startsWith("bg-chip-"))).toBe(true);
      expect(chipTokens).toContain("text-white");
    }
    expect(chipTokens).not.toContain("w-[4.25rem]");
    expect((chip!.getAttribute("title") ?? "").length).toBeGreaterThan(0);

    // The work-issue list keeps its own denser scale (2026-11-26 ruling): 13px glyphs on a 13px
    // title, while the PR and Activity lists read at 16px. Neither list changes its 32px row.
    const line = row.firstElementChild as HTMLElement;
    const widths = Array.from(line.querySelectorAll("svg")).map((svg) => svg.getAttribute("width"));
    expect(widths.length).toBeGreaterThan(0);
    expect(widths.every((w) => w === "13" || w === "12")).toBe(true);
  });

  it("indents the leading cluster by depth and keeps no gutter", async () => {
    renderIssues();
    await firstRow();
    const rows = allRows();
    const byRef = (ref: string) => rows.find((el) => el.querySelector(`button[aria-label="Copy ${ref}"]`));
    const top = byRef("XTRM-300");
    const child = byRef("XTRM-301");
    const grandchild = byRef("XTRM-303");
    expect(top, "the fixture renders the root row").toBeTruthy();
    expect(child, "the fixture renders a depth-1 row").toBeTruthy();
    expect(grandchild, "the fixture renders a depth-3 row").toBeTruthy();

    for (const row of [top!, child!, grandchild!]) {
      expect(row.querySelector("span[style*='--indent-col']"), "no list-wide indent gutter").toBeNull();
      expect(row.querySelector("[data-row-leading]"), "the leading cluster is the row's own indent").not.toBeNull();
      expect(row.querySelector("[data-key-cell]"), "the key chip holds the row's key").not.toBeNull();
    }
    const depthOf = (row: HTMLElement) => (row.firstElementChild as HTMLElement).style.getPropertyValue("--row-indent");
    expect(depthOf(top!)).toBe("0rem");
    expect(depthOf(child!)).toBe("1.25rem");
    expect(depthOf(grandchild!)).toBe("3.75rem");
    // jsdom folds a zero addend, so the depth-0 form is the bare base padding.
    expect((top!.firstElementChild as HTMLElement).style.paddingLeft).toBe("calc(0.75rem)");
    expect((grandchild!.firstElementChild as HTMLElement).style.paddingLeft).toBe("calc(4.5rem)");
  });

  it("shows the locator in the chip and the full address in its tooltip (XTRM-926)", async () => {
    renderIssues();
    await firstRow();
    // XTRM-303 is the fixture's deepest row: locator XTRM-300.1.2.1 under MMD-shaped data.
    const deep = document.querySelector('button[aria-label="Copy XTRM-303"]')!.closest('[role="button"]') as HTMLElement;
    const keyCell = deep.querySelector("[data-key-cell]") as HTMLElement;
    // The list key is quiet text (XTRM-1136): the whole locator, a slash, then only the short ref's number.
    const pill = keyCell.querySelector("[data-issue-key]") as HTMLElement;
    expect(pill.dataset.locator).toBe("XTRM-300.1.2.1");
    expect(pill.dataset.issueKey).toBe("XTRM-303");
    expect(keyCell.textContent).toBe("XTRM-300.1.2.1/303");
    expect(pill.querySelector("[data-issue-key-number]")!.className).toContain("font-semibold");
    expect(pill.className).not.toContain("border");
    expect(pill.getAttribute("title")).toBe("XTRM-300.1.2.1 / XTRM-303");
    // The copy action still names the unique ref, which is the address a worker pastes.
    expect(within(deep).getByRole("button", { name: "Copy XTRM-303" })).toBeTruthy();
  });

  it("keeps the title flexible and the one action at the row end", async () => {
    renderIssues();
    const { row, ref } = await firstRow();
    const line = row.firstElementChild as HTMLElement;
    const title = line.querySelector("span.truncate") as HTMLElement;
    expect(title.className.split(/\s+/)).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "truncate"]));
    // The action must not live inside the title: it would sit right after the truncated title.
    expect(within(title).queryAllByRole("button", { name: `Copy ${ref}` })).toHaveLength(0);

    // The action lives at the row end, outside the reading line, so it cannot push the title.
    const copy = within(row).getByRole("button", { name: `Copy ${ref}` });
    expect(copy).toBeTruthy();
    expect(line.contains(copy)).toBe(false);
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

  it("drops no field by width: one line, no header, every rollup in the row (2026-11-24 ruling)", async () => {
    // The old table measured its surface and removed columns below 62rem. A one-line row has no
    // column set to reconcile, so the header is gone and the rollups stay in the DOM at any width.
    const viewport = Object.getOwnPropertyDescriptor(window, "innerWidth");
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 900 });
    renderIssues();
    const { row } = await firstRow();
    if (viewport) Object.defineProperty(window, "innerWidth", viewport);

    expect(document.querySelector('[data-testid="issues-table-head"]')).toBeNull();
    expect(document.querySelector('[role="columnheader"]')).toBeNull();
    expect(row.querySelector("[data-column]")).toBeNull();
    // The three rollups are always rendered; the narrow surface hides the two widest with a class.
    for (const icon of ["work", "activity", "external"]) {
      expect(row.querySelector(`[data-stat="${icon}"]`), `${icon} rollup is in the row`).not.toBeNull();
    }
  });
});
