import { expect, test } from "@playwright/test";
import { CLAUDE_NAME, CLAUDE_SESSION, MODEL, claudeHook, hostGet, launchTmux, log, startPi, startXtPi, typeInTerminal, until } from "../real-host/harness.ts";
import { composer, detail, dockFrames, ensurePi, expectSettled, frame, send, sessionRow, settledOnHost, shoot, state, SUBMIT, summary, watchConsole } from "./support.ts";

// Shell, session sidebar and presence criteria against the real host: §31-1, §36.11-1, -3, -4, -5, -6.
const MAIN = "acc-main";
const TERM = "acc-term";
const NOEXT_PROMPT = "NOEXT-601: reply with the single word ok";
const MOD = process.platform === "darwin" ? "Meta" : "Control";
const CONSOLE_MODES = ["Issues", "Agents", "Program", "Research", "Observability"];

let main = "";
let term = "";

test.beforeAll(async () => {
  // `xt pi --role acceptance --bead XTRM-601` hands role and work item to the extension the same way.
  main = await ensurePi(MAIN, [], { role: "acceptance", bead: "XTRM-601" });
  term = await ensurePi(TERM);
});

test("§31-1 the application launches against the real host", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await page.goto("/");
  await expect(page.getByTestId("context-sidebar")).toBeVisible();
  await expect(page.getByTestId("half-switch")).toBeVisible();
  await page.goto(`/agent/${main}`);
  await expect(page.getByTestId("session-header")).toContainText(MAIN);
  await expect(page.getByLabel("Data sources")).toContainText("Agent host");
  await shoot(page, "31-01-app-launches", s);
});

test("§36.11-1 the Console/Agent switch is visible in every mode and restores each half's last route", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await page.goto(`/agent/${main}`);
  const sw = page.getByTestId("half-switch");
  await expect(sw).toBeVisible();
  await page.getByRole("radio", { name: "Work" }).click();
  for (const mode of CONSOLE_MODES) {
    await page.getByTestId("context-sidebar").getByRole("button", { name: new RegExp(`^${mode}`) }).click();
    await expect(sw).toBeVisible();
    log(s, `§36.11-1 Console mode ${mode}: ${page.url()} switch visible`);
  }
  await page.getByTestId("context-sidebar").getByRole("button", { name: "Program", exact: true }).click();
  await expect(page).toHaveURL(/\/program/);
  const consoleRoute = new URL(page.url()).pathname;
  // Agent restores the last Agent route; Console restores the last Console route; Mod+. toggles.
  await page.getByRole("radio", { name: "Agent" }).click();
  await expect(page).toHaveURL(new RegExp(`/agent/${main}$`));
  await page.getByRole("radio", { name: "Work" }).click();
  await expect(page).toHaveURL(new RegExp(`${consoleRoute}$`));
  await page.keyboard.press(`${MOD}+.`);
  await expect(page).toHaveURL(new RegExp(`/agent/${main}$`));
  await expect(sw).toBeVisible();
  await shoot(page, "36.11-01-switch", s);
});

test("§36.11-3 a session started from a terminal with xt pi is listed live without GUI action", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  // A real `xt pi` from the released host's xt, in a terminal on the host (its private tmux server).
  const { sessionId, tmuxSession } = await startXtPi(s, "acc-xtpi");
  log(s, `§36.11-3 xt pi session ${sessionId} in tmux ${tmuxSession}; harness pi session ${term}`);
  await page.goto("/agent");
  await page.getByRole("radio", { name: "All" }).click();
  const row = page.getByTestId("session-row").filter({ hasText: tmuxSession });
  await expect(row).toHaveAttribute("aria-label", /· settled$/);
  await row.click();
  await expect(detail(page, "Origin")).toHaveText("started in a terminal");
  await expect(detail(page, "tmux")).toContainText(`${tmuxSession}:%`);
  // Typing in that terminal makes the row live-working, with no GUI action.
  launchTmux(s, "send-keys", "-t", tmuxSession, "-l", "Reply with exactly one word: LIVE");
  launchTmux(s, "send-keys", "-t", tmuxSession, "Enter");
  await expect(row).toHaveAttribute("aria-label", /· working$/, { timeout: 60_000 });
  await expect(frame(page)).toHaveAttribute("data-frame-status", "working");
  await expect(page.getByTestId("frame-ingress")).toHaveText("terminal");
  await shoot(page, "36.11-03-terminal-session-live", s);
  await expect(row).toHaveAttribute("aria-label", /· settled$/, { timeout: 120_000 });

  // One Claude Code presence session through the released hook reporter.
  claudeHook(s, { hook_event_name: "SessionStart", source: "startup" });
  claudeHook(s, { hook_event_name: "UserPromptSubmit", prompt: "not reported" });
  claudeHook(s, { hook_event_name: "PreToolUse", tool_use_id: "toolu_601_1", tool_name: "Read", tool_input: { file_path: `${s.work}/notes.txt` } });
  const claude = sessionRow(page, CLAUDE_NAME);
  await expect(claude).toHaveAttribute("aria-label", `${CLAUDE_NAME} · working`);
  claudeHook(s, { hook_event_name: "PostToolUse", tool_use_id: "toolu_601_1", tool_name: "Read", tool_response: {} });
  claudeHook(s, { hook_event_name: "Stop" });
  await expect(claude).toHaveAttribute("aria-label", `${CLAUDE_NAME} · settled`);
  await claude.click();
  await expect(page).toHaveURL(new RegExp(`/agent/${CLAUDE_SESSION}$`));
  await expect(page.getByTestId("composer-notice")).toContainText("presence only");
  await shoot(page, "36.11-03-claude-presence", s);
});

