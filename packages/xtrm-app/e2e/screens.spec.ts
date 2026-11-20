import { expect, test, type Page } from "@playwright/test";
import { shots } from "./shots.ts";

// Review screenshots of the Agent half (PRD §36), light and dark. A routine run writes them into the
// run's own output dir; the tracked set under docs/screenshots/agent-half is written only with
// AGENT_HALF_SHOTS_DIR (e2e/shots.ts).
const shot = shots("AGENT_HALF_SHOTS_DIR");

async function theme(page: Page, value: "light" | "dark") {
  await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), value);
}

for (const t of ["dark", "light"] as const) {
  test(`agent half screens (${t})`, async ({ page }) => {
    await theme(page, t);
    await page.goto("/agent/pi-main");
    await expect(page.getByTestId("frame")).toBeVisible();
    await expect(page.getByTestId("activity-native").first()).toBeVisible();
    await page.screenshot({ path: shot(`${t}-session-working.png`) });

    await page.getByRole("button", { name: /Frame 2: Split the tranche/ }).click();
    await page.getByRole("button", { name: /MCP github search_issues/ }).click();
    await page.getByRole("button", { name: /pi-substrate 0.2.2 plan_check/ }).click();
    await page.screenshot({ path: shot(`${t}-frame-tool-classes.png`) });

    await page.getByRole("radio", { name: "Agent" }).waitFor();
    await page.goto("/agent/quant-reviewer");
    await expect(page.getByTestId("extension-request")).toBeVisible();
    await page.screenshot({ path: shot(`${t}-extension-request.png`) });

    await page.goto("/agent/pi-main");
    await page.getByRole("radio", { name: "All" }).click();
    const box = page.getByRole("textbox", { name: "Message pi-main" });
    await box.click();
    await box.pressSequentially("Check @");
    await expect(page.getByTestId("reference-picker")).toBeVisible();
    await page.screenshot({ path: shot(`${t}-reference-picker.png`) });
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /Session quant-reviewer/ }).first().click();
    await expect(page.getByTestId("session-panel")).toBeVisible();
    await page.screenshot({ path: shot(`${t}-drawer-session.png`) });
  });
}
