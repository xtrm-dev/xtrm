import { expect, test, type Page } from "@playwright/test";

/**
 * XTRM-954, browser half. The pinned (level, text) sequences live in `src/app/research.test.tsx`
 * ("Research page outlines"), which is the harness the issue names. This spec checks the same rules
 * against Chromium's real heading structure rather than jsdom's: the first heading is level 1 or 2,
 * depth never exceeds 4, a step never grows by more than one level, and the list surface that carries
 * its name in the toolbar stays heading-free.
 */

const ROUTES = [
  {
    url: "/research/experiments",
    ready: (page: Page) => page.getByText("dup-detect-baseline", { exact: true }).first(),
  },
  {
    url: "/research/experiments/dup-detect-baseline",
    ready: (page: Page) => page.getByText("Metric glossary", { exact: true }).first(),
  },
  {
    url: "/research/runs/run-a",
    ready: (page: Page) => page.getByText("Manifest & versions", { exact: true }).first(),
  },
  {
    url: "/research/compare?baseline=run-a&candidate=run-b",
    ready: (page: Page) => page.getByRole("table", { name: "Metric comparison" }),
  },
];

async function outline(page: Page, url: string, ready: (page: Page) => ReturnType<Page["getByText"]>) {
  await page.goto(url);
  await expect(ready(page)).toBeVisible();
  // The chart group mounts after first paint; a bounded wait makes the collected outline the complete
  // one without hanging the route that has no charts (/research/experiments has only an unreadable run).
  await page
    .getByText("Charts", { exact: true })
    .first()
    .waitFor({ timeout: 2_000 })
    .catch(() => undefined);
  return page.evaluate(() =>
    [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((heading) => ({
      level: Number(heading.tagName.slice(1)),
      text: (heading.textContent ?? "").trim(),
    })),
  );
}

for (const route of ROUTES) {
  test(`${route.url} begins at level 2, never exceeds 4 and never skips a level`, async ({ page }) => {
    const headings = await outline(page, route.url, route.ready);
    const levels = headings.map((heading) => heading.level);
    expect(levels.length).toBeGreaterThan(0);
    expect(levels[0]).toBe(2);
    expect(Math.max(...levels)).toBeLessThanOrEqual(4);
    for (let i = 1; i < levels.length; i += 1) {
      expect(levels[i]! - levels[i - 1]!).toBeLessThanOrEqual(1);
    }
  });
}

test("the runs list carries its name in the toolbar, with no page heading", async ({ page }) => {
  await page.goto("/research/runs");
  await expect(page.getByText("Latest conclusion", { exact: true }).first()).toBeVisible();
  const count = await page.evaluate(() => document.querySelectorAll("h1, h2, h3, h4, h5, h6").length);
  expect(count).toBe(0);
});
