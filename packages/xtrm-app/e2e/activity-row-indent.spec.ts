import { expect, test } from "@playwright/test";

// XTRM-947: the expanded row body is one step in from the row's gutter, and the refs cluster is
// capped by a scale step rather than an arbitrary rem literal.
//
// The indent is a rendered fact, not a class name: jsdom does no layout, so nothing under src/ can
// see it. Before this spec, reverting the body to `px-6` (24px) and the refs cap to `max-w-[16rem]`
// left the whole src/surfaces suite green — measured, not assumed — so the change had no guard at
// all. `pl-5` is the spacing scale's 1.25rem, the same step the tree indent uses; `max-w-64` is a
// token substitution for `max-w-[16rem]` with an IDENTICAL rendered width (256px either way), so
// the cap assertion below pins the value and cannot distinguish the two spellings. The indent
// assertion is the one that would have failed.

// The indent is 1.25rem, so it is asserted at TWO roots. A guard that pins 20px only passes a
// `pl-[20px]` indent — the exact defect the units gate refuses — because at a 16px root a rem step
// and a px literal are the same number. At a 12px root they are not (15 vs 20), so the pair
// distinguishes "one rem step" from "16px arithmetic" (XTRM-947 review, finding 5).
const ROOTS = [16, 12];
const STEP_REM = 1.25; // pl-5 / the console's one indent step (INDENT_REM = 1.25rem)
const REFS_CAP_REM = 16; // max-w-64 == max-w-[16rem] == 256px

async function setRoot(page: import("@playwright/test").Page, size: number) {
  await page.evaluate((rem) => {
    document.documentElement.style.fontSize = `${rem}px`;
  }, size);
  await page.waitForTimeout(100);
}

test("the expanded row body sits one 1.25rem step in from its row", async ({ page }) => {
  await page.goto("/rep/xtrm-dev/xtrm/code/activity");
  const feed = page.getByRole("list", { name: /activity feed/i });
  await expect(feed).toBeVisible();

  // Open the first row: the accordion is the only path to the body.
  // The body opens from the row's own disclosure (the row click inspects instead), so the first row
  // that HAS a body is the one under test.
  const listItem = feed.locator("> li").filter({ has: page.getByTestId("activity-expand") }).first();
  await listItem.getByTestId("activity-expand").click();
  const body = listItem.getByTestId("activity-body");
  await expect(body).toBeVisible();

  // Measured at each root, so the number and the step cannot be confused.
  for (const root of ROOTS) {
    await setRoot(page, root);
    const step = STEP_REM * root;

    const liBox = (await listItem.boundingBox())!;
    const bodyBox = (await body.boundingBox())!;

    // The body box is full-bleed inside the row; the INDENT lives in its padding, so measure the
    // content edge the way the eye sees it: padding box left + computed padding-left.
    const padLeft = await body.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingLeft));
    expect(padLeft, `at a ${root}px root the step is ${step}px: a rem step follows the root, a px literal does not`).toBe(step);
    expect(bodyBox.x).toBe(liBox.x);

    // And the text itself lands one step from the list edge, not two.
    const firstText = body.locator("> *").first();
    const textBox = (await firstText.boundingBox())!;
    const textPad = await firstText.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingLeft));
    expect(textBox.x, `at a ${root}px root`).toBe(bodyBox.x + padLeft + textPad);

    // The refs cluster is capped at the 16rem step, and never overflows its row.
    const cap = REFS_CAP_REM * root;
    const refs = listItem.getByTestId("activity-refs");
    if ((await refs.count()) > 0) {
      const maxWidth = await refs.first().evaluate((el) => getComputedStyle(el).maxWidth);
      expect(maxWidth, `16rem cap at a ${root}px root`).toBe(`${cap}px`);
      expect((await refs.first().boundingBox())!.width).toBeLessThanOrEqual(cap);
    }
  }
});
