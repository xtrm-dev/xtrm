import { expect, test, type Page } from "@playwright/test";

/**
 * XTRM-856: the row's three anchors — key, status chip, title — must start at one x for every
 * depth, the title must fill the cell it owns, and the single row action must sit at the row end.
 * jsdom cannot measure, so the pixel guard lives here; the structural guard is IssueRows.test.tsx.
 */

const REPO = "xtrm-dev/xtrm";

async function openIssues(page: Page) {
  await page.goto(`/rep/${REPO}/work/issues`);
  await expect(page.getByRole("region", { name: "XTRM Issues" })).toBeVisible();
  const rows = page.locator('[role="button"]').filter({ hasText: /XTRM-\d/ });
  await expect(rows.first()).toBeVisible();
  return rows;
}

test("key, status chip and title start at one x for a top-level row and a child row", async ({ page }) => {
  const rows = await openIssues(page);
  const top = rows.first();
  const child = rows.filter({ hasText: /XTRM-\d+\.\d+/ }).first();
  await expect(child).toBeVisible();

  const chipLeft = async (row: typeof top) => (await row.locator('[data-slot="badge"]').first().boundingBox())!.x;
  const titleLeft = async (row: typeof top) => (await row.locator("span.truncate > span[title]").first().boundingBox())!.x;
  const keyLeft = async (row: typeof top) => (await row.locator("span[style*='--key-col']").first().boundingBox())!.x;

  // One x for key, chip and title, whatever the depth: indentation lives in the fixed gutter.
  for (const [name, read] of [
    ["key", keyLeft],
    ["status chip", chipLeft],
    ["title", titleLeft],
  ] as const) {
    const [a, b] = [await read(top), await read(child)];
    expect(Math.abs(a - b), `${name} left edge must match across depths (${a} vs ${b})`).toBeLessThanOrEqual(1);
  }
});

test("the title fills its cell and the one action sits at the row end", async ({ page }) => {
  const rows = await openIssues(page);
  const row = rows.first();

  const titleBox = (await row.locator("span.truncate").first().boundingBox())!;
  const childrenHeader = (await page.getByTestId("issues-table-head").getByRole("columnheader", { name: "Children" }).boundingBox())!;
  // The title cell ends where the Children column begins, so the text may only stop within the
  // cell's own gap (8px edge padding plus the 6px flex gap) — not 100px short of it.
  const titleRight = titleBox.x + titleBox.width;
  expect(childrenHeader.x - titleRight, "title fills its cell up to the next column").toBeLessThan(44);
  expect(titleBox.width, "the title keeps a readable width").toBeGreaterThan(180);

  const rowBox = (await row.boundingBox())!;
  const copy = (await row.getByRole("button", { name: /^Copy / }).boundingBox())!;
  const copyRight = copy.x + copy.width;
  expect(rowBox.x + rowBox.width - copyRight, "the action hugs the row end").toBeLessThanOrEqual(12);
  // And it is not floating after the title: the measured columns sit between them.
  expect(copy.x).toBeGreaterThan(titleRight + 100);

  // At rest the invisible action takes no pointer events, so a click there belongs to the row.
  const reveal = row.getByRole("button", { name: /^Copy / }).locator("..");
  const restPointer = await reveal.evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(restPointer, "the hidden action is not clickable at rest").toBe("none");
  await row.hover();
  const hoverPointer = await reveal.evaluate((el) => getComputedStyle(el).pointerEvents);
  expect(hoverPointer, "hover gives the action its clicks back").toBe("auto");
});
