import { expect, test, type Page } from "@playwright/test";
import { hostPayloads, log, startPi, typeInTerminal, until } from "../real-host/harness.ts";
import { detail, dockFrames, ensurePi, expectSettled, frame, hostCount, PROBE, send, sessionRow, settledOnHost, shoot, state, summary, watchConsole } from "./support.ts";

// History-only fidelity against the real host (acceptance review notes, PRD §36.13): a session with GUI
// Frames, a Stop followed by a new prompt, and enough turns that its first Frame leaves the host replay
// buffer; then /quit. The fresh history-only view must agree with what the live view showed (§31-28),
// keep the session's name (XTRM-616), and show journal usage; journal-only ingress and tool origin are
// the accepted deviations.
const NAME = "acc-hist";
const MIXED = "Do these steps in order, then reply with one word: MIXED. 1) Use the read tool to read notes.txt. 2) Call the tool mcp__demo_direct__echo with message 'history'. 3) Call the probe_note tool with note 'history'. Call each tool directly, one call at a time; do not use codemode or a script.";
const FILLER = (n: number) => `F${n}: Count from 1 to 1500, one number per line, no other text.`;
const MAX_FILLERS = 30;

let id = "";
let live: { dock: string[]; tokens: string | null } = { dock: [], tokens: null };

test.beforeAll(async () => {
  id = await ensurePi(NAME, [PROBE]);
});

// A browser that never saw the session live names a history-only session after its last prompt (PRD §36.13).
const open = async (page: Page) => {
  await page.goto(`/agent/${id}`);
  await page.getByRole("radio", { name: "All" }).click();
  await expect(page.getByTestId("session-header")).toBeVisible({ timeout: 30_000 });
};
const dockLabels = (page: Page) => dockFrames(page).evaluateAll((b) => b.map((x) => x.getAttribute("aria-label") ?? ""));

test("note: live Frames, then Stop and a new prompt, agree with the host", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  expect((await send(page, NAME, MIXED)).status).toBe("accepted");
  await expectSettled(page);
  const tools = (await hostPayloads(s, id)).filter((p) => p.type === "tool_execution_start").length;
  expect((await send(page, NAME, "Use the bash tool to run `sleep 90`, then reply with exactly one word: LATE.")).status).toBe("accepted");
  await hostCount(s, id, "tool_execution_start", tools + 1);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(frame(page)).toHaveAttribute("data-frame-status", "aborted", { timeout: 30_000 });
  expect((await send(page, NAME, "Reply with exactly one word: AFTERSTOP")).status).toBe("accepted");
  await expectSettled(page);
  const h = await settledOnHost(s, id, 3);
  live = { dock: await dockLabels(page), tokens: (await detail(page, "Tokens").count()) ? await detail(page, "Tokens").innerText() : null };
  log(s, `history live view: host frameCount ${h.frameCount}; dock ${JSON.stringify(live.dock)}; tokens ${live.tokens}`);
  expect(live.dock).toHaveLength(3);
  await shoot(page, "note-history-live", s);
});

test("note: a history-only session keeps its Frames, name and journal usage after /quit", async ({ page }) => {
  test.setTimeout(1_500_000);
  const s = state();
  watchConsole(page, s);
  // Push the first Frame out of the host replay buffer, so the history-only view reads it from the journal.
  let fillers = 0;
  for (;;) {
    const replay = await hostPayloads(s, id);
    const first = replay.some((p) => p.type === "before_agent_start" && String((p as unknown as { prompt: string }).prompt).startsWith("Do these steps"));
    if (!first || fillers >= MAX_FILLERS) break;
    fillers += 1;
    typeInTerminal(s, FILLER(fillers), NAME);
    await settledOnHost(s, id, 3 + fillers, 240_000);
  }
  log(s, `history: ${fillers} filler turns; the first Frame left the replay buffer: ${fillers < MAX_FILLERS}`);
  // This browser sees the session live (and its name) before it stops.
  await open(page);
  typeInTerminal(s, "/quit", NAME);
  await until("the session to become history only", async () => ((await summary(s, id).catch(() => null))?.state === "history_only" ? true : null), 60_000);

  await page.reload();
  await page.getByRole("radio", { name: "All" }).click();
  await expect(page.getByTestId("session-header")).toContainText("history only");
  const dock = await dockLabels(page);
  log(s, `history-only dock: ${JSON.stringify(dock)}`);
  // §31-28: the same Frames as the live view, in order, once each.
  expect(dock.slice(0, 3)).toEqual(live.dock);
  expect(dock).toHaveLength(3 + fillers);
  // XTRM-616: a browser that saw the session live keeps the name it had while live.
  await expect(sessionRow(page, NAME)).toHaveCount(1);
  await expect(page.getByTestId("session-header")).toContainText(NAME);
  // XTRM-601: usage from the journal; the meter uses the window a live session reported for the model.
  await expect(detail(page, "Tokens")).toBeVisible();
  await expect(page.getByTestId("session-header").locator('[title^="Context"]')).toBeVisible();
  await shoot(page, "note-history-only-usage-and-name", s);
});

test("[deviation] a journal-only Frame shows terminal ingress (PRD §36.13)", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  await dockFrames(page).first().click();
  await expect(page.getByTestId("frame-request")).toContainText("Do these steps in order");
  await expect(page.getByTestId("frame-ingress")).toHaveText("terminal");
  // Tool origins of a journal-only Frame may show unclassified (§36.7 rule 6); the classes shown are logged.
  const classes = await frame(page).locator("[data-activity]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-activity")}:${(e.textContent ?? "").slice(0, 40)}`));
  log(s, `journal-only Frame 1 activity: ${JSON.stringify(classes)}`);
  await expect(frame(page)).toContainText("probe_note");
  await shoot(page, "deviation-journal-only-frame", s);
});

test("[deviation] a history-only session never seen live in this browser is named after its last prompt (PRD §36.13)", async ({ browser }) => {
  const s = state();
  const context = await browser.newContext();
  const page = await context.newPage();
  watchConsole(page, s);
  await page.goto(`/agent/${id}`);
  await page.getByRole("radio", { name: "All" }).click();
  await expect(page.getByTestId("session-header")).toContainText("history only", { timeout: 30_000 });
  const header = await page.getByTestId("session-header").locator("h1").innerText();
  log(s, `history-only name in a fresh browser: ${header}`);
  expect(header).not.toBe(NAME);
  await shoot(page, "deviation-history-only-name", s);
  await context.close();
});
