import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * XTRM-955: the declared-charts list item and the chart card render the same string, so they must
 * compute the same treatment. The card at research-charts.tsx:142 is the reference; the list item at
 * ResearchSurface.tsx:209 moves to it.
 *
 * Weight is asserted directly per site, because a shared assertion would stay green while one site
 * drifted. Size and ink are asserted as a relation between the two sites, never as literals: a
 * computed number is true at one tree, not in general (XTRM-940 seq 15).
 */

const TITLE = "Accuracy by run";
/** This experiment has runs, so the Declared charts region renders chart cards. */
const CARD_PAGE = "/research/experiments/dup-detect-baseline";
/** This experiment has declarations but no runs, so the same region renders the plain list. */
const LIST_PAGE = "/research/experiments/zero-run-baseline";

type Treatment = { text: string | null; weight: string; size: string; color: string };

async function treatment(el: Locator): Promise<Treatment> {
  return el.evaluate((node) => {
    const s = getComputedStyle(node as HTMLElement);
    return { text: node.textContent, weight: s.fontWeight, size: s.fontSize, color: s.color };
  });
}

async function cardTitle(page: Page): Promise<Locator> {
  await page.goto(CARD_PAGE);
  const el = page.getByRole("article", { name: TITLE }).locator("p").first();
  await expect(el).toHaveText(TITLE);
  return el;
}

async function listedTitle(page: Page): Promise<Locator> {
  await page.goto(LIST_PAGE);
  const region = page.locator('section[aria-label="Declared charts"]');
  await expect(region.getByText(TITLE)).toHaveText(TITLE);
  const el = region.locator("> div.divide-y > div").first().locator("p").first();
  await expect(el).toHaveText(TITLE);
  return el;
}

test("the declared-charts list item titles at the card's weight", async ({ page }) => {
  const listed = await treatment(await listedTitle(page));
  expect(listed.weight).toBe("500");
});

test("the chart card titles at that same weight", async ({ page }) => {
  const card = await treatment(await cardTitle(page));
  expect(card.weight).toBe("500");
});

test("both renderings of a chart title compute one size and one ink", async ({ page }) => {
  const card = await treatment(await cardTitle(page));
  const listed = await treatment(await listedTitle(page));
  expect(listed.size).toBe(card.size);
  expect(listed.color).toBe(card.color);
  expect(listed.weight).toBe(card.weight);
});
