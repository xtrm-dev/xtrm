import { expect, test, type Page } from "@playwright/test";

/**
 * XTRM-942 review, measured in Chromium: the row's label chips could not shrink. `Badge` hardcodes
 * `shrink-0` and `cx` is a plain join with no tailwind-merge, so `truncate` never engaged and a long
 * label pair painted 84px past its 144px labels cell, over the comments column. The fix lives at the
 * call site (`IssuesSurface.tsx`): `style={{ flexShrink: 1, minWidth: 0 }}`, because appending a
 * `shrink` class cannot beat the primitive's own class.
 *
 * jsdom cannot measure, so the guard is here: the same two label pairs the reviewer measured are
 * injected into the real cell on the real route, and the assertion fails if the chips stop shrinking.
 */

const REPO = "xtrm-dev/xtrm";

/** The pair the review measured; the long one is what overflowed by 84px before the fix. */
const PAIRS = [
  ["good first issue", "help wanted"],
  ["area/platform-ui", "needs-triage-and-reproduction"],
] as const;

async function openGithubIssues(page: Page) {
  await page.goto(`/rep/${REPO}/code/issues`);
  await expect(page.locator('[data-testid="gh-issue-row"]').first()).toBeVisible();
}

/** Replace the first row's labels with `labels`, reusing the chip's own classes and attributes. */
function setLabels(labels: readonly string[]) {
  const row = document.querySelector('[data-testid="gh-issue-row"]');
  const chip = row?.querySelector('[data-slot="badge"][title]');
  const container = chip?.parentElement;
  if (!row || !chip || !container) return false;
  container.replaceChildren(
    ...labels.map((text) => {
      const el = chip.cloneNode(false) as HTMLElement;
      el.textContent = text;
      el.title = text;
      return el;
    }),
  );
  return true;
}

/** Geometry of the labels cell and its chips, after the injection. */
function labelGeometry() {
  const row = document.querySelector('[data-testid="gh-issue-row"]');
  const chip = row?.querySelector('[data-slot="badge"][title]');
  const container = chip?.parentElement;
  const cell = chip?.closest("div");
  if (!row || !chip || !container || !cell) return null;
  const box = (el: Element) => el.getBoundingClientRect();
  return {
    overflow: Math.round(container.scrollWidth - container.clientWidth),
    cellRight: Math.round(box(cell).right),
    chips: [...container.children].map((el) => ({
      text: el.textContent ?? "",
      right: Math.round(box(el).right),
      // A truncated chip reports more text than it shows; that is the ellipsis engaging.
      truncated: el.scrollWidth > el.clientWidth,
      shrink: getComputedStyle(el).flexShrink,
    })),
  };
}

for (const theme of ["light", "dark"] as const) {
  test(`the row's label chips shrink and truncate inside their cell (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), theme);
    await openGithubIssues(page);

    for (const pair of PAIRS) {
      expect(await page.evaluate(setLabels, pair), "the row carries a labels cell").toBe(true);
      const geometry = (await page.evaluate(labelGeometry))!;
      const where = `${theme} ${pair.join(" + ")}`;

      // The cell contains its chips: the pre-fix value here was 84px on the long pair.
      expect(geometry.overflow, `${where}: the labels cell does not overflow`).toBeLessThanOrEqual(0);
      for (const chip of geometry.chips) {
        expect(chip.shrink, `${where}: ${chip.text} can shrink`).toBe("1");
        expect(chip.right, `${where}: ${chip.text} stays inside its cell`).toBeLessThanOrEqual(geometry.cellRight);
      }
      // Truncation is what keeps the text honest: the chip shows an ellipsis instead of painting over
      // the next column. The short pair fits, so only the long pair must be clipped.
      if (pair === PAIRS[1]) {
        expect(geometry.chips.map((c) => c.truncated), `${where}: both long chips truncate`).toEqual([true, true]);
      }
    }
  });
}

test("the fixture's own labels still render", async ({ page }) => {
  await openGithubIssues(page);
  const row = page.locator('[data-testid="gh-issue-row"]').filter({ hasText: "Drawer keyboard trap" });
  await expect(row.locator('[data-slot="badge"][title]')).toHaveCount(2);
  await expect(row.locator('[data-slot="badge"][title="bug"]')).toBeVisible();
});
