import { expect, test, type Page } from "@playwright/test";

// Review screenshots of the Project Overview surface (ADR-002 §D9), light and dark.
// The bound repository is the status-board fixture; the second shot is an unbound one.
const OUT = "docs/screenshots/project-overview";

async function theme(page: Page, value: "light" | "dark") {
  await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), value);
}

for (const t of ["light", "dark"] as const) {
  test(`project overview (${t})`, async ({ page }) => {
    await theme(page, t);

    await page.goto("/rep/mercury/market-data/project");
    await expect(page.getByRole("region", { name: "Overview" })).toBeVisible();
    await expect(page.getByTestId("attention-count")).toBeVisible();
    await expect(page.getByText("Project Overview lands on the fixture first")).toBeVisible();
    await page.screenshot({ path: `${OUT}/${t}-overview.png` });

    await page.goto("/rep/xtrm-dev/xtrm/project");
    await expect(page.getByTestId("integration-unbound")).toBeVisible();
    await page.screenshot({ path: `${OUT}/${t}-unbound.png` });
  });
}
