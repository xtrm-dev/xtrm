// Shared helpers of the Agent half acceptance project (XTRM-601). Each test is named after the PRD
// criterion it proves (`§36.11-7 …`, `§31-9 …`) and leaves one light and one dark screenshot per
// criterion in docs/screenshots/agent-half/acceptance/<criterion>-<theme>.png.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import type { HostSessionSummary } from "../../src/adapters/agent/protocol.ts";
import { hostGet, hostPayloads, log, startPi, tmux, until, type PiOptions, type RealHostState } from "../real-host/harness.ts";

export const OUT = "docs/screenshots/agent-half/acceptance";
export const PROBE = resolve("e2e/real-host/probe-extension.ts");
/** XTRM-607: holds before_agent_start for 6 s, which widens Pi's startup window like slow handlers do. */
export const DELAY_PROBE = resolve("e2e/real-host/startup-delay.ts");
export const SUBMIT = "/xtrm-api/agent-host/api/v1/submit";

export const state = () => JSON.parse(process.env.XTRM_REAL_HOST_STATE!) as RealHostState;

export const composer = (page: Page, name: string) => page.getByRole("textbox", { name: `Message ${name}` });
/** The row of one session by its exact name (`acc-frames` must not match `acc-frames-peer`). */
export const sessionRow = (page: Page, name: string) => page.locator(`[data-testid="session-row"][aria-label^="${name} · "]`);
export const frame = (page: Page) => page.getByTestId("frame");
export const dockFrames = (page: Page) => page.getByTestId("frame-dock").getByRole("button", { name: /^Frame \d+:/ });
export const pane = (s: RealHostState, name: string, lines = 12) => tmux(s, "capture-pane", "-p", "-t", name).trim().split("\n").slice(-lines).join("\n");
/** The value cell of one Details row (`<dt>label</dt><dd>value</dd>`). */
export const detail = (page: Page, label: string): Locator =>
  page.getByTestId("session-details").locator("dt", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");

export const summary = async (s: RealHostState, id: string) => (await hostGet<{ session: HostSessionSummary }>(s, `/v1/sessions/${encodeURIComponent(id)}`)).session;
export const hostTypes = async (s: RealHostState, id: string) => (await hostPayloads(s, id)).map((p) => p.type);
export const hostCount = (s: RealHostState, id: string, type: string, n: number, timeoutMs = 120_000) =>
  until(`${n} × ${type}`, async () => (await hostPayloads(s, id)).filter((p) => p.type === type).length >= n, timeoutMs);
export const settledOnHost = (s: RealHostState, id: string, frames: number, timeoutMs = 180_000) =>
  until(`${id} to settle with ${frames} Frames`, async () => {
    const h = await summary(s, id);
    return h.state === "settled" && (h.frameCount ?? 0) >= frames ? h : null;
  }, timeoutMs);

/**
 * Starts a Pi session once per run. Playwright restarts the worker after a failed test and runs
 * `beforeAll` again: the session started before (live or already history only) is reused, by the id
 * recorded in the run's temp root, instead of a second tmux session with the same name.
 */
export async function ensurePi(name: string, extensions: string[] = [], opts: PiOptions = {}): Promise<string> {
  const s = state();
  const file = join(s.root, "acceptance-sessions.json");
  const known = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, string>) : {};
  if (known[name]) {
    log(s, `reusing ${name} (${known[name]}) after a worker restart`);
    return known[name];
  }
  const id = await startPi(s, name, extensions, s.work, opts);
  writeFileSync(file, JSON.stringify({ ...known, [name]: id }));
  return id;
}

/**
 * Fill the composer and press Enter (or `how`); returns the host's submit_result as the bridge answered it.
 * A busy answer right after a settle is retried by the app itself (src/agent/settle-retry.ts); the app
 * logs each retry as `[xtrm-agent]`, which watchConsole copies into the run log.
 */
export async function send(page: Page, name: string, text: string, how?: () => Promise<void>, opts: { awaitFrame?: boolean } = {}) {
  // An idle composer sends a prompt, which opens a new Frame; until that Frame is on screen the view
  // still shows the previous, settled one (an early expectSettled would match it).
  const idle = !(await page.getByRole("radiogroup", { name: "Delivery while working" }).count());
  await composer(page, name).fill(text);
  // The last submit answer: the app may send the same prompt again after a busy answer.
  let last: Promise<{ status: string; reason?: string; commandId: string }> | null = null;
  const onResponse = (r: import("@playwright/test").Response) => {
    if (r.url().endsWith(SUBMIT)) last = r.json();
  };
  page.on("response", onResponse);
  const first = page.waitForResponse((r) => r.url().endsWith(SUBMIT), { timeout: 60_000 });
  await (how ? how() : composer(page, name).press("Enter"));
  await first;
  // Give quiet retries (at most 3, 1 s apart) time to finish before reading the final answer.
  await expect(page.getByTestId("composer-waiting")).toHaveCount(0, { timeout: 10_000 });
  page.off("response", onResponse);
  const r = (await last!) as { status: string; reason?: string; commandId: string };
  if (r.status === "accepted" && idle && !how && opts.awaitFrame !== false) {
    await expect(page.getByTestId("frame-request")).toContainText(text.slice(0, 40), { timeout: 90_000 });
  }
  return r;
}

/**
 * One light and one dark screenshot of the current view. The theme is switched in place, without a
 * reload, so transient state (a busy offer, a disconnected stream, an open picker) is captured as is.
 */
export async function shoot(page: Page, criterion: string, s?: RealHostState) {
  mkdirSync(OUT, { recursive: true });
  for (const t of ["light", "dark"] as const) {
    await page.evaluate((v) => {
      try {
        localStorage.setItem("xtrm.console.theme.v1", v);
      } catch {
        // storage unavailable
      }
      document.documentElement.dataset.theme = v;
    }, t);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${criterion}-${t}.png` });
  }
  if (s) log(s, `screenshots ${OUT}/${criterion}-{light,dark}.png`);
}

/** Logs browser errors to the run log. */
export function watchConsole(page: Page, s: RealHostState) {
  page.on("console", (m) => (m.type() === "error" || m.text().startsWith("[xtrm-agent]")) && log(s, `browser console: ${m.text().replace(/xt[pd]_[A-Za-z0-9_-]+/g, "<token>")}`));
}

/** Waits until the Frame on screen is settled. */
export const expectSettled = (page: Page, timeout = 180_000) => expect(frame(page)).toHaveAttribute("data-frame-status", "settled", { timeout });
