import { expect, test, type Page } from "@playwright/test";
import { shotPath } from "./shots.ts";

// Review screenshots of the Workers tree and the Follow-ups list (XTRM-819), light and dark.
// The dispatch graph comes from the substrate fixture, the board records from the status-board
// fixture: one chain (console-lead -> board-worker -> test-engineer), one worker whose binding
// has no dispatcher, and one board worker the graph does not mention. The unknown-dispatcher
// group starts collapsed (XTRM-912), so every assertion inside it opens the group first.
const SHOTS = "project-workers";

async function theme(page: Page, value: "light" | "dark") {
  await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), value);
}

for (const t of ["light", "dark"] as const) {
  test(`project workers (${t})`, async ({ page }, testInfo) => {
    await theme(page, t);

    await page.goto("/rep/mercury/market-data/project/workers");
    await expect(page.getByRole("region", { name: "Workers" })).toBeVisible();
    await expect(page.getByTestId("workers-tree")).toBeVisible();
    await expect(page.getByTestId("graph-count")).toBeVisible();
    await page.screenshot({ path: shotPath(testInfo, SHOTS, `${t}-tree.png`) });

    // The unknown-dispatcher group is part of the tree, not a separate mode: collapsed by default,
    // counted in its header, and opened by the operator.
    const unknown = page.getByRole("region", { name: "Unknown dispatcher" });
    await expect(unknown).toBeVisible();
    const toggle = unknown.getByTestId("workers-unknown-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toContainText(/unknown dispatcher \(\d+\)/);
    await expect(unknown.getByTestId("worker-row")).toHaveCount(0);
    await toggle.click();
    await expect(unknown.getByTestId("worker-orphan").first()).toBeVisible();
    await unknown.screenshot({ path: shotPath(testInfo, SHOTS, `${t}-unknown-dispatcher.png`) });

    const region = page.getByRole("region", { name: "Workers" });
    await region.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByTestId("workers-list")).toBeVisible();
    await region.getByRole("checkbox", { name: "Include archived workers" }).check();
    await expect(page.getByTestId("workers-count")).toBeVisible();
    await page.screenshot({ path: shotPath(testInfo, SHOTS, `${t}-list-including-archived.png`) });

    await page.goto("/rep/mercury/market-data/project/followups");
    await expect(page.getByRole("region", { name: "Follow-ups", exact: true })).toBeVisible();
    await expect(page.getByTestId("followup-row").first()).toBeVisible();
    await page.screenshot({ path: shotPath(testInfo, SHOTS, `${t}-followups.png`) });
  });
}

/**
 * The deployed shapes XTRM-912 fixed, measured in a real browser (jsdom computes no layout):
 * a worker that delivered five PRs, sessions whose only graph name is a session UUID, and the
 * header's omitted-binding sentence. The probe page mounts the real app on the same fixture.
 */
