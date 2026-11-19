import { expect, test, type Page } from "@playwright/test";

/**
 * XTRM-897: one scale for the console. The type tokens are rem (`body` takes `--text-sm` =
 * 0.8125rem), so the sub-section rows added by XTRM-854/855/856/860/861 must name those tokens and
 * the glyphs must be sized in the same unit. The operator runs the console at a root font size below
 * 16px, where a hard-coded 13px child rendered 1.33x its 9.75px parent rows and a 16px filter glyph
 * sat beside 8.64px toolbar text.
 *
 * jsdom cannot resolve rem or lay out a box (`src/ui/scale.test.tsx` guards the classes), so the
 * measurement of computed font size and rendered glyph box lives here. The screenshots written at
 * the end are the evidence the lead compares with the operator's.
 */

const REPO = "xtrm-dev/xtrm";
const OUT = "docs/screenshots/ui-scale";
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
  const main = document.querySelector('[data-testid="primary-region"]') as HTMLElement;
  const button = (name: string) => main.querySelector(`button[aria-label="${name}"]`);
  const primary = Array.from(main.querySelectorAll<HTMLButtonElement>("button")).find((el) => el.textContent?.trim() === "New issue");
  return {
    root: getComputedStyle(document.documentElement).fontSize,
    parent: {
      label: type(parent.querySelector("span.truncate")!),
      x: round(parent.querySelector("span.truncate")!.getBoundingClientRect().x),
    },
    child: {
      label: type(child.querySelector("span.truncate")!),
      x: round(child.querySelector("span.truncate")!.getBoundingClientRect().x),
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
    // The child is a sub-destination: same size, lighter weight, never the parent's semibold.
    expect(Number(metrics.child.label.weight)).toBeLessThan(Number(metrics.parent.label.weight));
    // The aligned label column survives the root size, so the two rows cannot drift apart.
    expect(Math.abs(metrics.child.x - metrics.parent.x)).toBeLessThanOrEqual(1);
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
    await page.addInitScript((value) => localStorage.setItem("xtrm.console.theme.v1", value), theme);
    for (const [root, tag] of [
      ["16px", "root16"],
      [OPERATOR_ROOT, "root12"],
    ] as const) {
      await openSidebar(page);
      await setRoot(page, root);
      await page.getByTestId("context-sidebar").screenshot({ path: `${OUT}/after-${theme}-${tag}-sidebar.png` });

      await openIssues(page);
      await setRoot(page, root);
      const box = (await page.getByTestId("primary-region").boundingBox())!;
      await page.screenshot({
        path: `${OUT}/after-${theme}-${tag}-issues-toolbar.png`,
        clip: { x: box.x, y: box.y, width: Math.min(box.width, 1100), height: 96 },
      });
    }
  });
}
