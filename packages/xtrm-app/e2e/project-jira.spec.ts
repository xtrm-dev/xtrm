import { expect, test, type Page } from "@playwright/test";

// Review screenshots of the Project Jira surface (ADR-002 §D2/D3), light and dark.
// `mercury/market-data` is the repository the fixture bridge binds to a Jira project, so the
// surface lists MMD-551 (in sync, linked to XTRM-816), MMD-612 (unlinked) and MMD-700 (pending,
// linked to XTRM-820); `xtrm-dev/xtrm` is unbound, so the same route must say so, not show an
// empty table. The Jira chip on a Substrate issue page is covered by
// src/refs/jira-references.test.tsx: the fixtures bind no key to an issue the substrate fixture
// carries, so no screenshot can show that pair without inventing fixture data.
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
  });
}
