import { expect, test, type Page } from "@playwright/test";

// XTRM-978: the comparison grid is a fixed `h-8` header row over `min-h-8` metric rows, and the row
// carried `overflow-hidden`. On a row that is allowed to grow that clip has no vertical work to do —
// but it does clip horizontally, so a metric row hid its own body text instead of letting the row
// grow and the cell wrap. The clip belongs to the fixed-height header, where a wrapped cell really
// would paint over the next row (XTRM-950 measures that case).
//
// jsdom resolves no layout, so `src/app/research.test.tsx` can only reach the classes; this spec is
// where the claim is measurable. It reports the numbers per width and theme, and asserts zero.

const WIDTHS = [440, 420, 400, 380] as const;

async function open(page: Page, theme: "light" | "dark", width: number) {
  await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), theme);
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/research/compare?baseline=run-a&candidate=run-b");
  await expect(page.getByRole("table", { name: "Metric comparison" })).toBeVisible();
  await expect(page.locator('[role="table"] [role="row"]').nth(1)).toBeVisible();
}

/** Hidden body text inside metric rows, split by whether the reader can reach it.
 *
 * For every text box in a metric row: find the nearest ancestor that clips horizontally, and measure
 * how much of the box falls outside it. That ancestor decides the verdict:
 *  - a SROLLABLE one (its own content is wider than its box and its `overflow-x` is auto/scroll) lets
 *    the reader reach the text, so it is overflow, not loss;
 *  - a non-scrollable one (`overflow-hidden`) destroys the text, which is the defect XTRM-978 fixes.
 * The clip is found by measurement, not by matching class names.
 */
async function hiddenPixels(page: Page) {
  return page.evaluate(() => {
    const table = document.querySelector('[role="table"]');
    if (!table) return { clipped: 0, scrollable: 0, samples: [] as string[], metricRows: 0 };

    const rows = Array.from(table.querySelectorAll('[role="row"]')) as HTMLElement[];
    const metricRows = rows.filter((row) => row.querySelector('[role="columnheader"]') === null);

    let clipped = 0;
    let scrollable = 0;
    const samples: string[] = [];

    const clipper = (element: Element): { box: DOMRect; scrolls: boolean } => {
      // The row itself counts: `overflow-hidden` ON the row is the defect being measured.
      let node: Element | null = element;
      while (node && node !== document.body) {
        const style = getComputedStyle(node);
        if (style.overflowX !== "visible") {
          const scrolls = node.scrollWidth > node.clientWidth + 1 && (style.overflowX === "auto" || style.overflowX === "scroll");
          return { box: node.getBoundingClientRect(), scrolls };
        }
        node = node.parentElement;
      }
      return { box: document.documentElement.getBoundingClientRect(), scrolls: false };
    };

    for (const row of metricRows) {
      const { box, scrolls } = clipper(row);
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (!node.textContent || node.textContent.trim() === "") continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width === 0) continue;
          const visible = Math.max(Math.min(rect.right, box.right) - Math.max(rect.left, box.left), 0);
          const hidden = rect.width - visible;
          if (hidden <= 0.5) continue;
          if (scrolls) scrollable += hidden;
          else {
            clipped += hidden;
            samples.push(`${node.textContent.trim().slice(0, 20)} -${hidden.toFixed(0)}px`);
          }
        }
      }
    }

    return { clipped: Math.round(clipped), scrollable: Math.round(scrollable), samples: samples.slice(0, 6), metricRows: metricRows.length };
  });
}

test("reports clipped body text at the four widths, both themes", async ({ page }) => {
  test.setTimeout(180_000);
  const measured: string[] = [];
  for (const theme of ["light", "dark"] as const) {
    for (const width of WIDTHS) {
      await open(page, theme, width);
      const result = await hiddenPixels(page);
      const rowClips = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[role="table"] [role="row"]')) as HTMLElement[];
        const metric = rows.filter((row) => row.querySelector('[role="columnheader"]') === null);
        return metric.length > 0 && metric.every((row) => ["hidden", "clip"].includes(getComputedStyle(row).overflowX));
      });
      measured.push(`XTRM-978 ${theme} ${width}px: clipped=${result.clipped}px scrollable=${result.scrollable}px rows=${result.metricRows} rowClips=${rowClips}`);
      expect(result.metricRows, "the comparison renders metric rows at every width").toBeGreaterThan(0);
    }
  }
  for (const line of measured) console.log(line);
});

for (const theme of ["light", "dark"] as const) {
  for (const width of WIDTHS) {
    test(`a metric row does not clip its own body text (${theme}, ${width}px)`, async ({ page }) => {
      await open(page, theme, width);
      const result = await hiddenPixels(page);
      expect(result.clipped, `clipped body text at ${width}px ${theme}: ${result.samples.join(", ")}`).toBe(0);

      // Removing the clip must not cost the header its column step: every header cell still starts
      // at the same x as the metric cell under it.
      const steps = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('[role="table"] [role="row"]')) as HTMLElement[];
        const header = rows.find((row) => row.querySelector('[role="columnheader"]') !== null)!;
        const metric = rows.find((row) => row.querySelector('[role="columnheader"]') === null)!;
        const xs = (row: HTMLElement) => Array.from(row.children).map((cell) => Math.round(cell.getBoundingClientRect().x));
        const headerX = xs(header);
        const metricX = xs(metric);
        const offsets = headerX.map((x, i) => x - (metricX[i] ?? x));
        return { headerX, metricX, offsets, headerClips: getComputedStyle(header).overflowX };
      });
      expect(steps.headerClips, "the fixed-height header keeps the clip").toBe("hidden");
      for (const offset of steps.offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(1);
    });
  }
}
