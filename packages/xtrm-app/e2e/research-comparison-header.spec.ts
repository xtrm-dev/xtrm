import { expect, test, type Page } from "@playwright/test";

/**
 * XTRM-950, browser half. The comparison grid is a fixed `h-8` header row over `min-h-8` metric rows,
 * and both header cells hold a run id whose track is `minmax(0, 1.2fr)` — narrower than a long id.
 * A wrapped id makes the cell 40, 56 or 88px tall inside a row that stays 32px, so the first metric
 * row is painted over the header (measured before the fix at 900px: row 32, cell 56).
 *
 * The clipping is therefore a ROW property, and this is where that claim can be measured: jsdom
 * resolves no layout, so the assertion in `src/app/research.test.tsx` can only reach the classes.
 * `src/app/research.test.tsx` carries the id-in-title case; this spec carries the geometry.
 */

const LONG = "run-2026-09-16-dup-detect-baseline-replay-with-a-long-slug";
const ROW_HEIGHT = 32; // the console's list row, and this header's fixed height

/** Replace both header run ids with a long one, the way a real run id would arrive.
 * The first cell is the `Metric` column label, which is not an id and does not truncate — injecting
 * there measures the label wrapping, not the defect. Only the id cells (`run-a`, `run-b`) are ids. */
async function withLongIds(page: Page) {
  await page.goto("/research/compare?baseline=run-a&candidate=run-b");
  await expect(page.getByRole("table", { name: "Metric comparison" })).toBeVisible();
  await page.evaluate((id) => {
    const row = document.querySelector('[role="table"] [role="row"]')!;
    const cells = Array.from(row.querySelectorAll('[role="columnheader"]')) as HTMLElement[];
    for (const cell of cells.filter((c) => /^run-[ab]/.test((c.textContent ?? "").trim()))) {
      (cell.querySelector("span") ?? cell).textContent = id;
    }
  }, LONG);
}

for (const width of [1440, 900, 520]) {
  test(`the comparison header holds a long run id without moving the table (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await withLongIds(page);

    const measured = await page.evaluate(() => {
      const table = document.querySelector('[role="table"]')!;
      const [header, firstMetric] = Array.from(table.querySelectorAll('[role="row"]')) as HTMLElement[];
      const cells = Array.from(header!.querySelectorAll('[role="columnheader"]')) as HTMLElement[];
      return {
        rowHeight: Math.round(header!.getBoundingClientRect().height),
        idCellHeights: cells
          .filter((c) => /^run-/.test((c.textContent ?? "").trim()))
          .map((c) => Math.round(c.getBoundingClientRect().height)),
        // Two separate defences, measured separately: `truncate` on the value stops it growing, and
        // the row's `overflow-hidden` stops anything that does grow from painting over the next row.
        rowOverflow: getComputedStyle(header!).overflow,
        // No overlap: the first metric row starts at or below where the header ends.
        gap: Math.round(firstMetric!.getBoundingClientRect().top - header!.getBoundingClientRect().bottom),
      };
    });

    // The row is what clips, so it keeps its height while the ids are long.
    expect(measured.rowHeight, "the header row is the console's 32px list row").toBe(ROW_HEIGHT);
    // And the id cells do not grow — this is the number the defect moved: 40 at 1440px, 56 at 900px,
    // 88 at 520px, all measured before `truncate` reached the baseline header.
    expect(
      measured.idCellHeights.length,
      "both run ids are header cells on this route",
    ).toBe(2);
    expect(
      measured.idCellHeights.every((h) => h <= ROW_HEIGHT),
      `id cells stay inside the row: ${measured.idCellHeights.join(", ")}`,
    ).toBe(true);
    // Growth is prevented by `truncate`; the paint-over is prevented here.
    expect(measured.rowOverflow, "the fixed-height row clips anything taller than itself").toBe("hidden");
    // The table below is not pushed or covered.
    expect(measured.gap, "the first metric row is not painted over").toBeGreaterThanOrEqual(0);
  });
}
