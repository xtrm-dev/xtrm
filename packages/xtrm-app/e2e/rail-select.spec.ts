import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { capture } from "./scale-capture.ts";

/**
 * XTRM-927, operator report on the sidebar rail: the selected child chip was narrower than a selected
 * top-level row, because its box began at the rail (15px indent + 1px hairline) instead of at the
 * sidebar's own edge. The fill must now span the same left and right edges as a top-level row's,
 * while the label column, the hairline and the 2px accent marker stay where they were.
 *
 * The screenshots are the before/after evidence of the PR:
 *   RAIL_SHOTS_DIR=docs/screenshots/rail-select RAIL_PHASE=after npx playwright test e2e/rail-select.spec.ts
 * `before` is the tree at the parent commit; unset writes to the test's own output dir (e2e/.results).
 */

const REPO = "xtrm-dev/xtrm";
const EXPORT_DIR = process.env.RAIL_SHOTS_DIR;
const PHASE = process.env.RAIL_PHASE ?? "after";

type Box = { left: number; right: number; width: number; labelX: number; sidebarX: number; ariaCurrent: string | null };

/** The row whose label span is exactly `text`, measured in viewport pixels. */
const measureRow = (page: Page, text: string) =>
  page.evaluate((label): Box | null => {
    const round = (value: number) => Math.round(value * 100) / 100;
    const sidebar = document.querySelector<HTMLElement>('[data-testid="context-sidebar"]');
    if (!sidebar) return null;
    const span = Array.from(sidebar.querySelectorAll("span")).find((node) => (node.textContent ?? "").trim() === label);
    const row = span?.closest<HTMLElement>('[role="button"]');
    if (!span || !row) return null;
    const box = row.getBoundingClientRect();
    return {
      left: round(box.left),
      right: round(box.right),
      width: round(box.width),
      labelX: round(span.getBoundingClientRect().left),
      sidebarX: round(sidebar.getBoundingClientRect().left),
      ariaCurrent: row.getAttribute("aria-current"),
    };
  }, text);

/** The rail hairline, the selected row's box and its 2px marker (::before), in viewport pixels. */
const measureRail = (page: Page) =>
  page.evaluate(() => {
    const round = (value: number) => Math.round(value * 100) / 100;
    const sidebar = document.querySelector<HTMLElement>('[data-testid="context-sidebar"]');
    const rail = Array.from(sidebar?.querySelectorAll<HTMLElement>('[role="group"]') ?? []).find((node) => node.getAttribute("aria-label") === "Project");
    const span = Array.from(rail?.querySelectorAll("span") ?? []).find((node) => (node.textContent ?? "").trim() === "Timeline");
    const row = span?.closest<HTMLElement>('[role="button"]');
    const group = rail?.getBoundingClientRect();
    const box = row?.getBoundingClientRect();
    const marker = row ? getComputedStyle(row, "::before") : null;
    return {
      railLeft: group ? round(group.left) : null,
      rowLeft: box ? round(box.left) : null,
      markerLeft: marker ? round(Number.parseFloat(marker.left)) : null,
      markerWidth: marker ? round(Number.parseFloat(marker.width)) : null,
      markerInk: marker?.backgroundColor ?? null,
    };
  });

async function theme(page: Page, value: "light" | "dark") {
  await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), value);
}

test("a selected child's fill spans a selected top-level row's edges", async ({ page }) => {
  // A top-level row that is selected, for the reference edges.
  await page.goto(`/rep/${REPO}/work/issues`);
  await expect(page.getByTestId("context-sidebar")).toBeVisible();
  const top = await measureRow(page, "Issues");
  expect(top).not.toBeNull();
  expect(top!.ariaCurrent).toBe("true");

  await page.goto(`/rep/${REPO}/project/timeline`);
  await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
  const child = await measureRow(page, "Timeline");
  expect(child).not.toBeNull();
  expect(child!.ariaCurrent).toBe("page");

  // The rail line and the 2px accent marker do not move: the marker still covers the hairline.
  const rail = await measureRail(page);
  // The numbers are the PR evidence: the same spec runs on both trees and the diff is the fix.
  console.log(`[rail] top=${JSON.stringify(top)} child=${JSON.stringify(child)} rail=${JSON.stringify(rail)}`);

  // The reported defect: the child's fill began at the rail, 16px right of a top-level row's fill.
  expect(Math.abs(child!.left - top!.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(child!.right - top!.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(child!.width - top!.width)).toBeLessThanOrEqual(1);

  // The label stays in the aligned column the rail defines: 8px sidebar padding + 15px rail x +
  // 1px hairline + 18px gutter = 42px from the sidebar edge, the same as a top-level label's x.
  expect(Math.abs(child!.labelX - top!.labelX)).toBeLessThanOrEqual(0.5);
  expect(child!.labelX - child!.sidebarX).toBeCloseTo(42, 0);

  expect(rail.railLeft).not.toBeNull();
  expect(rail.rowLeft).not.toBeNull();
  expect(rail.markerLeft).not.toBeNull();
  expect(rail.markerWidth).toBe(2);
  expect(rail.markerInk).not.toBe("rgba(0, 0, 0, 0)");
  expect(Math.abs(rail.rowLeft! + rail.markerLeft! - rail.railLeft!)).toBeLessThanOrEqual(1);
  // Rails and hairlines: the hairline sits at the parent icon's centre (8px + 15px into the sidebar).
  expect(rail.railLeft! - top!.sidebarX).toBeCloseTo(23, 0);
});

test("an open rail leaves the parent unselected; a collapsed one keeps the location visible", async ({ page }) => {
  await page.goto(`/rep/${REPO}/project/timeline`);
  await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
  const sidebar = page.getByTestId("context-sidebar");
  const parent = sidebar.getByRole("button", { name: /^Project/ });
  // The disclosure is a button nested in the row button, whose own name reads "Project Collapse Project".
  const disclosure = (label: "Collapse Project" | "Expand Project") => sidebar.getByRole("button", { name: label, exact: true });

  // The child row names the location; the parent still reads expanded, not selected.
  await expect(parent).not.toHaveAttribute("aria-current", "true");
  await expect(disclosure("Collapse Project")).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar.getByRole("button", { name: "Timeline" })).toHaveAttribute("aria-current", "page");

  // Collapsed, the child row is hidden: the parent takes the selection so the location stays visible.
  await disclosure("Collapse Project").click();
  await expect(sidebar.getByRole("button", { name: "Timeline" })).toHaveCount(0);
  await expect(parent).toHaveAttribute("aria-current", "true");
  await expect(disclosure("Expand Project")).toHaveAttribute("aria-expanded", "false");
});

for (const themeName of ["light", "dark"] as const) {
  test(`rail selection screenshot (${themeName})`, async ({ page }) => {
    await theme(page, themeName);
    await page.goto(`/rep/${REPO}/project/timeline`);
    await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
    const path = EXPORT_DIR
      ? join(EXPORT_DIR, `${PHASE}-${themeName}-sidebar.png`)
      : test.info().outputPath(`${themeName}-sidebar.png`);
    await page.getByTestId("context-sidebar").screenshot({ path });
    await capture(page, path);
  });
}
