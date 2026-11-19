import { expect, test, type Page } from "@playwright/test";

// Review screenshots of the read-only Questions surface (XTRM-899), light and dark.
// The status-board fixture carries two owner documents with question rows, one owner document
// without an open question, and answers keyed by question id, so both answered states render.
const OUT = "docs/screenshots/project-questions";

async function theme(page: Page, value: "light" | "dark") {
  await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), value);
}

for (const t of ["light", "dark"] as const) {
  test(`project questions (${t})`, async ({ page }) => {
    await theme(page, t);

    await page.goto("/rep/mercury/market-data/project/questions");
    await expect(page.getByRole("region", { name: "Questions", exact: true })).toBeVisible();
    await expect(page.getByTestId("questions-read-only")).toBeVisible();
    await expect(page.getByTestId("question-row").first()).toBeVisible();
    await expect(page.getByTestId("questions-count")).toHaveText("3 questions · 2 answered");

    // The list is grouped by owner document, and each row prints its ref, text, recommendation,
    // why, age and answered state. An owner document with `rows: []` contributes no group.
    await expect(page.getByTestId("question-group")).toHaveCount(2);
    await expect(page.getByTestId("question-row")).toHaveCount(3);
    await expect(page.getByTestId("question-row").first().getByTestId("question-state")).toHaveText("answered");
    await expect(page.getByTestId("question-row").nth(1).getByTestId("question-state")).toHaveText("unanswered");
    for (const id of ["question-text", "question-rec", "question-why", "question-age"]) {
      await expect(page.getByTestId("question-row").first().getByTestId(id)).not.toBeEmpty();
    }

    // The sidebar entry is a live destination now: no deferred marker on its nav item.
    await expect(page.locator('nav [role="button"]', { hasText: /^Questions$/ }).first()).not.toHaveAttribute("data-deferred", "true");

    // Restraint: one coloured element per row — the answered badge. The ref is a reference chip,
    // never a second state chip.
    expect(await page.getByTestId("question-row").first().locator("[class*='bg-success']").count()).toBe(1);

    await page.screenshot({ path: `${OUT}/${t}-questions.png` });
  });
}
