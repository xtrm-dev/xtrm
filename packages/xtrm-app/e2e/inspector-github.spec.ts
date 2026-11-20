import { expect, test, type Page } from "@playwright/test";

// XTRM-697: the Inspector renders GitHub HTML bodies the way GitHub does. pr-lens posts pure HTML
// with <details> blocks holding a <picture> (light SVG plus a dark <source>), so the diagram must
// load, both bot comments must appear, and the bot identity must carry the GitHub mark.
const SVG = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1318" height="220" viewBox="0 0 1318 220"><rect width="1318" height="220" fill="#f4f4f5"/><text x="32" y="128" font-family="monospace" font-size="56" fill="#18181b">${label}</text></svg>`;

async function openPull(page: Page) {
  await page.goto("/rep/xtrm-dev/xtrm/code/pulls");
  await page.getByTestId("pull-row").filter({ hasText: "#212" }).click();
  await expect(page.getByTestId("inspector-drawer")).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  // Diagrams are served by the console backend (the browser cannot load github.com raw URLs on a
  // private repository), so the same-origin proxy route is what the page requests.
  await page.route("**/api/github/repo/xtrm-dev/xtrm/raw-svg?**", (route) => {
    const name = new URL(route.request().url()).searchParams.get("path")?.split("/").pop() ?? "diagram.svg";
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: SVG(name.replace(/\.svg$/, "")) });
  });
});

test("the PR drawer renders pr-lens HTML: diagrams, both comments, bot mark and the GitHub pill", async ({ page }) => {
  await openPull(page);
  const drawer = page.getByTestId("inspector-drawer");
  await expect(drawer.locator("h3").filter({ hasText: "Rail keyboard model review package" })).toHaveCount(2);

  const images = drawer.locator("img");
  await expect(images).toHaveCount(3);
  // A collapsed <details> hides its diagram, as on GitHub: open it, then let the lazy images load.
  const details = drawer.locator("details");
  await expect(details.locator("summary")).toHaveCount(3);
  await details.nth(1).locator("summary").click();
  await expect(details.nth(1)).toHaveAttribute("open", "");
  for (let i = 0; i < 3; i += 1) await images.nth(i).scrollIntoViewIfNeeded();
  await expect
    .poll(async () => images.evaluateAll((els) => els.map((e) => (e as HTMLImageElement).naturalWidth > 0)))
    .toEqual([true, true, true]);
  // Light theme picks the light source, not `prefers-color-scheme`.
  await expect(images.first()).toHaveAttribute("src", /raw-svg\?path=.*rail-light-a\.svg&ref=pr-lens$/);

  // Two comments from the same bot, each with the octocat mark and the app chip.
  await expect(drawer.getByText("github-actions[bot]")).toHaveCount(2);
  await expect(drawer.getByText("app", { exact: true })).toHaveCount(2);
  expect(await drawer.locator("span[aria-hidden='true'] svg").count()).toBeGreaterThanOrEqual(2);

  // The affordance sits on the title line, not at the bottom of a long panel.
  const header = drawer.getByTestId("pull-header");
  const pill = header.getByTestId("github-pill");
  await expect(pill).toBeVisible();
  await expect(pill).toContainText("Open on GitHub");
  const box = (await pill.boundingBox())!;
  expect(Math.round(box.height)).toBe(28);
  const background = await pill.evaluate((el) => getComputedStyle(el).backgroundColor);
  // The header pill is the ghost form (XTRM-861, `src/ui/github-pill.tsx`, `PullPanel.tsx`): a filled
  // pill is a chip background in a header, so at rest it carries no fill, its control radius and muted
  // ink.
  expect(background).toBe("rgba(0, 0, 0, 0)");
  // the app's control radius (`--radius-md`, 8px), not the solid pill's full round.
  expect(await pill.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe("8px");
  expect(await pill.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(95, 95, 104)");
  // The wash is the affordance: the ghost form takes the hover token, never a solid GitHub fill.
  // `transition-colors` animates it, so poll instead of reading the frame the hover lands on; Chromium
  // serialises the 4.5% hover token through 8-bit alpha, which lands on 0.043.
  await pill.hover();
  await expect
    .poll(() => pill.evaluate((el) => getComputedStyle(el).backgroundColor), { timeout: 2000 })
    .toBe("rgba(15, 15, 20, 0.043)");
  // Nothing repeats the pill at the bottom.
  await expect(drawer.getByTestId("github-pill")).toHaveCount(1);
});

test("the diagram follows the app theme, not the OS scheme", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("xtrm.console.theme.v1", "dark"));
  await openPull(page);
  const first = page.getByTestId("inspector-drawer").locator("img").first();
  await expect(first).toHaveAttribute("src", /raw-svg\?path=.*rail-dark-a\.svg&ref=pr-lens$/);
});
