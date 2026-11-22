import { expect, test, type Page } from "@playwright/test";

/**
 * XTRM-942 review, measured in Chromium: the row's label chips could not shrink. `Badge` hardcoded
 * `shrink-0` and `cx` is a plain join with no tailwind-merge, so `truncate` never engaged and a long
 * label pair painted 84px past its 144px labels cell, over the comments column.
 *
 * XTRM-952 replaced the call-site `style={{ flexShrink: 1, minWidth: 0 }}` workaround with the
 * primitive's own contract: `<Badge shrink>` emits `shrink min-w-0` instead of `shrink-0`, so the
 * class can win because the base class is no longer emitted. That workaround produced the masking
 * state this spec has to distinguish: with the inline style present the guard passed while the
 * primitive still refused to shrink.
 *
 * jsdom cannot measure, so the guard is here. The primary assertion is the container's: the labels
 * cell must contain its chips (`scrollWidth <= clientWidth`). The chip-level assertions name the
 * mechanism, and the two are separable on purpose — a gate that insisted on the mechanism would
 * fail on harmless redundancy such as a call site that also sets the style.
 */

const REPO = "xtrm-dev/xtrm";

/**
 * The pair the review measured; the long one is what overflowed by 84px before the fix.
 *
 * XTRM-966: the short pair used to be `good first issue + help wanted`, which filled its 144px cell
 * exactly (77 + 63 + 4 gap = 144). Two CI runs at one head then disagreed — one passed, one failed
 * with `the short pair fits` — because the pair had ZERO pixels of margin and the chip's text metric
 * moves with the font: with Figtree's woff2 blocked (the state the #475 review measured) those chips
 * measure 81 and 65 and report truncated. A control that flips on a subpixel of font resolution is not
 * a control. `good first issue + docs` keeps 33px of margin with Figtree and 29px without it, and
 * still fails if the primitive stops offering `shrink` — the behaviour this file exists to protect.
 */
const PAIRS = [
  ["good first issue", "docs"],
  ["area/platform-ui", "needs-triage-and-reproduction"],
] as const;

/** The metric the assertions depend on, named so a future flip is diagnosed in one read. */
const FONT_METRIC = "Figtree Variable";

/**
 * The margin the short pair must keep, in px of the cell. Not a tolerance around a tight fit — a floor
 * that says "this control measures fit, not font resolution". `good first issue + docs` clears it at 33
 * (Figtree) and 29 (fallback); the pair it replaced cleared it by 0.
 */
const MIN_SHORT_SLACK = 20;

async function openGithubIssues(page: Page) {
  await page.goto(`/rep/${REPO}/code/issues`);
  await expect(page.locator('[data-testid="gh-issue-row"]').first()).toBeVisible();
  // The geometry below is a TEXT metric, so it is only meaningful once the webfont has resolved.
  // `document.fonts.ready` waits for the load; the check then fails loudly instead of silently
  // measuring the fallback stack, which is the 2px shift that produced the disagreement (XTRM-966).
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate((f: string) => document.fonts.check(`1em "${f}"`), FONT_METRIC),
    `${FONT_METRIC} did not resolve, so the chip metrics below are the fallback stack: the numbers this file asserts are meaningless`,
  ).toBe(true);
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
  // A chip that FITS reports client == scroll, so per-chip slack is always 0 and cannot carry the
  // margin claim. The margin is the cell's: what the chips would occupy unwrapped, against the width
  // the cell actually gives them (XTRM-966).
  const padding = (el: Element) => Number.parseFloat(getComputedStyle(el).paddingLeft) + Number.parseFloat(getComputedStyle(el).paddingRight);
  const gap = Number.parseFloat(getComputedStyle(container).columnGap) || 0;
  const want = [...container.children].reduce((n, el) => n + el.scrollWidth, 0) + gap * Math.max(0, container.children.length - 1);
  return {
    want,
    room: cell.clientWidth - padding(cell),
    overflow: Math.round(container.scrollWidth - container.clientWidth),
    cellRight: Math.round(box(cell).right),
    chips: [...container.children].map((el) => ({
      text: el.textContent ?? "",
      right: Math.round(box(el).right),
      // Both numbers are reported, not just the boolean: `slack` is what the short pair asserts on,
      // and a reader diagnosing a flip needs the pair that produced it.
      client: el.clientWidth,
      scroll: el.scrollWidth,
      // A truncated chip reports more text than it shows; that is the ellipsis engaging.
      truncated: el.scrollWidth > el.clientWidth,
      shrink: getComputedStyle(el).flexShrink,
      // Which class produced that shrink: the primitive's own opt-in, or something else.
      fromPrimitive: el.classList.contains("shrink") && !el.classList.contains("shrink-0"),
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

      // Layout claim, the one a reader sees: the cell contains its chips. It covers a broken render —
      // 85px of overflow on the long pair at this base, and 85px again with the primitive reverted and
      // the call site clean. Note that the reverted run does not report that number: the first pair's
      // mechanism assertion fails before the long pair is reached, so the 85px is measured evidence in
      // the PR body, not guard output.
      expect(geometry.overflow, `${where}: the labels cell does not overflow`).toBeLessThanOrEqual(0);
      for (const chip of geometry.chips) {
        // Mechanism reading. On this primitive it is entailed by `fromPrimitive` below, and it is kept
        // for what its failure says: "can shrink, expected 1, received 0" names the property, where the
        // class check names the source.
        expect(chip.shrink, `${where}: ${chip.text} can shrink`).toBe("1");
        // The assertion that separates a shipped fix from a masked one. A chip that shrinks while the
        // primitive still emits `shrink-0` is being rescued from outside the primitive (an inline
        // style), which is the mask this issue exists to remove. It cannot be spoofed by a caller
        // adding `shrink` while the primitive keeps `shrink-0`: both classes land in the list and the
        // check returns false.
        expect(chip.fromPrimitive, `${where}: ${chip.text} shrinks because the primitive offers it`).toBe(true);
        expect(chip.right, `${where}: ${chip.text} stays inside its cell`).toBeLessThanOrEqual(geometry.cellRight);
      }
      // Truncation is what keeps the text honest: the chip shows an ellipsis instead of painting over
      // the next column. The long pair must clip. The short pair must NOT.
      //
      // XTRM-966: the short pair used to fit with zero slack, so it flipped between two CI runs at one
      // head. It now carries margin, and the margin is ASSERTED rather than assumed — `slack` per chip
      // is reported in the failure message, so a future flip says which chip lost how many pixels
      // instead of only that a boolean turned over.
      if (pair === PAIRS[1]) {
        expect(geometry.chips.map((c) => c.truncated), `${where}: both long chips truncate`).toEqual([true, true]);
      } else {
        const numbers = `want ${geometry.want}px of ${geometry.room}px room (${geometry.chips.map((c) => `${c.text} ${c.client}/${c.scroll}`).join(", ")})`;
        expect(geometry.chips.map((c) => c.truncated), `${where}: the short pair fits — ${numbers}`).toEqual([false, false]);
        // Zero margin is what made this control a coin flip: 77 + 63 + 4 == 144 exactly. MIN_SHORT_SLACK
        // is measured, not chosen.
        expect(geometry.room - geometry.want, `${where}: the short pair keeps margin, not a knife edge — ${numbers}`).toBeGreaterThanOrEqual(MIN_SHORT_SLACK);
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
