import { expect, test, type Page } from "@playwright/test";
import { shots } from "./shots.ts";

// Review screenshots of the Workers tree and the Follow-ups list (XTRM-819), light and dark.
// The dispatch graph comes from the substrate fixture, the board records from the status-board
// fixture: one chain (console-lead -> board-worker -> test-engineer), one worker whose binding
// has no dispatcher, and one board worker the graph does not mention. The unknown-dispatcher
// group starts collapsed (XTRM-912), so every assertion inside it opens the group first.
const shot = shots("WORKERS_SHOTS_DIR");

async function theme(page: Page, value: "light" | "dark") {
  await page.addInitScript((t) => localStorage.setItem("xtrm.console.theme.v1", t), value);
}

for (const t of ["light", "dark"] as const) {
  test(`project workers (${t})`, async ({ page }) => {
    await theme(page, t);

    await page.goto("/rep/mercury/market-data/project/workers");
    await expect(page.getByRole("region", { name: "Workers" })).toBeVisible();
    await expect(page.getByTestId("workers-tree")).toBeVisible();
    await expect(page.getByTestId("graph-count")).toBeVisible();
    await page.screenshot({ path: shot(`${t}-tree.png`) });

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
    await unknown.screenshot({ path: shot(`${t}-unknown-dispatcher.png`) });

    const region = page.getByRole("region", { name: "Workers" });
    await region.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByTestId("workers-list")).toBeVisible();
    await region.getByRole("checkbox", { name: "Include archived workers" }).check();
    await expect(page.getByTestId("workers-count")).toBeVisible();
    await page.screenshot({ path: shot(`${t}-list-including-archived.png`) });

    await page.goto("/rep/mercury/market-data/project/followups");
    await expect(page.getByRole("region", { name: "Follow-ups", exact: true })).toBeVisible();
    await expect(page.getByTestId("followup-row").first()).toBeVisible();
    await page.screenshot({ path: shot(`${t}-followups.png`) });
  });
}

/**
 * The deployed shapes XTRM-912 fixed, measured in a real browser (jsdom computes no layout):
 * a worker that delivered five PRs, sessions whose only graph name is a session UUID, and the
 * header's omitted-binding sentence. The probe page mounts the real app on the same fixture, with
 * the board list shortened the way the deployed read was (XTRM-918), so every session title here
 * comes from the per-ref read.
 */
test("live-shaped rows never exceed their box, a five-PR trail collapses, and a nameless session names its issue", async ({ page }) => {
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
  /**
   * A row that stays inside its own box can still clip its contents: `overflow-hidden` on a cell cuts
   * whatever the cell's own children paint past it (review of #454-#457, XTRM-918). So the row box is
   * not enough — every descendant with a box of its own must also end inside the row, and no descendant
   * may scroll sideways outside it. A truncated run is inside its box by design; a clipped one is not.
   */
  const overflow = async (width: number) => {
    const wide = await rows.evaluateAll((elements) =>
      elements.flatMap((row) => {
        const box = row.getBoundingClientRect();
        const label = (row.textContent ?? "").slice(0, 60);
        const bad: string[] = [];
        if (row.scrollWidth > row.clientWidth + 1) bad.push(`${label}: row scrolls ${row.scrollWidth} in ${row.clientWidth}`);
        for (const el of Array.from(row.querySelectorAll("*"))) {
          const b = el.getBoundingClientRect();
          if (b.width === 0) continue;
          if (b.right > box.right + 1 || b.left < box.left - 1) {
            const where = `${Math.round(b.left)}..${Math.round(b.right)} outside ${Math.round(box.left)}..${Math.round(box.right)}`;
            bad.push(`${label}: ${el.getAttribute("data-testid") ?? el.tagName} paints ${where}`);
          }
        }
        return bad;
      }),
    );
    expect(wide, `row contents painted outside the row box at ${width}px`).toEqual([]);
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await overflow(1440);
  await page.setViewportSize({ width: 1280, height: 900 });
  await overflow(1280);
  await page.screenshot({ path: shot(`light-live-shape-1280.png`) });

  // Opening the collapsed group must not reintroduce the overflow: its UUID sessions are rows too.
  const toggle = page.getByTestId("workers-unknown-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByTestId("workers-unknown")).toContainText("Inspector Drawer state machine and URL restore");
  await overflow(1280);
  await page.screenshot({ path: shot(`light-live-shape-unknown-open.png`) });
});