test("§36.11-4 a session without the extension is listed history only and takes no prompt", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await startPi(s, "acc-noext", [], s.work, { hostExtension: false });
  typeInTerminal(s, NOEXT_PROMPT, "acc-noext");
  // The host knows it only from its journal (incremental index), never from a live extension.
  const listed = await until(
    "the extension-less session in the host index",
    async () => (await hostGet<{ sessions: Array<{ sessionId: string; state: string; name?: string; title?: string }> }>(s, "/v1/sessions")).sessions.find((x) => x.state === "history_only" && JSON.stringify(x).includes("NOEXT-601")),
    120_000,
  );
  log(s, `§36.11-4 host lists ${listed.sessionId} as ${listed.state}`);
  await page.goto(`/agent/${listed.sessionId}`);
  await page.getByRole("radio", { name: "All" }).click();
  await expect(page.getByTestId("session-header")).toContainText("history only");
  await expect(page.getByTestId("session-row").filter({ hasText: /NOEXT-601/ }).first()).toHaveAttribute("aria-label", /history only$/);
  await expect(page.getByTestId("composer-notice")).toContainText("History only");
  await expect(page.getByRole("textbox", { name: /^Message / })).toHaveCount(0);
  // The host refuses a prompt to it as well: no live extension to deliver it.
  const r = await page.request.post(SUBMIT, {
    data: { schema: "xtrm.agent-host-api.v1", kind: "submit_request", sessionId: listed.sessionId, command: { type: "prompt", commandId: "acc-601-noext", message: "must not arrive" } },
  });
  const body = (await r.json()) as { status?: string; kind?: string };
  log(s, `§36.11-4 submit to the history-only session: HTTP ${r.status()} ${JSON.stringify(body)}`);
  expect(body.status).not.toBe("accepted");
  await shoot(page, "36.11-04-history-only", s);
});

test("§36.11-5 a session row shows live state, role, work item, model, context and last activity from host data", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await page.goto(`/agent/${main}`);
  await page.getByRole("radio", { name: "All" }).click();
  // One turn, so the context meter has real usage.
  expect((await send(page, MAIN, "Reply with exactly one word: METER")).status).toBe("accepted");
  await expectSettled(page);
  const h = await settledOnHost(s, main, 1);
  log(s, `§36.11-5 host summary: ${JSON.stringify({ state: h.state, role: h.role, workItem: h.workItem, model: h.model, thinkingLevel: h.thinkingLevel, contextUsage: h.contextUsage, lastActivityAt: h.lastActivityAt })}`);
  const row = sessionRow(page, MAIN);
  await expect(row).toHaveAttribute("aria-label", `${MAIN} · settled`);
  await expect(row).toContainText("acceptance");
  await expect(row).toContainText("XTRM-601");
  await expect(row).toContainText(`${MODEL.split("/")[1]} · ${h.thinkingLevel}`);
  await expect(row.locator('[title^="Context"]')).toBeVisible();
  await expect(row.locator('[title^="Context"]')).not.toHaveText("0%");
  await expect(row).toContainText(/now|\d+[smh]/);
  await expect(page.getByTestId("session-header")).toContainText("XTRM-601");
  await shoot(page, "36.11-05-row-anatomy", s);
});

test("§36.11-6 switching sessions and back restores the selected Frame, scroll position and draft", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await page.goto(`/agent/${main}`);
  await page.getByRole("radio", { name: "All" }).click();
  expect((await send(page, MAIN, "Count from 1 to 150, one number per line, no other text.")).status).toBe("accepted");
  await expectSettled(page);
  expect((await send(page, MAIN, "Reply with exactly one word: SECOND")).status).toBe("accepted");
  await expectSettled(page);
  await settledOnHost(s, main, 3);

  await dockFrames(page).nth(1).click();
  await expect(page.getByTestId("frame-request")).toContainText("Count from 1 to 150");
  const scroll = page.getByTestId("frame-scroll");
  await scroll.evaluate((el) => (el.scrollTop = 400));
  await composer(page, MAIN).fill("draft kept across sessions");

  await sessionRow(page, TERM).click();
  await expect(page.getByTestId("session-header")).toContainText(TERM);
  await sessionRow(page, MAIN).click();
  await expect(page.getByTestId("frame-request")).toContainText("Count from 1 to 150");
  await expect(composer(page, MAIN)).toHaveValue("draft kept across sessions");
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
  log(s, `§36.11-6 restored Frame 2, scrollTop ${await scroll.evaluate((el) => el.scrollTop)}, draft kept`);
  await shoot(page, "36.11-06-view-state-restored", s);
  await summary(s, main);
});

test("note: Details separate state from capabilities and show one model format with its provider (XTRM-616)", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await page.goto(`/agent/${main}`);
  const h = await summary(s, main);
  const short = `${MODEL.split("/")[1]} · ${h.thinkingLevel}`;
  await expect(detail(page, "State")).toHaveText("settled");
  await expect(detail(page, "Accepts")).toHaveText("prompt · steer · abort");
  await expect(detail(page, "Model")).toHaveText(short);
  await expect(detail(page, "Provider")).toHaveText(MODEL.split("/")[0]!);
  await expect(page.getByTestId("session-header")).toContainText(short);
  await shoot(page, "note-616-details", s);
});

test("note: the open session stays listed when it is outside the repository filter (XTRM-616)", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  // The work dir has no remote: in the default repository scope (xtrm) the session is outside the filter.
  await page.goto(`/agent/${main}`);
  await expect(page.getByRole("radio", { name: "All" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText("Open · not in xtrm")).toBeVisible();
  await expect(sessionRow(page, MAIN)).toBeVisible();
  await expect(page.getByText("No sessions in xtrm")).toHaveCount(0);
  await shoot(page, "note-616-open-outside-filter", s);
});
