import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { capture, MAX_DOMINANT, MIN_COLOURS, profile } from "./scale-capture.ts";

/**
 * XTRM-897: one scale for the console. The type tokens are rem (`body` takes `--text-sm` =
 * 0.8125rem), so the sub-section rows added by XTRM-854/855/856/860/861 must name those tokens and
 * the glyphs must be sized in the same unit. The operator runs the console at a root font size below
 * 16px, where a hard-coded 13px child rendered 1.33x its 9.75px parent rows and a 16px filter glyph
 * sat beside 8.64px toolbar text.
 *
 * XTRM-907: the section header was the last px font size (`text-[11px]`), which made it the largest
 * text in the sidebar at the operator's root; the spec now measures it too.
 *
 * jsdom cannot resolve rem or lay out a box (`src/ui/scale.test.tsx`, `src/ui/units.test.ts` guard
 * the classes and the literals), so the measurement of computed font size and rendered glyph box
 * lives here.
 *
 * Screenshots go to the test's own output dir (e2e/.results, gitignored) so a routine run cannot
 * dirty the tracked evidence. The committed set under docs/screenshots/ui-scale is produced on
 * purpose: `SCALE_SHOTS_DIR=docs/screenshots/ui-scale SCALE_PHASE=after npx playwright test -g "scale screenshots"`.
 */

const REPO = "xtrm-dev/xtrm";
/** Export directory for the committed evidence; unset means the test's output dir. */
const EXPORT_DIR = process.env.SCALE_SHOTS_DIR;
/** `before` = the pre-XTRM-897 sources, `after` = the current tree. */
const PHASE = process.env.SCALE_PHASE ?? "after";
/** The operator's environment: a browser default font size of 12px, reproduced with a root override. */
const OPERATOR_ROOT = "12px";

const METRICS = () => {
  const round = (value: number) => Math.round(value * 100) / 100;
  const type = (el: Element) => {
    const style = getComputedStyle(el as HTMLElement);
    return { font: round(parseFloat(style.fontSize)), lineHeight: round(parseFloat(style.lineHeight)), weight: style.fontWeight };
  };
  const glyph = (el: Element | null | undefined) => {
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return { width: round(box.width), height: round(box.height) };
  };
  const sidebar = document.querySelector('[data-testid="context-sidebar"]') as HTMLElement;
  const rows = Array.from(sidebar.querySelectorAll<HTMLElement>('[role="button"]'));
  const parent = rows.find((row) => row.textContent?.trim().startsWith("Project"))!;
  const child = rows.find((row) => row.textContent?.trim() === "Overview")!;
  // The rail's weight ladder needs both ends: the selected child carries the state, and an
  // unselected sibling of it must stay under the parent row. The sibling is taken from the same
  // rail group rather than by label, so a renamed destination does not quietly drop the check.
  const rail = child.parentElement!;
  const sibling = Array.from(rail.querySelectorAll<HTMLElement>('[role="button"]')).find((row) => row !== child)!;
  const main = document.querySelector('[data-testid="primary-region"]') as HTMLElement;
  const header = Array.from(sidebar.querySelectorAll<HTMLElement>("button[aria-expanded]")).find((el) =>
    /^(Workspace|GitHub|System)$/.test((el.textContent ?? "").trim()),
  );
  const button = (name: string) => main.querySelector(`button[aria-label="${name}"]`);
  const primary = Array.from(main.querySelectorAll<HTMLButtonElement>("button")).find((el) => el.textContent?.trim() === "New issue");
  return {
    root: getComputedStyle(document.documentElement).fontSize,
    header: header ? type(header) : null,
    parent: {
      label: type(parent.querySelector("span.truncate")!),
      x: round(parent.querySelector("span.truncate")!.getBoundingClientRect().x),
    },
    child: {
      label: type(child.querySelector("span.truncate")!),
      x: round(child.querySelector("span.truncate")!.getBoundingClientRect().x),
    },
    sibling: {
      label: type(sibling.querySelector("span.truncate")!),
    },
    filterGlyph: glyph(button("Filter this list")?.querySelector("svg")),
    existingToolbarGlyph: glyph(primary?.querySelector("svg")),
    toolbarText: (() => {
      const found = Array.from(main.querySelectorAll("button")).find((el) => /^(Status|Order by|New issue)/.test(el.textContent ?? ""));
      return found ? type(found) : null;
    })(),
  };
};

async function setRoot(page: Page, value: string) {
  await page.evaluate((root) => {
    document.documentElement.style.fontSize = root;
  }, value);
  await page.waitForTimeout(150);
}

async function openSidebar(page: Page) {
  await page.goto(`/rep/${REPO}/project/overview`);
  await expect(page.getByTestId("context-sidebar")).toBeVisible();
}

async function openIssues(page: Page) {
  await page.goto(`/rep/${REPO}/work/issues`);
  await expect(page.getByRole("region", { name: "XTRM Issues" })).toBeVisible();
}

