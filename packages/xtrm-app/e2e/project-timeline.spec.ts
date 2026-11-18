import { expect, test, type Page } from "@playwright/test";

// Review screenshots of the Project Timeline surface (ADR-002 §D9, console-ui-system §5),
// light and dark. The fixture board carries yesterday, today and tomorrow, so the shots show a
// past day (no now marker), today (one marker) and a day the board carries nothing for.
const OUT = "docs/screenshots/project-timeline";

const DAY = 86_400_000;
const utcDay = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

async function theme(page: Page, value: "light" | "dark") {
  await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), value);
}

for (const t of ["light", "dark"] as const) {
  test(`project timeline (${t})`, async ({ page }) => {
    await theme(page, t);
    const today = utcDay(0);

    await page.goto("/rep/mercury/market-data/project/timeline");
    await expect(page.getByRole("region", { name: "Timeline" })).toBeVisible();
    await expect(page.getByTestId(`day-group-${today}`)).toBeVisible();
    await expect(page.getByTestId("now-marker")).toBeVisible();
    await page.screenshot({ path: `${OUT}/${t}-today.png` });

    await page.goto(`/rep/mercury/market-data/project/timeline?day=${utcDay(-1)}`);
    await expect(page.getByTestId(`day-group-${utcDay(-1)}`)).toBeVisible();
    await expect(page.getByTestId("now-marker")).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/${t}-yesterday.png` });

    await page.goto(`/rep/mercury/market-data/project/timeline?day=${utcDay(9)}`);
    await expect(page.getByTestId("timeline-empty-day")).toBeVisible();
    await page.screenshot({ path: `${OUT}/${t}-empty-day.png` });
  });
}
