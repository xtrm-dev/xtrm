import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { HostSessionSummary } from "../../src/adapters/agent/protocol.ts";
import { hostGet, hostPayloads, log, startPi, until, type RealHostState } from "./harness.ts";

// XTRM-613 validation against a real host: the browser loses its live event stream while a GUI Frame
// works (Playwright offline emulation stands in for a suspend or a network change: the stream fails
// and every reconnect fails until the network is back). The host settles the Frame during the gap.
// While disconnected the app shows a disconnected state instead of a stale "working"; once the network
// is back the app reconnects and the Frame shows settled within 5 s.
const OUT = "docs/screenshots/agent-half/real-host";
const NAME = "resync-pi";
const PROMPT = "Count from 1 to 300, one number per line, no other text.";
const state = () => JSON.parse(process.env.XTRM_REAL_HOST_STATE!) as RealHostState;

const summary = async (s: RealHostState, id: string) => (await hostGet<{ session: HostSessionSummary }>(s, `/v1/sessions/${encodeURIComponent(id)}`)).session;
const composer = (page: Page) => page.getByRole("textbox", { name: `Message ${NAME}` });

async function shoot(page: Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/xtrm-613-${name}.png` });
}

test("a Frame settled while the live stream was down shows settled after the stream reconnects", async ({ page, context }) => {
  test.setTimeout(600_000);
  const s = state();
  page.on("console", (m) => m.type() === "error" && log(s, `browser console: ${m.text()}`));
  const id = await startPi(s, NAME);
  log(s, `xtrm-613 pi session ${id}`);

  await page.goto(`/agent/${id}`);
  await expect(page.getByTestId("session-header")).toContainText(NAME, { timeout: 30_000 });
  await expect(page.getByTestId("stream-state")).toHaveAttribute("data-stream", "connected");

  // A GUI prompt opens a Frame; the stream drops once the app shows it working.
  await composer(page).fill(PROMPT);
  const submitted = page.waitForResponse((r) => r.url().endsWith("/xtrm-api/agent-host/api/v1/submit"));
  await composer(page).press("Enter");
  expect(((await (await submitted).json()) as { status: string }).status).toBe("accepted");
  const frame = page.getByTestId("frame");
  await expect(page.getByTestId("frame-request")).toContainText(PROMPT);
  await expect(frame).toHaveAttribute("data-frame-status", "working", { timeout: 60_000 });

  await context.setOffline(true);
  const droppedAt = Date.now();
  log(s, "xtrm-613 stream dropped (browser offline) while the Frame works");
  await expect(page.getByTestId("stream-state")).toHaveAttribute("data-stream", "disconnected", { timeout: 5_000 });
  await expect(page.getByTestId("stream-state")).toContainText("Disconnected");
  // No stale "working": the Frame shows that its state is unknown until the stream is back.
  await expect(page.getByTestId("frame-disconnected")).toBeVisible();
  await expect(page.getByTestId("frame-working")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Session details" })).toContainText("disconnected");
  await expect(page.getByRole("region", { name: "Session details" })).not.toContainText("working");
  await shoot(page, "1-disconnected");

  // The host settles the Frame during the gap; the app cannot see it.
  const settled = await until(
    "the host to settle the GUI Frame",
    async () => {
      const h = await summary(s, id);
      return h.state === "settled" && (await hostPayloads(s, id)).some((p) => p.type === "agent_settled") ? h : null;
    },
    300_000,
  );
  log(s, `xtrm-613 host settled the Frame ${Math.round((Date.now() - droppedAt) / 1000)} s after the drop (state ${settled.state}, frameCount ${settled.frameCount})`);
  await expect(page.getByTestId("stream-state")).toHaveAttribute("data-stream", "disconnected");
  await expect(frame).not.toHaveAttribute("data-frame-status", "settled");

  // The network is back: reconnect and resynchronize.
  await context.setOffline(false);
  const restoredAt = Date.now();
  await expect(frame).toHaveAttribute("data-frame-status", "settled", { timeout: 5_000 });
  const settledIn = Date.now() - restoredAt;
  await expect(page.getByTestId("stream-state")).toHaveAttribute("data-stream", "connected", { timeout: 5_000 });
  await expect(page.getByTestId("frame-settled")).toBeVisible();
  await expect(page.getByTestId("session-header")).toContainText("settled");
  await expect(page.getByRole("region", { name: "Session details" })).toContainText("settled");
  log(s, `xtrm-613 Frame settled in the app ${settledIn} ms after the network came back; stream connected`);
  await shoot(page, "2-resynced");
});
