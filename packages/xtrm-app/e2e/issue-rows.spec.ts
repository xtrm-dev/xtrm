import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * XTRM-856 → XTRM-926: the row's anchors on real tree shapes. The disclosure sits beside its key at
 * the row's own depth; the key (the locator, then the unique ref when it differs), the status chip and
 * the title then read inline, one after the other, with no computed key column between them.
 * jsdom cannot measure, so the pixel guard lives here; the structural guard is IssueRows.test.tsx.
 */

const REPO = "xtrm-dev/xtrm";

/** The fixture's four-level MMD-shaped subtree (long locators, the operator's data shape). */
const CHAIN = [
  { ref: "XTRM-300", locator: "XTRM-300", depth: 0 },
  { ref: "XTRM-301", locator: "XTRM-300.1", depth: 1 },
  { ref: "XTRM-302", locator: "XTRM-300.1.2", depth: 2 },
  { ref: "XTRM-303", locator: "XTRM-300.1.2.1", depth: 3 },
] as const;

/** One indent level: 1.25rem at the 16px root. */
const INDENT_PX = 20;
/** The contract's tolerance: the status chip starts within 1rem of the key text's end. */
const MAX_KEY_TO_CHIP_PX = 16;
/** The key column the pre-XTRM-926 row computed (`KEY_COL_MAX_REM`, 15.5rem), for the negative control. */
const OLD_KEY_COL_MAX_PX = 15.5 * 16;

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

/** The rect of an element; text runs report their own box, so a truncated run stays measurable. */
function rect(locator: Locator) {
  return locator.evaluate((el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x, width: b.width, right: b.right };
  });
}

/** Horizontal distance from the end of the key's text to the start of its status chip. */
async function keyToChipGap(row: Locator) {
  const key = await rect(row.locator("[data-key-text]").first());
  const chip = await rect(row.locator('[data-slot="badge"]').first());
  return chip.x - key.right;
}

test("the row reads key, unique ref, status chip and title inline at every depth", async ({ page }) => {
  await openIssues(page);
  const chips: number[] = [];

  for (const { ref, locator, depth } of CHAIN) {
    const row = rowFor(page, ref);
    await expect(row, `${ref} is rendered`).toBeVisible();
    const rowBox = await box(row);
    const leading = row.locator("[data-row-leading]").first();
    const chevron = await box(leading.locator(":scope > *").first());
    const keyCell = await box(row.locator("[data-key-cell]").first());
    const chip = await box(row.locator('[data-slot="badge"]').first());

    // The leading cluster carries the row's own depth: 8px cell padding + depth × 20px.
    expect(chevron.x - rowBox.x, `${ref} indents by its own depth`).toBeCloseTo(8 + depth * INDENT_PX, 0);
    expect(await leading.evaluate((el) => getComputedStyle(el).paddingLeft), `${ref} depth is a padding, not a gutter`).toBe(`${depth * INDENT_PX}px`);
    // No list-wide gutter: the key starts right after the disclosure itself.
    const chevronToKey = keyCell.x - (chevron.x + chevron.width);
    expect(chevronToKey, `${ref} keeps the key beside its disclosure`).toBeGreaterThanOrEqual(0);
    expect(chevronToKey, `${ref} keeps the key beside its disclosure`).toBeLessThanOrEqual(8);

    // The unique ref rides beside the locator, in the same cell, whenever it differs.
    const keyText = (await row.locator("[data-key-text]").first().innerText()).trim().replace(/\s+/g, " ");
    expect(keyText, `${ref} reads locator then unique ref`).toBe(locator === ref ? ref : `${locator} / ${ref}`);
    const alias = row.locator("[data-key-text] .text-ink-faint");
    if (locator === ref) await expect(alias, `${ref} has no alias to add`).toHaveCount(0);
    else await expect(alias, `${ref} shows the alias beside the locator`).toHaveText(`/ ${ref}`);

    // The key, the chip and the title flow inline: one small gap, no column between them.
    const gap = await keyToChipGap(row);
    expect(gap, `${ref} keeps the chip within 1rem of its key`).toBeGreaterThanOrEqual(0);
    expect(gap, `${ref} keeps the chip within 1rem of its key`).toBeLessThanOrEqual(MAX_KEY_TO_CHIP_PX);

    const title = await rect(row.locator("span.flex-1.truncate").first());
    const chipToTitle = title.x - (chip.x + chip.width);
    expect(chipToTitle, `${ref} keeps the title within 1rem of its chip`).toBeGreaterThanOrEqual(0);
    expect(chipToTitle, `${ref} keeps the title within 1rem of its chip`).toBeLessThanOrEqual(MAX_KEY_TO_CHIP_PX);
    chips.push(chip.x);
  }

  // The old layout moved every chip onto one x by computing a key column; inline flow lets the chip
  // follow its own key, so a deeper row (a longer locator, one indent further) starts further right.
  expect(chips[3], "the chip follows its key instead of a fixed column").toBeGreaterThan(chips[0]!);

  // No key column survives anywhere: header or row.
  const head = page.getByTestId("issues-table-head");
  expect(await head.evaluate((el) => getComputedStyle(el).getPropertyValue("--key-col")), "the header computes no key column").toBe("");
});

