import { expect, test, type Page } from "@playwright/test";

/**
 * XTRM-943: the board's five columns were five cards. Each column carried `rounded-lg border
 * bg-deep/40`, which reads as five floating panels inside a pane that already has an edge, and each
 * card carried `bg-surface` so a card punched a hole in a lane that painted its own fill.
 *
 * The claim this spec pins is a shape, not a taste: a lane is a *lane*, separated from its neighbour
 * by the one hairline the surrounding system uses (`border-border-muted`), and a card is a hairline
 * box with no fill. Measured in Chromium in both themes, because `bg-deep/40` and
 * `border-border-muted` are tokens whose values are theme-dependent and jsdom resolves neither.
 */

const REPO = "xtrm-dev/xtrm";

async function openBoard(page: Page, theme: "light" | "dark") {
  await page.goto(`/rep/${REPO}/work/issues`);
  await page.getByRole("radio", { name: "Board" }).waitFor();
  await page.getByRole("radio", { name: "Board" }).click();
  await page.locator('[data-testid="issue-board"]').waitFor();
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  // The theme attribute drives a class-level token set; give the recalc a frame.
  await page.waitForTimeout(150);
}

/** Column and card geometry as the browser resolved it. */
function boardGeometry() {
  const box = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
  const style = (el: Element | null, prop: string) => (el ? getComputedStyle(el)[prop] : null);
  const columns = [...document.querySelectorAll('[data-testid^="board-column-"]')];
  const lane = columns[1] ?? columns[0] ?? null;
  const card = lane?.querySelector('[data-testid="board-card"]') ?? null;
  const heading = lane?.querySelector("h3, h4") ?? null;
  const title = card?.querySelector("p") ?? null;
  const first = columns[0] ?? null;
  const neighbour = columns[1] ?? null;
  return {
    columns: columns.length,
    lane: {
      borderLeft: style(lane, "borderLeftWidth"),
      borderTop: style(lane, "borderTopWidth"),
      radius: style(lane, "borderTopLeftRadius"),
      background: style(lane, "backgroundColor"),
      paddingLeft: style(lane, "paddingLeft"),
    },
    firstLane: { borderLeft: style(first, "borderLeftWidth") },
    gapBetweenLanes:
      first && neighbour
        ? Math.round(neighbour.getBoundingClientRect().x - first.getBoundingClientRect().right)
        : null,
    card: {
      radius: style(card, "borderTopLeftRadius"),
      border: style(card, "borderTopWidth"),
      background: style(card, "backgroundColor"),
    },
    heading: {
      fontSize: style(heading, "fontSize"),
      color: style(heading, "color"),
      x: box(heading)?.x ?? null,
    },
    titleX: box(title)?.x ?? null,
  };
}

for (const theme of ["light", "dark"] as const) {
  test(`the board is lanes, not five cards (${theme})`, async ({ page }) => {
    await openBoard(page, theme);
    const g = await page.evaluate(boardGeometry);

    // A lane owns one hairline on its leading edge and no frame of its own: no radius, no fill, no
    // top rule. This is the finding — five `rounded-lg border bg-deep/40` boxes are gone.
    expect(g.columns, "the fixture renders five lanes").toBe(5);
    expect(g.lane.borderLeft, "a lane is separated by a hairline, not a box").toBe("1px");
    expect(g.lane.borderTop, "a lane has no frame of its own").toBe("0px");
    expect(g.lane.radius, "a lane is not rounded").toBe("0px");
    expect(g.lane.background, "a lane paints no fill").toBe("rgba(0, 0, 0, 0)");
    // The rule belongs *between* lanes: the first lane has none, or the board would be boxed again.
    expect(g.firstLane.borderLeft, "the first lane owns no leading rule").toBe("0px");
    expect(g.gapBetweenLanes, "the hairline, not a gutter, is the separation").toBe(0);

    // One card dialect: the hairline box the issue surfaces already use, and no fill, so a card
    // sitting in a lane does not punch a hole through it.
    expect(g.card.radius, "a card keeps the shipped 8px radius").toBe("8px");
    expect(g.card.border, "a card is a hairline box").toBe("1px");
    expect(g.card.background, "a card no longer paints bg-surface").toBe("rgba(0, 0, 0, 0)");

    // The caps header step: the section step (0.72rem), not body copy, and the header's gutter is
    // the card's, so a lane name starts on the same x as the card titles it names.
    expect(g.heading.fontSize, "the lane header is the section step").toBe("11.52px");
    expect(
      Math.abs((g.heading.x ?? 0) - (g.titleX ?? 0)) <= 1,
      `the lane header starts on the card titles' x (heading ${g.heading.x}, title ${g.titleX})`,
    ).toBe(true);
  });
}

