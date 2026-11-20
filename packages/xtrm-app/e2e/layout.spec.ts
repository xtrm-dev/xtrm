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

test("issues table header is squared and keeps the rail below it", async ({ page }) => {
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
    const body = header.getBoundingClientRect();
    const track = scroller.getBoundingClientRect();
    const cell = row.firstElementChild as HTMLElement;
    return {
      headerBottom: body.bottom,
      headerHeight: Math.round(body.height),
      headerRule: style.borderBottomWidth,
      headerRuleColor: style.borderBottomColor,
      headerFill: style.backgroundColor,
      scrollerTop: track.top,
      scrollerClientWidth: scroller.clientWidth,
      scrollerOffsetWidth: scroller.offsetWidth,
      topLeft: style.borderTopLeftRadius,
      topRight: style.borderTopRightRadius,
      bottomLeft: style.borderBottomLeftRadius,
      bottomRight: style.borderBottomRightRadius,
      rowDivider: getComputedStyle(cell).borderBottomWidth,
      columnRule: getComputedStyle(cell).borderRightWidth,
    };
  });

  // XTRM-633 squared the header: "the table header keeps 32px, loses its bg-deep band and rounded
  // card corner for a single rule" (0b10877a). XTRM-694 had asked for the frame's radius; that
  // design is retired, and this guard could not notice while the suite ran only locally (XTRM-931).
  expect(measured.topLeft).toBe("0px");
  expect(measured.topRight).toBe("0px");
  expect(measured.bottomLeft).toBe("0px");
  expect(measured.bottomRight).toBe("0px");
  // ...and it keeps its own strip: a 32px box, no band behind it, one 4% rule underneath.
  expect(measured.headerHeight).toBe(32);
  expect(measured.headerFill).toBe("rgba(0, 0, 0, 0)");
  expect(measured.headerRule).toBe("1px");
  expect(measured.headerRuleColor).toBe("rgba(15, 15, 20, 0.04)");
  // The rail belongs to a container that begins at or below the header's bottom edge.
  expect(measured.scrollerTop).toBeGreaterThanOrEqual(measured.headerBottom - 0.5);
  // XTRM-633 removed the grid: "column rules are gone; spacing separates the columns" (0b10877a),
  // and the row cells draw no rule on either axis. XTRM-694's 4% divider token is retired with it.
  expect(measured.rowDivider).toBe("0px");
  expect(measured.columnRule).toBe("0px");
  // A classic scrollbar must not reappear inside the header strip.
  expect(measured.scrollerClientWidth).toBeLessThanOrEqual(measured.scrollerOffsetWidth);

  await page.getByTestId("issues-table-head").screenshot({ path: "e2e/.results/issues-header.png" });
});
