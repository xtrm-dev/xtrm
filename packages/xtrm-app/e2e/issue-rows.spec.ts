import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * XTRM-856 → XTRM-898: the row's anchors on real tree shapes. The disclosure sits beside its key
 * at the row's own depth, the key cell gives the depth back, so the status chip and the title keep
 * one x for every depth, and the key column is sized from the primary locator alone.
 * jsdom cannot measure, so the pixel guard lives here; the structural guard is IssueRows.test.tsx.
 */

const REPO = "xtrm-dev/xtrm";
const OUT = "docs/screenshots/issue-rows";

/** The fixture's four-level MMD-shaped subtree (long locators, the operator's data shape). */
const CHAIN = [
  { ref: "XTRM-300", depth: 0 },
  { ref: "XTRM-301", depth: 1 },
  { ref: "XTRM-302", depth: 2 },
  { ref: "XTRM-303", depth: 3 },
] as const;

/** One indent level: 1.25rem at the 16px root. */
const INDENT_PX = 20;
/** Kind icon, priority glyph, their gaps and the key cell's trailing inset: `KEY_CELL_CHROME_REM` (2.6rem). */
const KEY_CELL_CHROME_PX = 2.6 * 16;

async function openIssues(page: Page) {
  await page.goto(`/rep/${REPO}/work/issues`);
  await expect(page.getByRole("region", { name: "XTRM Issues" })).toBeVisible();
  const rows = page.locator('[role="button"]').filter({ hasText: /XTRM-\d/ });
  await expect(rows.first()).toBeVisible();
  return rows;
}

/** The row that owns this ref, resolved through its own copy action rather than the rendered text. */
function rowFor(page: Page, ref: string): Locator {
  return page.locator('[role="button"]').filter({ has: page.getByRole("button", { name: `Copy ${ref}` }) });
}

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b, "the element has a layout box").not.toBeNull();
  return b!;
}

test("the disclosure sits beside its key at each depth, and the chip and the title keep one x", async ({ page }) => {
  await openIssues(page);
  const anchors: Array<{ ref: string; depth: number; chip: number; title: number }> = [];

  for (const { ref, depth } of CHAIN) {
    const row = rowFor(page, ref);
    await expect(row, `${ref} is rendered`).toBeVisible();
    const rowBox = await box(row);
    const leading = row.locator("[data-row-leading]").first();
    const leadingBox = await box(leading);
    const chevron = await box(leading.locator(":scope > *").first());
    const keyCell = await box(row.locator("[data-key-cell]").first());
    const chip = await box(row.locator('[data-slot="badge"]').first());
    const title = await row
      .locator("span.flex-1.truncate")
      .first()
      .evaluate((el) => el.getBoundingClientRect().x);

    // The leading cluster carries the row's own depth: 8px cell padding + depth × 20px. The
    // disclosure sits in a 20px slot, so the whole slot — button or spacer — starts there.
    expect(chevron.x - rowBox.x, `${ref} indents by its own depth`).toBeCloseTo(8 + depth * INDENT_PX, 0);
    expect(await leading.evaluate((el) => getComputedStyle(el).paddingLeft), `${ref} depth is a padding, not a gutter`).toBe(`${depth * INDENT_PX}px`);
    // No list-wide gutter: the key cell starts right after the disclosure slot, never behind it.
    const chevronToKey = keyCell.x - (leadingBox.x + leadingBox.width);
    expect(chevronToKey, `${ref} keeps the key beside its disclosure`).toBeGreaterThanOrEqual(0);
    expect(chevronToKey, `${ref} keeps the key beside its disclosure`).toBeLessThanOrEqual(8);

    // The list shows the primary locator alone; the alias stays in the key cell's tooltip.
    const cellText = (await row.locator("[data-key-cell]").first().innerText()).trim();
    await expect(row.locator("[data-key-cell]").first()).toHaveAttribute("title", cellText === ref ? ref : `${cellText} / ${ref}`);
    anchors.push({ ref, depth, chip: chip.x, title });
  }

  for (const a of anchors.slice(1)) {
    expect(Math.abs(a.chip - anchors[0].chip), `chip x at depth ${a.depth}`).toBeLessThanOrEqual(1);
    expect(Math.abs(a.title - anchors[0].title), `title x at depth ${a.depth}`).toBeLessThanOrEqual(1);
  }
});

test("the key column fits the longest primary locator plus the depth indent, and the title fills its cell", async ({ page }) => {
  const rows = await openIssues(page);
  const deepest = rowFor(page, "XTRM-303");
  await expect(deepest).toBeVisible();
  const deepestCell = await box(deepest.locator("[data-key-cell]").first());
  const longestKey = deepest.locator("[data-key-cell] span.truncate").first();
  const longestText = await box(longestKey);

  // The longest primary locator is not clipped: its text box fits the key cell.
  expect(await longestKey.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), "the deepest key is not truncated").toBe(true);
  // Budget: the primary locator + the depth indent + the in-cell glyph chrome; the alias adds nothing.
  expect(deepestCell.width, "the key column is the primary locator plus the glyph chrome").toBeLessThanOrEqual(longestText.width + KEY_CELL_CHROME_PX + 8);
  const topCell = await box(rowFor(page, "XTRM-300").locator("[data-key-cell]").first());
  expect(topCell.width, "the depth indent is inside the key column budget").toBeLessThanOrEqual(longestText.width + (CHAIN.length - 1) * INDENT_PX + KEY_CELL_CHROME_PX + 8);

  const row = rows.first();
  // getBoundingClientRect, not boundingBox: the latter reports the text run for a truncated flex item.
  const titleBox = await row
    .locator("span.flex-1.truncate")
    .first()
    .evaluate((el) => {
      const b = el.getBoundingClientRect();
      return { x: b.x, width: b.width };
    });
  const childrenHeader = await page
    .getByTestId("issues-table-head")
    .getByRole("columnheader", { name: "Children" })
    .evaluate((el) => el.getBoundingClientRect().x);
  // The title cell ends where the Children column begins, so the text may only stop within the
  // cell's own 8px edge padding — not 100px short of it.
  expect(childrenHeader - (titleBox.x + titleBox.width), "title fills its cell up to the next column").toBeLessThan(12);
  expect(titleBox.width, "the title keeps a readable width").toBeGreaterThan(180);
});

test("the one row action sits at the row end, hidden at rest", async ({ page }) => {
  const rows = await openIssues(page);
  const row = rows.first();
  const copy = row.getByRole("button", { name: /^Copy / });
  const rowBox = await box(row);
  const copyBox = await box(copy);
  expect(rowBox.x + rowBox.width - (copyBox.x + copyBox.width), "the action hugs the row end").toBeLessThanOrEqual(12);

  // At rest the invisible action takes no pointer events, so a click there belongs to the row.
  const reveal = copy.locator("..");
  expect(await reveal.evaluate((el) => getComputedStyle(el).pointerEvents), "the hidden action is not clickable at rest").toBe("none");
  await row.hover();
  expect(await reveal.evaluate((el) => getComputedStyle(el).pointerEvents), "hover gives the action its clicks back").toBe("auto");
});

for (const theme of ["light", "dark"] as const) {
  test(`the MMD-shaped tree renders in ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), theme);
    await openIssues(page);
    await expect(rowFor(page, "XTRM-303")).toBeVisible();
    await page.screenshot({ path: `${OUT}/xtrm-898-${theme}-deep-rows.png` });
  });
}
