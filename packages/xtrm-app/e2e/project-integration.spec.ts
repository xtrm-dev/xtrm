import { expect, test, type Page } from "@playwright/test";
import { shotPath } from "./shots.ts";

// Review screenshots of the read-only Integration surface (XTRM-900), light and dark.
// The status-board fixture binds mercury/market-data with a readable credential path, a fresh
// sync and no gaps, so every binding field and every health fact render as verified values.
const SHOTS = "project-integration";

async function theme(page: Page, value: "light" | "dark") {
  await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), value);
}

for (const t of ["light", "dark"] as const) {
  test(`project integration (${t})`, async ({ page }, testInfo) => {
    await theme(page, t);

    await page.goto("/rep/mercury/market-data/project/settings");
    await expect(page.getByRole("region", { name: "Integration", exact: true })).toBeVisible();

    // The resolved binding, field by field: repository, resolver, PM and Substrate projects,
    // board site and state, Jira site and project.
    await expect(page.getByTestId("integration-repository")).toHaveText("mercury/market-data");
    await expect(page.getByTestId("integration-resolved-by")).toHaveText("the repository slug");
    await expect(page.getByTestId("integration-pm-project")).toHaveText("market-data");
    await expect(page.getByTestId("integration-substrate-project")).toHaveText("market-data");
    await expect(page.getByTestId("integration-board-site")).not.toBeEmpty();
    await expect(page.getByTestId("integration-state-dir")).not.toBeEmpty();
    await expect(page.getByTestId("integration-jira-site")).not.toBeEmpty();
    await expect(page.getByTestId("integration-jira-project")).not.toBeEmpty();

    // Credential evidence is a path and a flag, never a value.
    await expect(page.getByTestId("integration-key-file")).toHaveText(/^\/\S+ — readable$/);

    // XTRM-935: the binding facts are one `Fields` grid, so the label column is 160px and every
    // value starts at 172px at the 10px step. A slice that re-introduces a local grid drifts these
    // numbers without failing any content assertion, which is why the boxes are measured here.
    const firstValue = page.getByTestId("integration-repository");
    const firstLabel = firstValue.locator("xpath=../../dt").first();
    const labelBox = await firstLabel.boundingBox();
    const valueBox = await firstValue.boundingBox();
    expect(Math.round(labelBox?.width ?? 0)).toBe(160);
    expect(Math.round((valueBox?.x ?? 0) - (labelBox?.x ?? 0))).toBe(172);
    const valueSize = await firstValue.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
    expect(valueSize).toBeCloseTo(11.52, 1);
    await expect(page.getByTestId("integration-credential-note")).toContainText("never returns a credential value");

    // Sync health, schedule, run, last sync, drift.
    await expect(page.getByTestId("health-unit")).toHaveText("running");
    await expect(page.getByTestId("health-schedule")).toHaveText("active");
    await expect(page.getByTestId("health-run")).toHaveText("no sync is running");
    await expect(page.getByTestId("health-drift")).toHaveText("0 records");
    await expect(page.getByTestId("health-last-sync")).toContainText("ago ·");

    // Gaps: the fixture is clean, and the page says so against a scanned count.
    await expect(page.getByTestId("integration-gap-count")).toHaveText("0 gaps");
    await expect(page.getByTestId("integration-gap-none")).toContainText("none");

    // The surface adds no state chip and no second coloured element.
    expect(await page.getByTestId("integration-surface").locator("[class*='bg-success'], [class*='bg-danger'], [class*='bg-accent']").count()).toBe(0);

    // The sidebar entry is a live destination now: no deferred marker on its nav item.
    await expect(page.locator('nav [role="button"]', { hasText: /^Integration$/ }).first()).not.toHaveAttribute("data-deferred", "true");

    await page.screenshot({ path: shotPath(testInfo, SHOTS, `${t}-integration.png`) });
  });
}
