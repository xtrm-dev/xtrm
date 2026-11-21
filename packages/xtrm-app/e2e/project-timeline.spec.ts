import { expect, test, type Page } from "@playwright/test";
import { shotPath } from "./shots.ts";

// Review screenshots of the Project Timeline surface (ADR-002 §D9, console-ui-system §5),
// light and dark. The fixture board carries yesterday, today and tomorrow, so the shots show a
// past day (no now marker), today (one marker) and a day the board carries nothing for.
const SHOTS = "project-timeline";

const DAY = 86_400_000;
const utcDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

async function theme(page: Page, value: "light" | "dark") {
  await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), value);
}

for (const t of ["light", "dark"] as const) {
  test(`project timeline (${t})`, async ({ page }, testInfo) => {
    await theme(page, t);
    const today = utcDay(0);

    await page.goto("/rep/mercury/market-data/project/timeline");
    await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
    await expect(page.getByTestId(`day-group-${today}`)).toBeVisible();
    await expect(page.getByTestId("now-marker")).toBeVisible();
    await page.screenshot({ path: shotPath(testInfo, SHOTS, `${t}-today.png`) });

    // XTRM-935: an event's detail row is a `Fields` grid at labelWidth 3.5rem, so the label column
    // is 56px and each value starts at 68px at the 10px step. Pinned here rather than in the
    // surfaces the slice also touched: the guard belongs to the spec of the surface it measures.
    const details = page.locator('[data-testid^="event-detail-"]').first();
    if (!(await details.isVisible())) {
      await page.locator('[data-testid^="event-row-"]').first().click();
    }
    await expect(details).toBeVisible();
    const detailLabel = details.locator("dt").first();
    const detailValue = details.locator("dd").first();
    const detailLabelBox = await detailLabel.boundingBox();
    const detailValueBox = await detailValue.boundingBox();
    expect(Math.round(detailLabelBox?.width ?? 0)).toBe(56);
    expect(Math.round((detailValueBox?.x ?? 0) - (detailLabelBox?.x ?? 0))).toBe(68);
    const detailSize = await detailValue.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(detailSize).toBeCloseTo(11.52, 1);

    await page.goto(`/rep/mercury/market-data/project/timeline?day=${utcDay(-1)}`);
    await expect(page.getByTestId(`day-group-${utcDay(-1)}`)).toBeVisible();
    await expect(page.getByTestId("now-marker")).toHaveCount(0);
    await page.screenshot({ path: shotPath(testInfo, SHOTS, `${t}-yesterday.png`) });

    await page.goto(`/rep/mercury/market-data/project/timeline?day=${utcDay(9)}`);
    await expect(page.getByTestId("timeline-empty-day")).toBeVisible();
    await page.screenshot({ path: shotPath(testInfo, SHOTS, `${t}-empty-day.png`) });
  });
}
