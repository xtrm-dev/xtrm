import { expect, test, type Page } from "@playwright/test";

// Review screenshots of the Workers tree and the Follow-ups list (XTRM-819), light and dark.
// The dispatch graph comes from the substrate fixture, the board records from the status-board
// fixture: one chain (console-lead -> board-worker -> test-engineer), one worker whose binding
// has no dispatcher, and one board worker the graph does not mention.
const OUT = "docs/screenshots/project-workers";

async function theme(page: Page, value: "light" | "dark") {
  await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), value);
}

for (const t of ["light", "dark"] as const) {
  test(`project workers (${t})`, async ({ page }) => {
    await theme(page, t);

    await page.goto("/rep/mercury/market-data/project/workers");
    await expect(page.getByRole("region", { name: "Workers" })).toBeVisible();
    await expect(page.getByTestId("workers-tree")).toBeVisible();
    await expect(page.getByTestId("graph-count")).toBeVisible();
    await page.screenshot({ path: `${OUT}/${t}-tree.png` });

    // The unknown-dispatcher group is part of the tree, not a separate mode.
    const unknown = page.getByRole("region", { name: "Unknown dispatcher" });
    await expect(unknown).toBeVisible();
    await expect(unknown.getByTestId("worker-orphan").first()).toBeVisible();
    await unknown.screenshot({ path: `${OUT}/${t}-unknown-dispatcher.png` });

    const region = page.getByRole("region", { name: "Workers" });
    await region.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByTestId("workers-list")).toBeVisible();
    await region.getByRole("checkbox", { name: "Include archived workers" }).check();
    await expect(page.getByTestId("workers-count")).toBeVisible();
    await page.screenshot({ path: `${OUT}/${t}-list-including-archived.png` });

    await page.goto("/rep/mercury/market-data/project/followups");
    await expect(page.getByRole("region", { name: "Follow-ups", exact: true })).toBeVisible();
    await expect(page.getByTestId("followup-row").first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/${t}-followups.png` });
  });
}
