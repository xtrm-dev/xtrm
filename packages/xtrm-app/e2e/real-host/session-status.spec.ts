import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import type { HostSessionSummary } from "../../src/adapters/agent/protocol.ts";
import { hostGet, log, startPi, tmux, typeInTerminal, until, type RealHostState } from "./harness.ts";

// XTRM-609 validation against a real host built from the same core commit as the extension
// (XTRM_REAL_HOST_XT, XTRM_CORE_DIR): the session row shows the model and thinking level from the
// host's session_status, the context meter changes after a turn, and the session groups under its
// repository owner/name, live and after /quit (history only).
const OUT = "docs/screenshots/agent-half/real-host";
const NAME = "status-pi";
const REPO = "xtrm-probe/status-609";
const state = () => JSON.parse(process.env.XTRM_REAL_HOST_STATE!) as RealHostState;

const summary = async (s: RealHostState, id: string) => (await hostGet<{ session: HostSessionSummary }>(s, `/v1/sessions/${encodeURIComponent(id)}`)).session;
const status = (h: HostSessionSummary) => JSON.stringify({ state: h.state, model: h.model, thinkingLevel: h.thinkingLevel, contextUsage: h.contextUsage, repository: h.repository, repositoryPath: h.repositoryPath, frameCount: h.frameCount });
/** The session row inside its repository group (All scope). */
const groupedRow = (page: Page, id: string) => page.locator(`[data-group="${REPO}"]`).getByTestId("session-row").filter({ hasText: new RegExp(`${NAME}|${id.slice(0, 8)}`) });
const meter = (row: Locator) => row.locator('[title^="Context"]');
const contextDetail = (page: Page) => page.getByTestId("session-details").locator("dt", { hasText: "Context" }).locator("xpath=following-sibling::dd[1]");

async function shoot(page: Page, name: string) {
  mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: `${OUT}/xtrm-609-${name}.png` });
}

test("session rows show host model, thinking level, context meter and owner/name grouping", async ({ page }) => {
  const s = state();
  page.on("console", (m) => m.type() === "error" && log(s, `browser console: ${m.text()}`));

  // A repository with an origin remote: the host reports repository owner/name and repositoryPath.
  const repoDir = join(s.root, "status-609");
  mkdirSync(repoDir);
  execFileSync("git", ["init", "-q"], { cwd: repoDir });
  execFileSync("git", ["remote", "add", "origin", `https://github.com/${REPO}.git`], { cwd: repoDir });
  writeFileSync(join(repoDir, "README.md"), "status probe\n");

  const id = await startPi(s, NAME, [], repoDir);
  log(s, `xtrm-609 pi session ${id} in ${repoDir}`);
  const before = await until("session_status in the host summary", async () => {
    const h = await summary(s, id);
    return h.model && h.thinkingLevel && h.contextUsage && h.repository ? h : null;
  });
  log(s, `xtrm-609 host summary before turn: ${status(before)}`);
  expect(before.repository).toBe(REPO);
  expect(before.repositoryPath).toBe(repoDir);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/agent/${id}`);
  await page.getByRole("radio", { name: "All" }).click();
  const row = groupedRow(page, id);
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("listitem").filter({ hasText: new RegExp(`^${REPO}\\d+$`) })).toBeVisible();

  // Model and thinking level from session_status (the model id without its provider in the row).
  const modelId = before.model!.split("/").slice(1).join("/");
  await expect(row).toContainText(`${modelId} · ${before.thinkingLevel}`);
  await expect(page.getByTestId("session-details")).toContainText(`${before.model} · ${before.thinkingLevel}`);
  await expect(meter(row)).toBeVisible();
  const meterBefore = (await meter(row).innerText()).trim();
  const detailBefore = (await contextDetail(page).innerText()).trim();
  log(s, `xtrm-609 app before turn: row "${(await row.innerText()).replace(/\s+/g, " ")}" meter ${meterBefore} context ${detailBefore}`);
  await shoot(page, "1-before-turn");

  // One turn: the context meter changes as the next session_status arrives.
  typeInTerminal(s, "Reply with the single word: ok", NAME);
  const after = await until(
    "context usage to grow after the turn",
    async () => {
      const h = await summary(s, id);
      return h.state === "settled" && (h.frameCount ?? 0) >= 1 && (h.contextUsage?.tokens ?? 0) > (before.contextUsage?.tokens ?? 0) ? h : null;
    },
    120_000,
  );
  log(s, `xtrm-609 host summary after turn: ${status(after)}`);
  await expect.poll(async () => (await contextDetail(page).innerText()).trim(), { timeout: 30_000 }).not.toBe(detailBefore);
  await expect.poll(async () => (await meter(row).innerText()).trim(), { timeout: 30_000 }).not.toBe(meterBefore);
  // XTRM-612: a 1M-window model must never show a rounded-away 0% after real turns.
  expect(after.contextUsage!.tokens).toBeGreaterThan(0);
  expect((await meter(row).innerText()).trim()).not.toBe("0%");
  log(s, `xtrm-609 app after turn: row "${(await row.innerText()).replace(/\s+/g, " ")}" meter ${(await meter(row).innerText()).trim()} context ${(await contextDetail(page).innerText()).trim()}`);
  await shoot(page, "2-after-turn");

  // Shift+Tab in the terminal cycles the thinking level; the row follows the next session_status.
  tmux(s, "send-keys", "-t", NAME, "BTab");
  const cycled = await until("thinking level to change", async () => {
    const h = await summary(s, id);
    return h.thinkingLevel && h.thinkingLevel !== after.thinkingLevel ? h : null;
  });
  log(s, `xtrm-609 host summary after Shift+Tab: ${status(cycled)}`);
  await expect(row).toContainText(`${modelId} · ${cycled.thinkingLevel}`);
  await shoot(page, "3-thinking-changed");

  // After /quit the session is history only and still groups under its owner/name.
  typeInTerminal(s, "/quit", NAME);
  const history = await until("the session to become history only", async () => {
    const h = await summary(s, id).catch(() => null);
    return h?.state === "history_only" ? h : null;
  }, 60_000);
  log(s, `xtrm-609 host summary after /quit: ${status(history)}`);
  expect(history.repository).toBe(REPO);
  await page.reload();
  await page.getByRole("radio", { name: "All" }).click();
  // History only: the host names the session after its first prompt, so the row is found by group.
  const historyRow = page.locator(`[data-group="${REPO}"]`).getByTestId("session-row");
  await expect(historyRow).toHaveCount(1, { timeout: 30_000 });
  await expect(historyRow).toHaveAttribute("aria-label", /history only$/);
  await expect(historyRow).toContainText(`${modelId} · ${history.thinkingLevel}`);
  // The host reports no context usage for a history-only session: no meter.
  await expect(meter(historyRow)).toHaveCount(history.contextUsage ? 1 : 0);
  log(s, `xtrm-609 app after /quit: row "${(await historyRow.innerText()).replace(/\s+/g, " ")}" group ${REPO}`);
  await shoot(page, "4-history-only-grouped");
});
