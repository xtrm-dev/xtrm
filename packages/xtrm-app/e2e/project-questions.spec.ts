import { expect, test, type Page } from "@playwright/test";
import { shots } from "./shots.ts";

// Review screenshots of the read-only Questions surface (XTRM-899, XTRM-913), light and dark.
// The status-board fixture carries two owner documents with question rows, one owner document
// without an open question, and answers keyed by question id, so both answered states render.
const shot = shots("QUESTIONS_SHOTS_DIR");

async function theme(page: Page, value: "light" | "dark") {
  await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), value);
}

for (const t of ["light", "dark"] as const) {
  test(`project questions (${t})`, async ({ page }) => {
    await theme(page, t);

    await page.goto("/rep/mercury/market-data/project/questions");
    await expect(page.getByRole("region", { name: "Questions", exact: true })).toBeVisible();
    await expect(page.getByTestId("questions-read-only")).toBeVisible();
    await expect(page.getByTestId("questions-count")).toHaveText("3 questions · 2 answered");

    // XTRM-913: the unanswered question leads, open; the answered backlog follows as a closed
    // disclosure that carries its own count. Both keep the owner grouping, so an owner can appear
    // in both sections and the group count is one more than the owner count.
    const unanswered = page.locator('[data-section="unanswered"]');
    const answered = page.locator('[data-section="answered"]');
    await expect(unanswered.getByTestId("question-section-count")).toHaveText("1");
    await expect(answered.locator("summary").getByTestId("question-section-count")).toHaveText("2");
    await expect(answered).not.toHaveAttribute("open");
    await expect(unanswered.getByTestId("question-group")).toHaveCount(1);
    await expect(unanswered.getByTestId("question-row")).toHaveCount(1);
    await expect(page.getByTestId("question-group")).toHaveCount(3);
    await expect(page.getByTestId("question-row")).toHaveCount(3);

    // Each row prints its ref, text, recommendation, why, age and answered state; the open
    // question is the row the operator can act on.
    await expect(unanswered.getByTestId("question-row").first()).toBeVisible();
    await expect(unanswered.getByTestId("question-row").first().getByTestId("question-state")).toHaveText("unanswered");
    for (const id of ["question-text", "question-rec", "question-why", "question-age"]) {
      await expect(unanswered.getByTestId("question-row").first().getByTestId(id)).not.toBeEmpty();
    }
    // The closed disclosure renders no answered row.
    await expect(answered.getByTestId("question-row").first()).toBeHidden();

    // The sidebar entry is a live destination now: no deferred marker on its nav item.
    await expect(page.locator('nav [role="button"]', { hasText: /^Questions$/ }).first()).not.toHaveAttribute("data-deferred", "true");

    // Restraint: one coloured element per row. The unanswered badge is muted (no success fill),
    // and the ref is a reference chip, never a second state chip.
    expect(await unanswered.getByTestId("question-row").first().locator("[class*='bg-success']").count()).toBe(0);

    await page.screenshot({ path: shot(`${t}-questions.png`) });

    // The answered backlog opens on demand; the answered row's badge is its one coloured element.
    await answered.locator("summary").click();
    await expect(answered).toHaveAttribute("open", "");
    await expect(answered.getByTestId("question-row")).toHaveCount(2);
    await expect(answered.getByTestId("question-row").first().getByTestId("question-state")).toHaveText("answered");
    expect(await answered.getByTestId("question-row").first().locator("[class*='bg-success']").count()).toBe(1);
    await page.screenshot({ path: shot(`${t}-questions-answered.png`) });
  });
}
