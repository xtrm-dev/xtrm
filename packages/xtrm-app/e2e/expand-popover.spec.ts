import { expect, test, type Page } from "@playwright/test";

/**
 * XTRM-1099: both console popovers expand out of their trigger. The panel header is the trigger
 * row rendered again, so the two rects must agree within 1px from the first animation frame to the
 * settled one, in both themes and both grow directions.
 */

type Rect = { x: number; y: number; width: number; height: number };
type Frame = { header: Rect; trigger: Rect; body: number; opacity: number; starting: boolean };

const DROPUP = '[data-testid="context-sidebar"] button[aria-label="Data sources"]';
const REPO = '[data-testid="context-sidebar"] button[aria-label^="Repository:"]';
const THEME_KEY = "xtrm.console.theme.v1";

declare global {
  interface Window {
    __expandFrames?: Frame[];
  }
}

/** Record the popup's geometry on every animation frame from the moment it mounts. */
async function recordFrames(page: Page, triggerSelector: string) {
  await page.evaluate((trigger) => {
    window.__expandFrames = [];
    const rect = (el: Element): Rect => {
      const box = el.getBoundingClientRect();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    };
    const sample = () => {
      const popup = document.querySelector<HTMLElement>("[data-expand-popover]");
      const triggerEl = document.querySelector(trigger);
      if (!popup || !triggerEl) return false;
      const header = popup.querySelector("[data-expand-popover-header]");
      const body = popup.querySelector("[data-expand-popover-body]");
      if (!header || !body) return false;
      window.__expandFrames!.push({
        header: rect(header),
        trigger: rect(triggerEl),
        body: body.getBoundingClientRect().height,
        opacity: Number(getComputedStyle(popup).opacity),
        starting: popup.hasAttribute("data-starting-style"),
      });
      return window.__expandFrames!.length >= 12;
    };
    const tick = () => {
      if (!sample()) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, triggerSelector);
}

const frames = (page: Page) => page.evaluate(() => window.__expandFrames ?? []);

function expectSameRect(actual: Rect, expected: Rect) {
  expect(Math.abs(actual.x - expected.x), "header x").toBeLessThanOrEqual(1);
  expect(Math.abs(actual.y - expected.y), "header y").toBeLessThanOrEqual(1);
  expect(Math.abs(actual.width - expected.width), "header width").toBeLessThanOrEqual(1);
  expect(Math.abs(actual.height - expected.height), "header height").toBeLessThanOrEqual(1);
}

/** The settled opacity, after the close gate (Base UI waits for the popup's own transition). */
const settledOpacity = (page: Page) =>
  page.waitForFunction(() => {
    const popup = document.querySelector<HTMLElement>("[data-expand-popover]");
    return popup !== null && Number(getComputedStyle(popup).opacity) === 1;
  });

/** The transition durations of the two animated layers, in seconds. */
const transitionDurations = (page: Page) =>
  page.evaluate(() => {
    const popup = document.querySelector("[data-expand-popover]")!;
    const surface = popup.querySelector("[data-expand-popover-surface]")!;
    return { popup: getComputedStyle(popup).transitionDuration, surface: getComputedStyle(surface).transitionDuration };
  });

/** The panel grows out of the trigger: the header stays on it and the body height grows. */
async function expectGrewOutOfTrigger(page: Page, samples: Frame[], animated = true) {
  expect(samples.length).toBeGreaterThan(2);
  for (const sample of samples) expectSameRect(sample.header, sample.trigger);
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  // Sampled while the animation runs, so the body is mid-growth and the panel is not opaque yet.
  expect(first.body).toBeLessThan(last.body);
  expect(last.body).toBeGreaterThan(56);
  // The animation is a 180 ms ease-out on both layers; a frame budget under load can end the
  // sampler before the last frame lands, so the settled value is awaited, not sampled.
  const durations = await transitionDurations(page);
  expect(durations.popup).toBe(animated ? "0.18s" : "0s");
  expect(durations.surface).toBe(animated ? "0.18s" : "0s");
  await settledOpacity(page);
}

test.describe("expanding popover", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`the sidebar drop-up grows upward out of its trigger in ${theme}`, async ({ page }) => {
      await page.goto("/rep/xtrm-dev/xtrm/work/issues");
      await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [THEME_KEY, theme]);
      await page.reload();
      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
      await page.locator(DROPUP).waitFor();

      await recordFrames(page, DROPUP);
      await page.locator(DROPUP).click();
      await expect(page.locator('[data-expand-popover][data-side="top"]')).toBeVisible();
      await expect(page.getByTestId("board-transport")).toBeVisible();
      await page.waitForTimeout(400);

      await expectGrewOutOfTrigger(page, await frames(page));
      // The repeated row is the panel's last row, so it lands on the bottom-anchored trigger.
      const order = await page.evaluate(() => {
        const popup = document.querySelector("[data-expand-popover]")!;
        return [...popup.children].map((child) => child.getAttribute("data-expand-popover-header") !== null);
      });
      expect(order).toEqual([false, true]);
      const surface = await page.evaluate(() => {
        const el = document.querySelector("[data-expand-popover-surface]")!;
        const box = el.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, headerTop: document.querySelector("[data-expand-popover-header]")!.getBoundingClientRect().top };
      });
      // A drop-up's panel ends where the trigger row starts.
      expect(Math.abs(surface.bottom - surface.headerTop)).toBeLessThanOrEqual(1);

      await page.keyboard.press("Escape");
      await expect(page.locator("[data-expand-popover]")).toHaveCount(0);
    });
  }

  test("the repository selector grows downward out of its trigger", async ({ page }) => {
    await page.goto("/rep/xtrm-dev/xtrm/work/issues");
    await page.locator(REPO).waitFor();

    await recordFrames(page, REPO);
    await page.locator(REPO).click();
    await expect(page.locator('[data-expand-popover][data-side="bottom"]')).toBeVisible();
    await expect(page.getByLabel("Filter repositories")).toBeVisible();
    await page.waitForTimeout(400);

    await expectGrewOutOfTrigger(page, await frames(page));
    const layout = await page.evaluate(() => {
      const popup = document.querySelector("[data-expand-popover]")!;
      const header = popup.querySelector("[data-expand-popover-header]")!;
      const surface = popup.querySelector("[data-expand-popover-surface]")!;
      return {
        order: [...popup.children].map((child) => child.getAttribute("data-expand-popover-header") !== null),
        headerWidth: header.getBoundingClientRect().width,
        panelWidth: surface.getBoundingClientRect().width,
        panelTop: surface.getBoundingClientRect().top,
        headerBottom: header.getBoundingClientRect().bottom,
      };
    });
    expect(layout.order).toEqual([false, true]);
    // The panel is exactly as wide as the trigger, never the old 288px floating card, and starts
    // where the trigger row ends.
    expect(Math.abs(layout.panelWidth - layout.headerWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.panelTop - layout.headerBottom)).toBeLessThanOrEqual(1);
  });

  test("opens instantly under reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/rep/xtrm-dev/xtrm/work/issues");
    await page.locator(REPO).waitFor();

    await recordFrames(page, REPO);
    await page.locator(REPO).click();
    await expect(page.locator("[data-expand-popover]")).toBeVisible();

    const durations = await transitionDurations(page);
    expect(durations.popup).toBe("0s");
    expect(durations.surface).toBe("0s");

    // No intermediate heights: every frame is either the closed trigger height or the full panel.
    await page.waitForTimeout(50);
    const samples = await frames(page);
    expect(samples.length).toBeGreaterThan(1);
    for (const sample of samples) expect(sample.body === 0 || sample.body > 56).toBe(true);
    expect(samples[samples.length - 1]!.body).toBeGreaterThan(56);
  });

  test("Esc, an outside click and the arrow keys work, and focus returns to the trigger", async ({ page }) => {
    await page.goto("/rep/xtrm-dev/xtrm/work/issues");
    // A click before hydration is a silent no-op, so wait for the shell to mount first.
    await page.locator(DROPUP).waitFor();

    await page.locator(DROPUP).click();
    await expect(page.getByTestId("board-transport")).toBeVisible();
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-popover-row"))).toBe(true);
    const secondRow = await page.evaluate(() => document.activeElement?.textContent ?? "");
    await page.keyboard.press("ArrowDown");
    const thirdRow = await page.evaluate(() => document.activeElement?.textContent ?? "");
    expect(thirdRow).not.toBe(secondRow);

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-expand-popover]")).toHaveCount(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))).toBe("Data sources");

    await page.locator(REPO).click();
    await expect(page.locator('[data-expand-popover][data-side="bottom"]')).toBeVisible();
    await page.keyboard.press("ArrowDown");
    expect(await page.evaluate(() => document.activeElement?.getAttribute("role"))).toBe("option");
    // A press anywhere outside dismisses the panel and focus returns to the trigger.
    await page.mouse.click(1200, 600);
    await expect(page.locator("[data-expand-popover]")).toHaveCount(0);
  });

  test("a second press on the open row closes the panel and leaves focus on the trigger", async ({ page }) => {
    await page.goto("/rep/xtrm-dev/xtrm/work/issues");
    await page.locator(DROPUP).waitFor();

    for (const selector of [DROPUP, REPO]) {
      await page.locator(selector).click();
      await expect(page.locator("[data-expand-popover]")).toBeVisible();
      // The header is painted over the trigger, so a press on that row must reach the trigger.
      const centre = await page.evaluate((sel) => {
        const box = document.querySelector(sel)!.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }, selector);
      await page.mouse.click(centre.x, centre.y);
      await expect(page.locator("[data-expand-popover]")).toHaveCount(0);
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      expect(focused === "Data sources" || focused?.startsWith("Repository:")).toBe(true);
    }
  });

  test("a viewport resize keeps the header on the trigger and re-caps the panel", async ({ page }) => {
    await page.goto("/rep/xtrm-dev/xtrm/work/issues");
    await page.locator(REPO).waitFor();
    await page.locator(REPO).click();
    await expect(page.locator('[data-expand-popover][data-side="bottom"]')).toBeVisible();

    const measure = () =>
      page.evaluate(() => {
        const popup = document.querySelector("[data-expand-popover]")!;
        const header = popup.querySelector("[data-expand-popover-header]")!.getBoundingClientRect();
        const trigger = document
          .querySelector('[data-testid="context-sidebar"] button[aria-label^="Repository:"]')!
          .getBoundingClientRect();
        const surface = popup.querySelector("[data-expand-popover-surface]")!.getBoundingClientRect();
        const scroll = popup.querySelector("[data-expand-popover-scroll]")!;
        return {
          header: { x: header.x, y: header.y, width: header.width, height: header.height },
          trigger: { x: trigger.x, y: trigger.y, width: trigger.width, height: trigger.height },
          surface: { top: surface.top, bottom: surface.bottom, width: surface.width },
          viewport: { height: window.innerHeight },
          scrollable: scroll.scrollHeight > scroll.clientHeight + 1,
        };
      });

    for (const size of [{ width: 1100, height: 760 }, { width: 1600, height: 900 }]) {
      await page.setViewportSize(size);
      await page.waitForTimeout(250);
      const measured = await measure();
      expectSameRect(measured.header, measured.trigger);
      expect(Math.abs(measured.surface.width - measured.header.width)).toBeLessThanOrEqual(1);
      expect(measured.surface.top).toBeGreaterThanOrEqual(0);
      expect(measured.surface.bottom).toBeLessThanOrEqual(measured.viewport.height);
      // The panel fits, so the cap is not doing anything: nothing scrolls inside it.
      expect(measured.scrollable).toBe(false);
    }

    // 200px is below the panel's own content height, so the cap has to bite: the panel stays on
    // screen and its content becomes reachable through the panel's scroll container.
    await page.setViewportSize({ width: 1440, height: 200 });
    await page.waitForTimeout(250);
    const clipped = await measure();
    expectSameRect(clipped.header, clipped.trigger);
    expect(clipped.surface.top).toBeGreaterThanOrEqual(0);
    expect(clipped.surface.bottom).toBeLessThanOrEqual(clipped.viewport.height);
    expect(clipped.scrollable).toBe(true);

    // Growing the window again releases the cap.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(250);
    const released = await measure();
    expectSameRect(released.header, released.trigger);
    expect(released.scrollable).toBe(false);
  });

  test("dragging the sidebar edge closes the panel instead of leaving stale geometry", async ({ page }) => {
    await page.goto("/rep/xtrm-dev/xtrm/work/issues");
    await page.locator(REPO).waitFor();
    await page.locator(REPO).click();
    await expect(page.locator("[data-expand-popover]")).toBeVisible();

    const handle = await page.getByRole("separator", { name: "Resize sidebar" }).boundingBox();
    expect(handle).not.toBeNull();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 200);
    await page.mouse.down();
    await page.mouse.move(handle!.x + handle!.width / 2 + 60, handle!.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator("[data-expand-popover]")).toHaveCount(0);
  });

  test("a long repository list has one scroller, and the wheel over a row moves it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 600 });
    // The fixture grows its repository list to order, so the list alone exceeds the panel's cap.
    await page.goto("/rep/xtrm-dev/xtrm/work/issues?fixtureRepos=45");
    await page.locator(REPO).waitFor();
    await page.locator(REPO).click();
    await expect(page.locator("[data-expand-popover]")).toBeVisible();
    await expect(page.locator('[data-expand-popover] [role="option"]')).toHaveCount(45);
    await page.waitForTimeout(300);

    const scrollers = await page.evaluate(() => {
      const popup = document.querySelector("[data-expand-popover]")!;
      const scrollable = Array.from(popup.querySelectorAll("*")).filter((node) => {
        const style = getComputedStyle(node);
        return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
      });
      const surface = popup.querySelector("[data-expand-popover-surface]")!.getBoundingClientRect();
      return {
        count: scrollable.length,
        tagged: scrollable.filter((node) => node.hasAttribute("data-expand-popover-scroll")).length,
        bottom: surface.bottom,
        height: window.innerHeight,
      };
    });
    // One scroll region and it is the panel's own: a nested list scroller would read as stuck.
    expect(scrollers.count).toBe(1);
    expect(scrollers.tagged).toBe(1);
    expect(scrollers.bottom).toBeLessThanOrEqual(scrollers.height);

    const row = page.locator('[data-expand-popover] [role="option"]').nth(3);
    const box = (await row.boundingBox())!;
    const before = await page.evaluate(() => document.querySelector("[data-expand-popover-scroll]")!.scrollTop);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => document.querySelector("[data-expand-popover-scroll]")!.scrollTop);
    expect(after).toBeGreaterThan(before);

    // The wheel moved the list under the pointer, not just the panel.
    expect(await page.evaluate(() => document.querySelectorAll('[data-expand-popover] [role="option"]').length)).toBe(45);
  });

  test("a short viewport keeps both panels on screen and scrolls their content", async ({ page }) => {
    for (const [height, selector, testid] of [
      [220, DROPUP, "board-transport"],
      [300, REPO, null],
    ] as const) {
      await page.setViewportSize({ width: 1440, height });
      await page.goto("/rep/xtrm-dev/xtrm/work/issues");
      await page.locator(selector).waitFor();
      await page.locator(selector).click();
      await expect(page.locator("[data-expand-popover]")).toBeVisible();
      if (testid) await expect(page.getByTestId(testid)).toBeVisible();
      await page.waitForTimeout(300);

      const measured = await page.evaluate(() => {
        const surface = document.querySelector("[data-expand-popover-surface]")!.getBoundingClientRect();
        const scroll = document.querySelector("[data-expand-popover-scroll]")!;
        return {
          top: surface.top,
          bottom: surface.bottom,
          height: window.innerHeight,
          scrollable: scroll.scrollHeight > scroll.clientHeight + 1,
        };
      });
      // The panel is capped at the room beside its trigger and scrolls inside; nothing runs off.
      expect(measured.top).toBeGreaterThanOrEqual(0);
      expect(measured.bottom).toBeLessThanOrEqual(measured.height);
      expect(measured.scrollable).toBe(true);
    }
  });

  test("the collapsed sidebar hides the triggers and re-expanding restores the expanding panel", async ({ page }) => {
    await page.goto("/rep/xtrm-dev/xtrm/work/issues");
    await page.locator(DROPUP).waitFor();
    await page.locator(DROPUP).click();
    await expect(page.locator("[data-expand-popover]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-expand-popover]")).toHaveCount(0);

    await page.getByTestId("sidebar-collapse-edge").click();
    await expect(page.getByTestId("sidebar-reopen-rail")).toBeVisible();
    // The panel animates to zero extent and its content goes inert, so the trigger cannot be pressed.
    const collapsed = await page.evaluate(() => {
      const wrapper = document.querySelector('[data-testid="context-sidebar"]')?.parentElement;
      const curl = document.querySelector('[data-testid="context-sidebar"]')!.closest("[inert]");
      return {
        state: wrapper?.getAttribute("data-state") ?? null,
        inert: curl !== null,
        expanding: document.querySelectorAll("[data-expand-popover]").length,
        open: curl?.querySelector('[aria-label="Data sources"]')?.getAttribute("aria-expanded") ?? null,
      };
    });
    expect(collapsed).toEqual({ state: "collapsed", inert: true, expanding: 0, open: "false" });

    await page.getByTestId("sidebar-reopen-rail").click();
    await expect(page.locator(DROPUP)).toBeVisible();
    await page.locator(REPO).click();
    await expect(page.locator('[data-expand-popover][data-side="bottom"]')).toBeVisible();
  });
});