/**
 * XTRM-943: the drop affordance. A lane has no ring to paint, so the affordance is the hairline
 * turning accent plus a faint accent fill — the `over === column.id` branch of the lane class list.
 *
 * Named limit, and the reason this test is written the way it is: a *native* drag cannot reach that
 * branch in this harness. `page.mouse` down/move/up and `locator.dragTo` both leave the border at
 * `border-border-muted` (measured: `rgba(15, 15, 20, 0.07)` before, during and after, three
 * attempts), because Playwright only synthesizes HTML5 drag events while DragEvent interception is
 * enabled and the fixture's React handlers never see a `dragover` otherwise. A synthetic
 * `DragEvent("dragover")` dispatched from `page.evaluate` does reach React, but only once the
 * `dragstart` on the card has been given a task boundary to commit its state: in the same evaluate
 * the lane class list stays unchanged, one `requestAnimationFrame` later it carries
 * `border-l-accent/60 bg-accent-soft/40`. What would make a native drag testable here is drag
 * interception in this project's Playwright config; until then this test drives the contract
 * (dragover sets the accent, drop clears it) rather than the pointer pipeline.
 */
for (const theme of ["light", "dark"] as const) {
  test(`the hovered lane takes the accent affordance (${theme})`, async ({ page }) => {
    await openBoard(page, theme);
    const lane = page.locator('[data-testid^="board-column-"]').nth(3);
    const read = () =>
      lane.evaluate((el) => {
        const s = getComputedStyle(el);
        return { border: s.borderLeftColor, background: s.backgroundColor, cls: el.className };
      });

    const rest = await read();
    expect(rest.cls, "the lane rests on the muted hairline").not.toContain("border-l-accent");

    const settled = await page.evaluate(async () => {
      const card = document.querySelector('[data-testid="board-card"]')!;
      const target = document.querySelectorAll('[data-testid^="board-column-"]')[3] as Element;
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      // The card's dragstart sets React state; the lane handler needs that committed first.
      await frame();
      await frame();
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      await frame();
      await frame();
      const s = getComputedStyle(target);
      return { border: s.borderLeftColor, background: s.backgroundColor, cls: target.className };
    });
    expect(settled.cls, "dragover turns the lane's hairline accent").toContain("border-l-accent/60");
    expect(settled.border, "the accent hairline is resolved, not just a class").toMatch(/^oklab\(/);
    expect(settled.background, "the lane takes a faint accent fill").toMatch(/^oklab\(/);

    // Drop clears it again, so the affordance is not sticky.
    const dropped = await page.evaluate(async () => {
      const target = document.querySelectorAll('[data-testid^="board-column-"]')[3] as Element;
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
      await frame();
      await frame();
      const cls = target.className;
      // The lane carries transition-colors, so the resolved colour lags the class by a fade.
      await new Promise((r) => setTimeout(r, 400));
      return { cls, border: getComputedStyle(target).borderLeftColor };
    });
    expect(dropped.cls, "drop drops the accent class").not.toContain("border-l-accent");
    expect(dropped.border, "drop returns the lane to the muted hairline").not.toMatch(/^oklab\(/);
  });
}