test("live-shaped rows never exceed their box, a five-PR trail collapses, and a nameless session names its issue", async ({ page }, testInfo) => {
  await page.goto("/src/project/workers/layout-probe.html");
  await expect(page.getByTestId("workers-tree")).toBeVisible();
  await expect(page.getByTestId("graph-count")).toContainText("the graph read is capped, so 1289 bindings are not shown");

  // Five PRs on one node: the first key stays, the rest collapse into +N with the full list behind it.
  const trail = page.getByTestId("worker-pr-trail").first();
  await expect(trail).toContainText("#637");
  await expect(trail).not.toContainText("#1604");
  const more = trail.getByRole("button", { name: "4 more pull requests" });
  await expect(more).toHaveText("+4");
  await more.click();
  await expect(page.locator('[aria-label="Pull request #1604, unknown"]')).toBeVisible();
  await page.keyboard.press("Escape");

  // A session with no human name shows its issue key and title; the UUID stays in the tooltip.
  const session = page.getByTestId("worker-row").filter({ hasText: "Contextual sidebar reopen rail (B1)" });
  await expect(session).toHaveAttribute("data-kind", "session");
  await expect(session.getByTestId("worker-name")).toHaveAttribute("title", "01a1d9f5-9bb7-77d7-92a7-b5041c46717b");
  await expect(session.getByTestId("worker-name")).not.toContainText("01a1d9f5-9bb7-77d7-92a7-b5041c46717b");

  // A participant name as long as the live ones truncates inside the row instead of widening it.
  const longLead = page.getByTestId("worker-row").filter({ hasText: "MMD-5007-stable-hotfixes-and-retention-release-lane-lead" });
  await expect(longLead).toBeVisible();

  const rows = page.locator("[data-testid=worker-row], [data-testid=worker-orphan]");
  const overflow = async (width: number) => {
    const wide = await rows.evaluateAll((elements) =>
      elements
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => ({ text: (el.textContent ?? "").slice(0, 90), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })),
    );
    expect(wide, `rows wider than their box at ${width}px`).toEqual([]);
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await overflow(1440);
  await page.setViewportSize({ width: 1280, height: 900 });
  await overflow(1280);
  await page.screenshot({ path: shotPath(testInfo, SHOTS, "light-live-shape-1280.png") });

  // Opening the collapsed group must not reintroduce the overflow: its UUID sessions are rows too.
  const toggle = page.getByTestId("workers-unknown-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByTestId("workers-unknown")).toContainText("Inspector Drawer state machine and URL restore");
  await overflow(1280);
  await page.screenshot({ path: shotPath(testInfo, SHOTS, "light-live-shape-unknown-open.png") });
});

/**
 * XTRM-936 SUCCESS names "survives a 12px root", and a rebase can silently break it: a px indent
 * measured once at 16px looks correct in jsdom and in a 16px run. This measures the row's own
 * authored `--row-indent` (rem, 1.25rem per depth) against the root it is rendered at, at both
 * the default root and the operator's 12px root, so a px indent — or a px-authored var — fails
 * here instead of shipping.
 */
test("the workers tree indent resolves its rem expression at the operator's root", async ({ page }) => {
  await page.goto("/rep/mercury/market-data/project/workers");
  await expect(page.getByTestId("workers-tree")).toBeVisible();
  await expect(page.getByTestId("worker-row").first()).toBeVisible();

  const measure = () =>
    page.evaluate(() => {
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="worker-row"]'));
      return {
        root,
        rows: rows.map((row) => {
          const lead = row.firstElementChild as HTMLElement | null;
          return {
            authored: getComputedStyle(row).getPropertyValue("--row-indent").trim(),
            padding: lead ? parseFloat(getComputedStyle(lead).paddingLeft) : Number.NaN,
          };
        }),
      };
    });

  const setRoot = async (value: string) => {
    await page.evaluate((root) => {
      document.documentElement.style.fontSize = root;
    }, value);
    await page.waitForTimeout(150);
  };

  const at16 = await measure();
  expect(at16.root).toBe(16);
  // The fixture chain is console-lead -> board-worker -> test-engineer, so depth 1 and 2 exist.
  // Without them the assertion would pass on an all-zero indent and prove nothing.
  const indented16 = at16.rows.filter((row) => parseFloat(row.authored) > 0);
  expect(indented16.length, "rows below the root of the tree").toBeGreaterThanOrEqual(2);

  // The step itself, not just its scaling: every line above passes for a row indented by the
  // wrong number of rems that happens to scale with the root, which is the obvious way to break
  // this test while breaking the layout. One level is INDENT_REM (`src/issues/issue-table.ts:134`,
  // 1.25rem) and every authored value is a multiple of it. This literal is the one copied number
  // here, deliberately: it pins the geometry the resolved-value assertions cannot see, and a change
  // to INDENT_REM is a contract change that should fail loudly rather than pass silently.
  const steps = [...new Set(at16.rows.map((row) => parseFloat(row.authored)))].filter((step) => step > 0).sort((a, b) => a - b);
  expect(steps[0], "one level of indentation").toBe(1.25);
  for (const step of steps) {
    expect(Math.abs(step / 1.25 - Math.round(step / 1.25)), `${step}rem is a multiple of one level`).toBeLessThan(1e-9);
  }

  for (const row of at16.rows) {
    expect(row.authored, "the indent is authored in rem").toMatch(/^\d+(\.\d+)?rem$/);
    expect(row.padding, `padding of ${row.authored} at a ${at16.root}px root`).toBeCloseTo(
      parseFloat(row.authored) * at16.root,
      1,
    );
  }

  await setRoot("12px");
  const at12 = await measure();
  expect(at12.root).toBe(12);
  expect(at12.rows.length).toBe(at16.rows.length);
  at12.rows.forEach((row, i) => {
    const sixteen = at16.rows[i]!;
    expect(row.authored, "the authored expression does not change with the root").toBe(sixteen.authored);
    expect(row.padding, `padding of ${row.authored} at a 12px root`).toBeCloseTo(parseFloat(row.authored) * 12, 1);
    if (parseFloat(row.authored) > 0) {
      // A px indent keeps its pixels at 12px; a rem indent shrinks by exactly the root ratio.
      expect(row.padding, "the indent tracks the root").toBeLessThan(sixteen.padding);
      expect(row.padding / sixteen.padding).toBeCloseTo(0.75, 2);
    }
  });
});
