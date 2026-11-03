import { expect, test } from "@playwright/test";

// Shell chrome geometry (XTRM-694): the inspector stops 6 px above the viewport bottom, the Issues
// table header rounds only its top corners, and the table scrollbar starts under the header.
async function frameBottomGap(page: import("@playwright/test").Page): Promise<number> {
  return page.getByTestId("inspector-frame").evaluate((el) => Math.round(window.innerHeight - el.getBoundingClientRect().bottom));
}

test("inspector frame keeps the 6 px search-pill inset at the bottom", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("inspector-frame")).toBeVisible();

  expect(await frameBottomGap(page)).toBe(6);
  // The gap must not scale with the viewport: it mirrors the 44 px top bar centring a 32 px pill.
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(await frameBottomGap(page)).toBe(6);
  await page.setViewportSize({ width: 1920, height: 1080 });
  expect(await frameBottomGap(page)).toBe(6);
});

test("issues table header rounds its top corners and keeps the rail below it", async ({ page }) => {
  await page.goto("/");
  const head = page.getByTestId("issues-table-head");
  await expect(head).toBeVisible();

  const measured = await page.evaluate(() => {
    const header = document.querySelector('[data-testid="issues-table-head"]') as HTMLElement;
    const row = document.querySelector('[role="listitem"]') as HTMLElement;
    let scroller: HTMLElement | null = row.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (!scroller) throw new Error("no vertical scroll container above the first row");
    const style = getComputedStyle(header);
    // The header must match the inspector frame's radius rather than a second guess at it.
    const frame = getComputedStyle(document.querySelector('[data-testid="inspector-frame"]') as HTMLElement);
    const body = header.getBoundingClientRect();
    const track = scroller.getBoundingClientRect();
    const cell = row.firstElementChild as HTMLElement;
    return {
      headerBottom: body.bottom,
      scrollerTop: track.top,
      scrollerClientWidth: scroller.clientWidth,
      scrollerOffsetWidth: scroller.offsetWidth,
      frameRadius: frame.borderTopLeftRadius,
      topLeft: style.borderTopLeftRadius,
      topRight: style.borderTopRightRadius,
      bottomLeft: style.borderBottomLeftRadius,
      bottomRight: style.borderBottomRightRadius,
      rowDivider: getComputedStyle(cell).borderBottomColor,
    };
  });

  expect(measured.topLeft).toBe(measured.frameRadius);
  expect(measured.topRight).toBe(measured.frameRadius);
  expect(measured.bottomLeft).toBe("0px");
  expect(measured.bottomRight).toBe("0px");
  // The rail belongs to a container that begins at or below the header's bottom edge.
  expect(measured.scrollerTop).toBeGreaterThanOrEqual(measured.headerBottom - 0.5);
  // Near-transparent divider (XTRM-694): the 4% ink token, not the 7% border-muted token.
  expect(measured.rowDivider).toBe("rgba(15, 15, 20, 0.04)");
  // A classic scrollbar must not reappear inside the header strip.
  expect(measured.scrollerClientWidth).toBeLessThanOrEqual(measured.scrollerOffsetWidth);

  await page.getByTestId("issues-table-head").screenshot({ path: "e2e/.results/issues-header.png" });
});
