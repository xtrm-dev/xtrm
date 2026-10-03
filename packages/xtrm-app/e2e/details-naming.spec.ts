import { expect, test, type Page } from "@playwright/test";

// XTRM-616: session details (state apart from capabilities, one model format with the provider
// apart), the header model label, and the open session kept visible outside the repository filter.
// Review screenshots, light and dark, written to docs/screenshots/agent-half/.
const OUT = "docs/screenshots/agent-half";

async function theme(page: Page, value: "light" | "dark") {
  await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), value);
}

const detail = (page: Page, label: string) => page.getByTestId("session-details").locator(`dt:text-is("${label}") + dd`);

for (const size of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
]) {
  test(`details show state, accepts and model apart and keep the list visible (${size.width}x${size.height})`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto("/agent/pi-main");
    await expect(detail(page, "State")).toHaveText("working");
    await expect(detail(page, "Accepts")).toHaveText("prompt · steer · abort");
    await expect(detail(page, "Model")).toHaveText("opus 5.5 · high");
    await expect(detail(page, "Provider")).toHaveText("anthropic");
    await expect(page.getByTestId("session-header")).toContainText("opus 5.5 · high");
    // The Details panel takes no height from the list: rows stay rendered.
    const list = page.getByRole("list", { name: "Sessions" });
    expect((await list.boundingBox())!.height).toBeGreaterThanOrEqual(140);
    await expect(page.getByTestId("session-row").first()).toBeVisible();
    if (size.height === 720) await page.screenshot({ path: `${OUT}/session-details-1280x720.png` });
  });
}

test("the open session outside the repository filter stays in the list", async ({ page }) => {
  await page.goto("/agent/host-core");
  await expect(page.getByRole("list", { name: "Sessions" })).toContainText("Open · not in xtrm");
  await expect(page.locator('[data-group="Open · not in xtrm"]').getByTestId("session-row")).toHaveAttribute("aria-label", /^host-core/);
  await expect(page.getByText(/No sessions in/)).toHaveCount(0);
});

for (const t of ["dark", "light"] as const) {
  test(`details and filter screens (${t})`, async ({ page }) => {
    await theme(page, t);
    await page.goto("/agent/pi-main");
    await expect(page.getByTestId("session-details")).toBeVisible();
    await page.screenshot({ path: `${OUT}/${t}-session-details.png` });

    await page.goto("/agent/quant-reviewer");
    await expect(detail(page, "Provider")).toHaveText("openrouter");
    await page.screenshot({ path: `${OUT}/${t}-session-details-provider.png` });

    await page.goto("/agent/scratch");
    await expect(page.locator('[data-group="Open · not in xtrm"]')).toBeVisible();
    await page.screenshot({ path: `${OUT}/${t}-open-outside-filter.png` });
  });
}
