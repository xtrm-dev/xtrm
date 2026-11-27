import { expect, test } from "@playwright/test";

// Shell chrome geometry (XTRM-694): the inspector stops 6 px above the viewport bottom, the Issues
// table header rounds only its top corners, and the table scrollbar starts under the header.
async function frameBottomGap(page: import("@playwright/test").Page): Promise<number> {
  return page.getByTestId("inspector-frame").evaluate((el) => Math.round(window.innerHeight - el.getBoundingClientRect().bottom));
}

test("inspector frame keeps the 6 px search-pill inset at the bottom", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("inspector-frame")).toBeVisible();

  expect(await frameBottomGap(page)).toBe(6);
  // The gap must not scale with the viewport: it mirrors the 44 px top bar centring a 32 px pill.
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await frameBottomGap(page)).toBe(6);
  await page.setViewportSize({ width: 1920, height: 1080 });
  expect(await frameBottomGap(page)).toBe(6);
});

test("the list has no header row: the first row starts at the top of the scroller", async ({ page }) => {
  await page.goto("/#/rep/xtrm-dev/xtrm/work/issues");
  await expect(page.getByRole("region", { name: "XTRM Issues" })).toBeVisible();

  // 2026-11-24 ruling: one line per item, so the column header is gone and the scroller starts at
  // the toolbar. The old 32px squared header strip (XTRM-633) has no successor to guard.
  expect(await page.getByTestId("issues-table-head").count(), "no header strip").toBe(0);
  expect(await page.getByRole("columnheader").count(), "no column headers").toBe(0);

  const first = page.locator('[role="button"]').filter({ hasText: /XTRM-\d/ }).first();
  await expect(first).toBeVisible();
  const rowTop = (await first.boundingBox())!.y;
  // The toolbar is the region's first child; the first row starts right under it.
  const toolbar = (await page.getByRole("region", { name: "XTRM Issues" }).locator(":scope > div").first().boundingBox())!;
  expect(rowTop).toBeGreaterThanOrEqual(toolbar.y + toolbar.height - 1);
});
