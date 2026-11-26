import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The one-line issue row (2026-11-24 ruling): no column grid, no header, one 36px reading line per
 * issue — the same height as a sidebar row. The key is a tinted chip, the state a solid chip, and the
 * rollups sit at the right edge. jsdom cannot measure, so the pixel guard lives here; the structural
 * guard is `IssueRows.test.tsx`.
 */

const REPO = "xtrm-dev/xtrm";

/** The fixture's four-level MMD-shaped subtree (long locators, the operator's data shape). */
const CHAIN = [
  { ref: "XTRM-300", locator: "XTRM-300", depth: 0 },
  { ref: "XTRM-301", locator: "XTRM-300.1", depth: 1 },
  { ref: "XTRM-302", locator: "XTRM-300.1.2", depth: 2 },
  { ref: "XTRM-303", locator: "XTRM-300.1.2.1", depth: 3 },
] as const;

/** One indent level: 1.25rem at the 16px root, plus the row's own 12px padding. */
const ROW_PAD_PX = 12;
const INDENT_PX = 20;
/** `--x-row`: the one row height the sidebar and every list share. */
const ROW_PX = 32;

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

function rect(locator: Locator) {
  return locator.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x, width: b.width, right: b.right };
  });
}

test("every row is one 32px line, indented by its own depth, with no header", async ({ page }) => {
  await openIssues(page);

  // The column table is gone: no header, no column cells, no computed key column.
  expect(await page.getByTestId("issues-table-head").count(), "no header row").toBe(0);
  expect(await page.getByRole("columnheader").count(), "no column headers").toBe(0);

  for (const { ref, locator, depth } of CHAIN) {
    const row = rowFor(page, ref);
    await expect(row, `${ref} is rendered`).toBeVisible();
    const rowBox = await box(row);
    expect(Math.round(rowBox.height), `${ref} is one 32px line`).toBe(ROW_PX);

    // The leading cluster carries the row's own depth; there is no list-wide gutter.
    const line = row.locator("div").first();
    expect(await line.evaluate((el) => getComputedStyle(el).paddingLeft), `${ref} indents by its own depth`).toBe(`${ROW_PAD_PX + depth * INDENT_PX}px`);

    // The key is a dim address: the locator in mono, the unique ref in the tooltip, no fill.
    const key = row.locator("[data-key-cell]").first();
    expect((await key.innerText()).trim()).toBe(locator);
    const keyText = key.locator(":scope > span").first();
    expect(await keyText.getAttribute("title")).toBe(locator === ref ? ref : `${locator} / ${ref}`);
    expect(await keyText.evaluate((el) => getComputedStyle(el).backgroundColor), "the key carries no fill").toBe("rgba(0, 0, 0, 0)");
    expect(await keyText.evaluate((el) => getComputedStyle(el).fontFamily), "the key is mono").toContain("mono");

    // Rows carry no rule: separation is spacing and the hover fill alone (2026-11-24 follow-up).
    expect(await row.evaluate((el) => getComputedStyle(el).borderBottomWidth), `${ref} draws no divider`).toBe("0px");
  }
});

test("the solid status chip carries white ink on a filled tone", async ({ page }) => {
  await openIssues(page);
  const chip = rowFor(page, "XTRM-301").locator('[data-slot="badge"]').first();
  await expect(chip).toBeVisible();
  const measured = await chip.evaluate((el) => {
    const s = getComputedStyle(el);
    return { fill: s.backgroundColor, ink: s.color, radius: s.borderTopLeftRadius, height: s.height };
  });
  expect(measured.fill, "the chip is filled, not a wash").not.toBe("rgba(0, 0, 0, 0)");
  expect(measured.ink, "the ink is pure white").toBe("rgb(255, 255, 255)");
  expect(parseFloat(measured.radius), "the chip is a pill").toBeGreaterThanOrEqual(parseFloat(measured.height) / 2 - 0.5);
});

test("the sidebar row and the list row are the same height", async ({ page }) => {
  await openIssues(page);
  const listRow = await box(rowFor(page, "XTRM-300"));
  const navRow = await box(page.getByRole("button", { name: /^Work$/ }).first());
  const switcher = await box(page.getByTestId("half-switch"));
  expect(Math.round(listRow.height)).toBe(ROW_PX);
  expect(Math.round(switcher.height), "the Work/Agent switcher matches its rows").toBe(ROW_PX);
  expect(Math.round(navRow.height), "a sidebar row matches the list row").toBe(ROW_PX);
});

test("the title truncates; the rollups stay inside the row", async ({ page }) => {
  await openIssues(page);
  const row = rowFor(page, "XTRM-303");
  const rowBox = await box(row);
  const title = await rect(row.locator("span.truncate").first());
  expect(title.width, "the title keeps a readable width at 1440").toBeGreaterThan(180);

  const cluster = row.locator("span.truncate").first().locator("..").locator(":scope > span").last();
  const clusterBox = await box(cluster);
  expect(clusterBox.x + clusterBox.width, "the cluster ends inside the row").toBeLessThanOrEqual(rowBox.x + rowBox.width - 8);
  expect(title.right, "the title stops before the cluster").toBeLessThanOrEqual(clusterBox.x + 1);

  // Nothing is dropped by width: the rollups are in the DOM and visible at 1440.
  for (const stat of ["work", "activity", "external"]) {
    expect(await row.locator(`[data-stat="${stat}"]`).count(), `${stat} rollup renders`).toBe(1);
  }
});

test("at 900px the two widest rollups hide and nothing leaves the DOM", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await openIssues(page);
  const row = rowFor(page, "XTRM-394");
  const visible = async (stat: string) => row.locator(`[data-stat="${stat}"]`).first().isVisible();
  expect(await row.locator('[data-stat="activity"]').count(), "the events rollup stays in the DOM").toBe(1);
  expect(await visible("activity"), "the events rollup hides on a narrow surface").toBe(false);
  expect(await visible("external"), "the pointers rollup hides on a narrow surface").toBe(false);
  expect(await visible("work"), "the children rollup survives").toBe(true);
});

for (const theme of ["light", "dark"] as const) {
  test(`the one-line list renders in ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), theme);
    await openIssues(page);
    await expect(rowFor(page, "XTRM-303")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`one-line-issues-${theme}.png`) });
  });
}