for (const root of ["16px", OPERATOR_ROOT]) {
  test(`a sidebar sub-section label keeps its parent's scale at a ${root} root`, async ({ page }) => {
    await openSidebar(page);
    await setRoot(page, root);
    const metrics = await page.evaluate(METRICS);

    expect(metrics.root).toBe(root);
    // The reported defect: the child label rendered larger than the row that owns it.
    expect(metrics.child.label.font).toBeLessThanOrEqual(metrics.parent.label.font);
    expect(metrics.child.label.font).toBe(metrics.parent.label.font);
    expect(metrics.child.label.lineHeight).toBe(metrics.parent.label.lineHeight);
    // The child is a sub-destination: same size as the parent row, in both states.
    expect(Number(metrics.sibling.label.font)).toBe(metrics.parent.label.font);
    expect(Number(metrics.sibling.label.lineHeight)).toBe(metrics.parent.label.lineHeight);
    // The rail's weight ladder (XTRM-927): an unselected child stays lighter than the row that owns
    // it, and the selected child carries that row's semibold so the state reads without colour.
    expect(Number(metrics.parent.label.weight)).toBe(600);
    expect(Number(metrics.sibling.label.weight)).toBeLessThan(Number(metrics.parent.label.weight));
    expect(Number(metrics.child.label.weight)).toBe(600);
    // The aligned label column survives the root size, so the two rows cannot drift apart.
    expect(Math.abs(metrics.child.x - metrics.parent.x)).toBeLessThanOrEqual(1);
    // XTRM-907: the section header is a step below the row label, never the largest text here.
    expect(metrics.header).not.toBeNull();
    expect(metrics.header!.font).toBeLessThan(metrics.parent.label.font);
  });

  test(`the toolbar filter glyph uses the toolbar scale at a ${root} root`, async ({ page }) => {
    await openIssues(page);
    await setRoot(page, root);
    const metrics = await page.evaluate(METRICS);

    expect(metrics.filterGlyph).not.toBeNull();
    expect(metrics.existingToolbarGlyph).not.toBeNull();
    // One glyph scale inside a toolbar: the local filter is not a step larger than `New issue`.
    expect(metrics.filterGlyph!.height).toBe(metrics.existingToolbarGlyph!.height);
    expect(metrics.filterGlyph!.width).toBe(metrics.existingToolbarGlyph!.width);
    // And the glyph tracks the text it sits beside instead of outgrowing it.
    expect(metrics.toolbarText).not.toBeNull();
    expect(metrics.filterGlyph!.height).toBeLessThanOrEqual(metrics.toolbarText!.font * 1.1 + 0.5);
  });
}

for (const theme of ["dark", "light"] as const) {
  test(`scale screenshots (${theme})`, async ({ page }) => {
    test.setTimeout(90_000);
    const output = test.info().outputPath();
    const shot = (tag: string, surface: string) =>
      EXPORT_DIR ? join(EXPORT_DIR, `${PHASE}-${theme}-${tag}-${surface}.png`) : join(output, `${theme}-${tag}-${surface}.png`);

    await page.addInitScript((value) => localStorage.setItem("xtrm.console.theme.v1", value), theme);
    for (const [root, tag] of [
      ["16px", "root16"],
      [OPERATOR_ROOT, "root12"],
    ] as const) {
      await openSidebar(page);
      await setRoot(page, root);
      const sidebarShot = shot(tag, "sidebar");
      await page.getByTestId("context-sidebar").screenshot({ path: sidebarShot });
      await capture(page, sidebarShot);

      await openIssues(page);
      await setRoot(page, root);
      const box = (await page.getByTestId("primary-region").boundingBox())!;
      const toolbarShot = shot(tag, "issues-toolbar");
      await page.screenshot({
        path: toolbarShot,
        clip: { x: box.x, y: box.y, width: Math.min(box.width, 1100), height: 96 },
      });
      await capture(page, toolbarShot);
    }
  });
}

test.describe("the capture gate", () => {
  test("rejects a blank capture", async ({ page }) => {
    // The defect that reached review: a 264x900 region captured as one flat fill.
    const path = join(test.info().outputPath(), "blank.png");
    await page.setContent('<div style="width:264px;height:900px;background:#232323"></div>');
    await page.locator("div").screenshot({ path });
    await expect(capture(page, path)).rejects.toThrow();
  });

  test("reads a flat image as a single dominant colour", async ({ page }) => {
    const dataUrl = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 264;
      canvas.height = 900;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#232323";
      context.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    });
    const { colours, dominant } = await profile(page, dataUrl);
    expect(colours).toBe(1);
    expect(colours).toBeLessThanOrEqual(MIN_COLOURS);
    expect(dominant).toBeGreaterThanOrEqual(MAX_DOMINANT);
  });
});
