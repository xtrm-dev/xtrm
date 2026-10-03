import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { HostSessionSummary } from "../../src/adapters/agent/protocol.ts";
import { hostGet, hostPayloads, log, startPi, typeInTerminal, until, type RealHostState } from "./harness.ts";

// XTRM-604 validation against a real host built from the same core commit as the extension
// (XTRM_REAL_HOST_XT, XTRM_CORE_DIR): a Pi session drives more events than the host's replay buffer
// (1024) holds, so its first Frames are no longer in the replay. The Frames view still shows every
// Frame from the session history, once each, live and after /quit (history only).
const OUT = "docs/screenshots/agent-half/real-host";
const NAME = "history-pi";
const MAX_TURNS = 30;
const state = () => JSON.parse(process.env.XTRM_REAL_HOST_STATE!) as RealHostState;

const summary = async (s: RealHostState, id: string) => (await hostGet<{ session: HostSessionSummary }>(s, `/v1/sessions/${encodeURIComponent(id)}`)).session;
const prompt = (n: number) => (n === 1 ? "H1: Read notes.txt with the read tool and reply with its first line only." : `H${n}: Count from 1 to 1500, one number per line, no other text.`);
/** Frame dock buttons, in order: `Frame <n>: <title>`. */
const dockFrames = (page: Page) => page.getByTestId("frame-dock").getByRole("button", { name: /^Frame \d+:/ });

async function shoot(page: Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/xtrm-604-${name}.png` });
}

async function expectAllFrames(page: Page, s: RealHostState, turns: number, when: string) {
  const expected = Array.from({ length: turns }, (_, i) => `Frame ${i + 1}: ${prompt(i + 1)}`);
  await expect.poll(async () => dockFrames(page).evaluateAll((b) => b.map((x) => x.getAttribute("aria-label"))), { timeout: 30_000 }).toEqual(expected);
  log(s, `xtrm-604 ${when}: Frame dock ${expected.length} Frames, titles H1..H${turns} in order, no duplicate`);
  // The oldest Frame (outside the replay buffer) shows its request, call and response from the journal.
  await dockFrames(page).first().click();
  await expect(page.getByTestId("frame-request")).toContainText("H1: Read notes.txt");
  await expect(page.getByTestId("frame")).toHaveAttribute("data-frame-status", "settled");
  await expect(page.getByTestId("frame")).toContainText("notes.txt");
  await expect(page.getByTestId("frame")).toContainText("hello from the real-host run");
}

test("Frames beyond the host replay buffer come from the session history, live and history only", async ({ page }) => {
  test.setTimeout(1_200_000);
  const s = state();
  page.on("console", (m) => m.type() === "error" && log(s, `browser console: ${m.text()}`));

  const id = await startPi(s, NAME);
  log(s, `xtrm-604 pi session ${id}`);

  // Drive turns until the first Frame's events have left the host's replay buffer.
  let turns = 0;
  let replayed: Array<{ type: string }> = [];
  while (turns < MAX_TURNS) {
    turns += 1;
    typeInTerminal(s, prompt(turns), NAME);
    await until(
      `turn ${turns} to settle`,
      async () => {
        const h = await summary(s, id);
        return h.state === "settled" && (h.frameCount ?? 0) >= turns ? h : null;
      },
      180_000,
    );
    replayed = await hostPayloads(s, id);
    const starts = replayed.filter((p) => p.type === "before_agent_start").map((p) => String((p as { prompt?: unknown }).prompt).slice(0, 3));
    log(s, `xtrm-604 turn ${turns} settled; replay holds ${replayed.length} events of this session, Frame starts ${starts.join(",")}`);
    if (turns >= 3 && !starts.includes("H1:")) break;
  }
  const starts = replayed.filter((p) => p.type === "before_agent_start").length;
  expect(starts, "the replay buffer must have dropped at least the first Frame").toBeLessThan(turns);
  const host = await summary(s, id);
  log(s, `xtrm-604 host summary: state ${host.state} frameCount ${host.frameCount}; replay holds ${starts} of ${turns} Frame starts`);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/agent/${id}`);
  await expect(page.getByTestId("session-header")).toContainText(NAME, { timeout: 30_000 });
  await expectAllFrames(page, s, turns, "live");
  await shoot(page, "1-live-first-frame");
  await dockFrames(page).last().click();
  await expect(page.getByTestId("frame-request")).toContainText(`H${turns}:`);
  await shoot(page, "2-live-last-frame");

  // After /quit the session is history only: the same Frames, from the journal alone after a reload.
  typeInTerminal(s, "/quit", NAME);
  await until("the session to become history only", async () => ((await summary(s, id).catch(() => null))?.state === "history_only" ? true : null), 60_000);
  await page.reload();
  await expect(page.getByTestId("session-header")).toContainText("history only", { timeout: 30_000 });
  await expectAllFrames(page, s, turns, "history only");
  await shoot(page, "3-history-only");
});