test("the title takes the remaining width and truncates", async ({ page }) => {
  await openIssues(page);
  const head = page.getByTestId("issues-table-head");
  const childrenX = await head.getByRole("columnheader", { name: "Children" }).evaluate((el) => el.getBoundingClientRect().x);
  const row = rowFor(page, "XTRM-303");
  await expect(row).toBeVisible();
  const line = row.locator("[data-row-leading]").first().locator("..");
  const cell = await line.evaluate((el) => el.getBoundingClientRect());
  expect(childrenX - cell.x, "the reading column keeps at least 20rem at 1440px").toBeGreaterThanOrEqual(320);
  expect(await line.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("8px");
  expect(await line.evaluate((el) => getComputedStyle(el).getPropertyValue("--key-col")), "the row computes no key column").toBe("");

  // The title run stops at the cell's own 8px edge padding, not 100px short of it.
  const title = await rect(row.locator("span.flex-1.truncate").first());
  expect(childrenX - title.right, "the title fills its cell up to the next column").toBeLessThan(12);
  expect(title.width, "the title keeps a readable width").toBeGreaterThan(180);

  // XTRM-911's guard, restored: the widest unclipped title must reach 45 characters at 1440.
  const widest = await page.locator('[role="button"]').evaluateAll((rows) => {
    let best = 0;
    for (const r of rows) {
      const run = r.querySelector("span.flex-1.truncate") as HTMLElement | null;
      const text = run?.querySelector("span[title]")?.textContent ?? "";
      if (run && run.scrollWidth <= run.clientWidth + 1) best = Math.max(best, text.length);
    }
    return best;
  });
  expect(widest, "a 45-character title fits the 1440px list").toBeGreaterThanOrEqual(45);

  // The key stays inside the reading column and is not clipped at this width.
  const key = await rect(row.locator("[data-key-text]").first());
  expect(key.right, "the key ends before its chip").toBeLessThan(title.x);
  expect(
    await row.locator("[data-key-text]").first().evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    "the deepest key is not truncated at 1440",
  ).toBe(true);

  // Header and rows agree on the column set after a width-dependent drop.
  const headers = await head.getByRole("columnheader").count();
  expect(await row.locator("[data-column]").count(), "every visible numeric column has its row cell").toBe(headers - 1);
});

test("the numeric columns and the one row action keep their places", async ({ page }) => {
  const rows = await openIssues(page);
  const row = rows.first();
  const copy = row.getByRole("button", { name: /^Copy / });
  const rowBox = await box(row);
  const copyBox = await box(copy);
  expect(rowBox.x + rowBox.width - (copyBox.x + copyBox.width), "the action hugs the row end").toBeLessThanOrEqual(12);

  const head = page.getByTestId("issues-table-head");
  for (const [index, label] of ["Children", "Events", "Pointers", "PR", "Created", "Updated"].entries()) {
    const header = await box(head.getByRole("columnheader", { name: label }));
    expect(header.x + header.width, `${label} stays in the trailing numeric block`).toBeLessThanOrEqual(rowBox.x + rowBox.width);
    expect(header.width, `${label} keeps its narrow column`).toBeLessThanOrEqual(6 * 16);
    if (index === 0) expect(header.x, "the numerics start after the reading column").toBeGreaterThan(rowBox.x + rowBox.width / 2);
  }

  // At rest the invisible action takes no pointer events, so a click there belongs to the row.
  const reveal = copy.locator("..");
  expect(await reveal.evaluate((el) => getComputedStyle(el).pointerEvents), "the hidden action is not clickable at rest").toBe("none");
  await row.hover();
  expect(await reveal.evaluate((el) => getComputedStyle(el).pointerEvents), "hover gives the action its clicks back").toBe("auto");
});

/**
 * XTRM-926 negative control: the pre-fix row (a computed key column, the unique ref hidden) must FAIL
 * the inline assertion, or the assertion proves nothing about the layout it replaced. The old
 * mechanism is reproduced on the live row: the key cell takes the capped column width less the row's
 * own depth, and the alias goes back into the tooltip.
 */
test("negative control: the old key-column row fails the inline assertion", async ({ page }) => {
  await openIssues(page);
  const row = rowFor(page, "XTRM-303");
  await expect(row).toBeVisible();
  const depth = 3;

  await row.locator("[data-key-cell]").first().evaluate((el, width) => {
    (el as HTMLElement).style.width = `${width}px`;
    el.querySelector("[data-key-text] .text-ink-faint")?.remove();
  }, OLD_KEY_COL_MAX_PX - depth * INDENT_PX);

  await expect(row.locator("[data-key-text] .text-ink-faint"), "the old row hid the unique ref").toHaveCount(0);
  expect(await keyToChipGap(row), "the old column pushes the chip off its key").toBeGreaterThan(MAX_KEY_TO_CHIP_PX);
});

for (const width of [700, 640] as const) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    /**
     * The key is the row's address: it keeps its natural width (`shrink-0`) and the title shrinks
     * first. With the rail expanded a narrow list cannot hold key + chip + title, so the reading cell
     * clips them instead of letting them paint over the numeric columns; with the rail collapsed
     * there is room, and the deepest key must read whole.
     */
    test(`the deepest key stays whole and clear of its chip (${width}px)`, async ({ page }) => {
      await openIssues(page);
      const row = rowFor(page, "XTRM-303");
      await expect(row).toBeVisible();

      // Expanded rail: the reading cell contains its content. Probe a numeric column over the row
      // line: a badge or a key glyph painted there would answer instead of the column cell.
      const childrenX = await page.getByTestId("issues-table-head").getByRole("columnheader", { name: "Children" }).evaluate((el) => el.getBoundingClientRect().x);
      const rowBox = await box(row);
      const hit = await page.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        const cell = el?.closest("[data-column]");
        return { column: cell?.getAttribute("data-column") ?? null, tag: el?.tagName ?? null, text: (el?.textContent ?? "").slice(0, 40) };
      }, { x: childrenX + 20, y: rowBox.y + rowBox.height / 2 });
      expect(hit.column, `${width}px: the reading line does not paint over the numeric columns`).not.toBeNull();

      // Collapsed rail (the console's own control): key + chip + title fit, so nothing may clip.
      await page.getByRole("button", { name: /ollapse sidebar/ }).click();
      await expect(row).toBeVisible();
      const key = row.locator("[data-key-text]").first();
      expect(await key.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), `${width}px: the deepest key is not clipped`).toBe(true);
      const keyBox = await rect(key);
      const chipBox = await box(row.locator('[data-slot="badge"]').first());
      expect(chipBox.x - keyBox.right, `${width}px: the chip does not sit on the key`).toBeGreaterThanOrEqual(0);
      expect(chipBox.x - keyBox.right, `${width}px: the chip stays beside the key`).toBeLessThanOrEqual(MAX_KEY_TO_CHIP_PX);
      expect(chipBox.x + chipBox.width, `${width}px: the chip stays inside the reading column`).toBeLessThan(childrenX);

      // The title gives up its width first, and never starts before the chip ends.
      const title = await rect(row.locator("span.flex-1.truncate").first());
      expect(title.x, `${width}px: the title starts after the chip`).toBeGreaterThanOrEqual(chipBox.x + chipBox.width);
      expect(await row.evaluate((el) => getComputedStyle(el).getPropertyValue("--key-col")), `${width}px: no key column`).toBe("");
    });
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`the MMD-shaped tree renders in ${theme}`, async ({ page }, testInfo) => {
    await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), theme);
    await openIssues(page);
    await expect(rowFor(page, "XTRM-303")).toBeVisible();
    // Into the run's --output dir, so a local run never rewrites the tracked evidence set.
    await page.screenshot({ path: testInfo.outputPath(`xtrm-926-${theme}-issue-inline.png`) });
  });
}
