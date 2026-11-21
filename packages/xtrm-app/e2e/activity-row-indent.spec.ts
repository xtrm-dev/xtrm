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

const ROOT_REM = 16;
const STEP = 1.25 * ROOT_REM; // pl-5 / the console's one indent step (INDENT_REM = 1.25rem)
const REFS_CAP = 16 * ROOT_REM; // max-w-64 == max-w-[16rem] == 256px

test("the expanded row body sits one 1.25rem step in from its row", async ({ page }) => {
  await page.goto("/rep/xtrm-dev/xtrm/code/activity");
  const feed = page.getByRole("list", { name: /activity feed/i });
  await expect(feed).toBeVisible();

  // Open the first row: the accordion is the only path to the body.
  const row = feed.getByRole("button").first();
  await row.click();

  const listItem = feed.locator("> li").first();
  // Child 0 is the Row itself (it carries the row gutter, px-3); the expanded body is child 1.
  const body = listItem.locator("> div").nth(1);
  await expect(body).toBeVisible();

  const liBox = (await listItem.boundingBox())!;
  const bodyBox = (await body.boundingBox())!;

  // The body box is full-bleed inside the row; the INDENT lives in its padding, so measure the
  // content edge the way the eye sees it: padding box left + computed padding-left.
  const padLeft = await body.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingLeft));
  expect(padLeft).toBe(STEP);
  expect(bodyBox.x).toBe(liBox.x);

  // And the text itself lands one step from the list edge, not two.
  const firstText = body.locator("> *").first();
  const textBox = (await firstText.boundingBox())!;
  const expected = bodyBox.x + padLeft + (await firstText.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingLeft)));
  expect(textBox.x).toBe(expected);

  // The refs cluster is capped at the 16rem step, and never overflows its row.
  const refs = listItem.getByTestId("activity-refs");
  if ((await refs.count()) > 0) {
    const maxWidth = await refs.first().evaluate((el) => getComputedStyle(el).maxWidth);
    expect(maxWidth).toBe(`${REFS_CAP}px`);
    expect((await refs.first().boundingBox())!.width).toBeLessThanOrEqual(REFS_CAP);
  }
});
