import { expect, test } from "@playwright/test";

// XTRM-948: the label column is one step, so every field grid on a page starts its value at the same
// x. jsdom does not resolve rem to px, so the jsdom guard in src/app/research.test.tsx pins the
// DECLARED step (`10rem`); this spec pins the RENDERED pitch that step produces — 10rem column plus
// the primitive's 0.75rem gutter = 172px — which is the number the census measured and which the old
// 8rem manifest column moved to 140px and the default 7.5rem to 132px.

const COLUMN = 10;
const GUTTER = 0.75;
const PITCH = (COLUMN + GUTTER) * 16; // 172

/** The x of a value's first text box, off the field grid it belongs to. */
async function valueX(page: import("@playwright/test").Page, label: string): Promise<number> {
  const dd = page.locator(`dl dt:text-is("${label}") + dd`).first();
  return (await dd.boundingBox())!.x;
}

test("every field grid on the run page starts its value at the same x", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/research/runs/run-a");
  await expect(page.getByText("Manifest & versions")).toBeVisible();

  // Three grids render here: Hypothesis, Method and Manifest & versions — the last is the one that
  // used to carry 8rem, and the only one that could disagree.
  const xs = await Promise.all(["Hypothesis", "Dataset", "Experiment"].map((label) => valueX(page, label)));
  expect(new Set(xs).size, "one label column: 10rem + 0.75rem gutter, not three opinions").toBe(1);

  // The absolute pitch, measured rather than derived from the class.
  const dl = page.locator('dl:has(dt:text-is("Experiment"))').first();
  const dlX = (await dl.boundingBox())!.x;
  const padLeft = await dl.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingLeft));
  expect(xs[2] - dlX - padLeft, "10rem column + 0.75rem gutter").toBeGreaterThanOrEqual(PITCH - 1);
  expect(xs[2] - dlX - padLeft).toBeLessThanOrEqual(PITCH + 1);
});
