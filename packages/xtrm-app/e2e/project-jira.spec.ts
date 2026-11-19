import { expect, test, type Page } from "@playwright/test";

// Review screenshots of the Project Jira surface and the Jira chip (ADR-002 §D2/D3/D6), light and dark.
// `mercury/market-data` is the repository the fixture bridge binds to a Jira project, so the surface
// lists MMD-551 (in sync, linked to XTRM-816), MMD-612 (unlinked) and MMD-700 (pending, linked to
// XTRM-301). `xtrm-dev/xtrm` is unbound, so the same route must say so, not show an empty table.
// The issue page below is the bound repository's own checkout: the substrate fixture maps the
// market-data checkout to the project, so XTRM-301 and its Jira chip render in one place.
const OUT = "docs/screenshots/project-jira";

async function theme(page: Page, value: "light" | "dark") {
  await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), value);
}

for (const t of ["light", "dark"] as const) {
  test(`project jira (${t})`, async ({ page }) => {
    await theme(page, t);

    await page.goto("/rep/mercury/market-data/project/jira");
    await expect(page.getByRole("region", { name: "Jira" })).toBeVisible();
    await expect(page.getByTestId("jira-row-MMD-551")).toBeVisible();
    await expect(page.getByTestId("jira-row-MMD-612")).toBeVisible();
    await expect(page.getByTestId("jira-row-MMD-700")).toBeVisible();
    await page.screenshot({ path: `${OUT}/${t}-surface.png` });

    await page.goto("/rep/xtrm-dev/xtrm/project/jira");
    await expect(page.getByTestId("jira-unbound-reason")).toBeVisible();
    await page.screenshot({ path: `${OUT}/${t}-unbound.png` });

    await page.goto("/rep/mercury/market-data/work/issues/XTRM-301");
    await expect(page.getByTestId("jira-chip-status")).toBeVisible();
    const chip = page.getByRole("link", { name: /MMD-700/ });
    await expect(chip).toHaveAttribute("href", "https://example.atlassian.net/browse/MMD-700");
    await expect(chip).toHaveAttribute("target", "_blank");
    await page.screenshot({ path: `${OUT}/${t}-issue-chip.png` });
  });
}
