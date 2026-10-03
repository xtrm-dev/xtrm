import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { log, startPi, type RealHostState } from "./harness.ts";

// XTRM-615 validation against a real host. A reply with one number per line renders one line per
// number (soft breaks are line breaks in assistant replies). While the live stream is down (Playwright
// offline emulation, as in stream-resync.spec.ts) the composer disables send, steer, follow-up and stop
// and says why; they re-enable once the stream reconnects.
const OUT = "docs/screenshots/agent-half/real-host";
const NAME = "breaks-pi";
const SHORT = "Reply with the numbers 1 to 5, one number per line, nothing else: no list markers, no blank lines, no other text.";
// Long enough to still be working after the offline window, the screenshots and the reconnect; Stop ends it.
const LONG = "Count from 1 to 3000, one number per line, no other text.";
const state = () => JSON.parse(process.env.XTRM_REAL_HOST_STATE!) as RealHostState;
const composer = (page: Page) => page.getByRole("textbox", { name: `Message ${NAME}` });

/** Light and dark screenshots without a reload (the page may be offline). */
async function shoot(page: Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  for (const t of ["light", "dark"] as const) {
    await page.evaluate((v) => (document.documentElement.dataset.theme = v), t);
    // Colors transition on a theme change: finish them before the capture.
    await page.screenshot({ path: `${OUT}/xtrm-615-${t}-${name}.png`, animations: "disabled" });
  }
}

async function prompt(page: Page, text: string) {
  await composer(page).fill(text);
  const submitted = page.waitForResponse((r) => r.url().endsWith("/xtrm-api/agent-host/api/v1/submit"));
  await composer(page).press("Enter");
  expect(((await (await submitted).json()) as { status: string }).status).toBe("accepted");
}

test("a one-number-per-line reply keeps its lines, and the composer is disabled while the stream is down", async ({ page, context }) => {
  test.setTimeout(600_000);
  const s = state();
  page.on("console", (m) => m.type() === "error" && log(s, `browser console: ${m.text()}`));
  const id = await startPi(s, NAME);
  log(s, `xtrm-615 pi session ${id}`);

  await page.goto(`/agent/${id}`);
  await expect(page.getByTestId("session-header")).toContainText(NAME, { timeout: 30_000 });
  await expect(page.getByTestId("stream-state")).toHaveAttribute("data-stream", "connected");

  // Line breaks: five single-newline lines render as five lines in one paragraph.
  await prompt(page, SHORT);
  const first = page.getByTestId("frame").last();
  await expect(first).toHaveAttribute("data-frame-status", "settled", { timeout: 180_000 });
  const reply = first.locator(".xtrm-prose");
  await expect(reply).toBeVisible();
  const shape = await reply.evaluate((el) => ({
    paragraphs: el.querySelectorAll("p").length,
    breaks: el.querySelectorAll("p br").length,
    lines: (el as HTMLElement).innerText.split("\n").map((l) => l.trim()).filter(Boolean),
  }));
  log(s, `xtrm-615 reply shape ${JSON.stringify(shape)}`);
  expect(shape).toEqual({ paragraphs: 1, breaks: 4, lines: ["1", "2", "3", "4", "5"] });
  await shoot(page, "1-reply-lines");

  // Disconnected composer: a working Frame, then the stream drops.
  await prompt(page, LONG);
  const second = page.getByTestId("frame").last();
  await expect(second).toHaveAttribute("data-frame-status", "working", { timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Stop" })).toBeEnabled();

  await context.setOffline(true);
  log(s, "xtrm-615 stream dropped (browser offline) while the Frame works");
  await expect(page.getByTestId("stream-state")).toHaveAttribute("data-stream", "disconnected", { timeout: 5_000 });
  await composer(page).fill("one more thing");
  const controls = [
    page.getByRole("button", { name: "Stop" }),
    page.getByRole("radio", { name: "Steer" }),
    page.getByRole("radio", { name: "Follow-up" }),
    page.getByTestId("composer").getByRole("button", { name: /^(Steer|Follow up|Send)/ }),
  ];
  for (const c of controls) await expect(c).toBeDisabled();
  await expect(page.getByTestId("composer-disconnected")).toContainText("Disconnected from the agent host");
  await composer(page).press("Enter");
  await expect(composer(page)).toHaveValue("one more thing");
  await shoot(page, "2-composer-disconnected");

  // Reconnect: the controls are live again.
  await context.setOffline(false);
  await expect(page.getByTestId("stream-state")).toHaveAttribute("data-stream", "connected", { timeout: 10_000 });
  await expect(page.getByTestId("composer-disconnected")).toHaveCount(0);
  if ((await second.getAttribute("data-frame-status")) === "working") {
    for (const c of controls) await expect(c).toBeEnabled();
    await shoot(page, "3-composer-reconnected");
    await page.getByRole("button", { name: "Stop" }).click();
  } else {
    // The Frame settled during the gap: the idle composer offers Send again.
    await expect(page.getByTestId("composer").getByRole("button", { name: /^Send/ })).toBeEnabled();
    await shoot(page, "3-composer-reconnected");
  }
  await expect(second).not.toHaveAttribute("data-frame-status", "working", { timeout: 120_000 });
  log(s, `xtrm-615 second Frame ${await second.getAttribute("data-frame-status")} after reconnect`);
});
