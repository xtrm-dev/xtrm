import { readFileSync, statSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FRONT_HOST, hostCli, log, startPi, tmux, typeInTerminal, type RealHostState } from "./harness.ts";

// XTRM-600 validation against a real host in direct mode (PRD §35.5): the host runs with --direct
// behind a local front that adds X-Forwarded-For (standing in for `tailscale serve`), and the bridge
// has no loopback host. Pairing succeeds once, a replay fails, the session list and the event stream
// work with the device token, and `xt host revoke` turns the connection into a re-pair prompt.
// Tokens are read into variables only; nothing here logs them.
const OUT = "docs/screenshots/agent-half/real-host";
const NAME = "direct-pi";
const state = () => JSON.parse(process.env.XTRM_REAL_HOST_STATE!) as RealHostState;
const deviceFile = () => `${process.env.XTRM_REAL_HOST_DEVICE_DIR}/app/agent-host-device.json`;
const sessionRow = (page: Page, name: string) => page.getByTestId("session-row").filter({ hasText: name });

function pairingToken(s: RealHostState): string {
  const reply = JSON.parse(hostCli(s, "pair", "--json")) as { kind: string; token: string; expiresAt: number };
  expect(reply.kind).toBe("pairing_token");
  expect(reply.token).toMatch(/^xtp_/);
  log(s, `issued a pairing token (expires ${new Date(reply.expiresAt).toISOString()})`);
  return reply.token;
}

async function shoot(page: Page, name: string) {
  for (const t of ["light", "dark"] as const) {
    await page.evaluate((v) => {
      localStorage.setItem("xtrm.console.theme.v1", v);
      document.documentElement.dataset.theme = v;
    }, t);
    // Let the theme transition finish; the page is not reloaded so the panel keeps its state.
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${t}-${name}.png` });
  }
}

async function openDirect(page: Page) {
  const panel = page.getByTestId("host-connection");
  if (!(await panel.isVisible())) await page.getByTestId("host-connection-toggle").click();
  await panel.getByTestId("host-mode-direct").click();
  return panel;
}

async function pair(page: Page, s: RealHostState, token: string) {
  const panel = await openDirect(page);
  const form = panel.getByRole("form", { name: "Pair with an agent host" });
  await form.getByRole("textbox", { name: "Front URL" }).fill(`http://127.0.0.1:${s.frontPort}`);
  await form.getByLabel("Pairing token").fill(token);
  await form.getByRole("textbox", { name: "Device name" }).fill("playwright-direct");
  await form.getByRole("button", { name: "Pair", exact: true }).click();
  return panel;
}

test("direct mode: pair once, list and stream with the device token, re-pair after revoke", async ({ page }) => {
  const s = state();
  page.on("console", (m) => m.type() === "error" && log(s, `browser console: ${m.text().replace(/xt[pd]_[A-Za-z0-9_-]+/g, "<token>")}`));
  const front = `http://127.0.0.1:${s.frontPort}`;
  const piId = await startPi(s, NAME);
  log(s, `pi session id ${piId}`);

  await test.step("without a device the bridge has no host, and the front refuses requests without a token", async () => {
    expect((await page.request.get("/xtrm-api/agent-host/api/v1/sessions")).status()).toBe(409);
    const refused = await fetch(`${front}/v1/sessions`);
    expect(refused.status).toBe(401);
    expect(((await refused.json()) as { code: string }).code).toBe("unauthorized");
    await page.goto("/agent");
    const panel = await openDirect(page);
    await expect(panel.getByTestId("host-direct-phase")).toHaveText("Not paired");
  });

  let token = "";
  await test.step("a pairing token pairs once; the device token stays in the bridge's 0600 file", async () => {
    token = pairingToken(s);
    const panel = await pair(page, s, token);
    await expect(panel.getByTestId("host-direct-phase")).toHaveText("Paired");
    await expect(panel.getByTestId("host-direct-device")).toContainText("as playwright-direct");
    await expect(page.getByTestId("host-connection-toggle")).toHaveAccessibleName("Agent host · Paired");
    const file = deviceFile();
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect((JSON.parse(readFileSync(file, "utf8")) as { token?: string }).token).toMatch(/^xtd_/);
    const status = await (await page.request.get("/xtrm-api/agent-host/connection")).text();
    expect(status).not.toMatch(/xt[pd]_/);
    expect(await page.content()).not.toMatch(/xt[pd]_/);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toMatch(/xt[pd]_/);
    const devices = JSON.parse(hostCli(s, "devices", "--json")) as { devices: Array<{ deviceId: string; name: string }> };
    expect(devices.devices.map((d) => d.name)).toEqual(["playwright-direct"]);
    log(s, `paired: device ${devices.devices[0]!.deviceId}; device file mode 0600`);
    await shoot(page, "direct-paired");
  });

  await test.step("the same pairing token is refused the second time", async () => {
    const panel = await openDirect(page);
    await panel.getByRole("button", { name: "Pair again" }).click();
    await pair(page, s, token);
    await expect(page.getByTestId("host-direct-error")).toContainText("unknown, used or expired");
    await panel.getByRole("button", { name: "Cancel" }).click();
    await expect(panel.getByTestId("host-direct-phase")).toHaveText("Paired");
    log(s, "replayed pairing token refused (invalid_pairing_token)");
  });

  await test.step("the session list and the event stream come through the front with the device token", async () => {
    const list = await page.request.get("/xtrm-api/agent-host/api/v1/sessions");
    expect(list.status()).toBe(200);
    expect(list.headers()["x-xtrm-agent-host"]).toMatch(/^direct:http:\/\/127\.0\.0\.1:\d+:/);
    await page.goto(`/agent/${piId}`);
    await page.getByRole("radio", { name: "All" }).click();
    await expect(sessionRow(page, NAME)).toHaveAttribute("aria-label", `${NAME} · settled`);
    typeInTerminal(s, "Reply with exactly the words: direct mode ok", NAME);
    const frame = page.getByTestId("frame");
    await expect(frame).toHaveAttribute("data-frame-status", /working|settled/, { timeout: 60_000 });
    await expect(page.getByTestId("frame-request")).toContainText("direct mode ok");
    await expect(page.getByTestId("frame-ingress")).toHaveText("terminal");
    await expect(frame).toHaveAttribute("data-frame-status", "settled", { timeout: 240_000 });
    await expect(page.getByTestId("frame-settled")).toHaveCount(1);
    log(s, `frame streamed and settled over the front; pane tail:\n${tmux(s, "capture-pane", "-p", "-t", NAME).trim().split("\n").slice(-4).join("\n")}`);
    const log_ = readFileSync(s.log, "utf8");
    expect(log_).toMatch(/front GET \/v1\/events 200 bearer=yes/);
    expect(log_).toMatch(/front GET \/v1\/sessions 200 bearer=yes/);
    await shoot(page, "direct-frame");
  });

  await test.step("xt host revoke turns the connection into a re-pair prompt", async () => {
    const { devices } = JSON.parse(hostCli(s, "devices", "--json")) as { devices: Array<{ deviceId: string }> };
    hostCli(s, "revoke", devices[0]!.deviceId);
    log(s, `revoked device ${devices[0]!.deviceId} with xt host revoke`);
    // The host closes the device's stream; the next request is refused and the bridge drops the token.
    await expect(page.getByTestId("host-direct-repair")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("host-direct-repair")).toContainText("Pair again");
    await expect(page.getByTestId("host-connection-toggle")).toHaveAccessibleName("Agent host · Pair again");
    expect(readFileSync(deviceFile(), "utf8")).not.toMatch(/xtd_/);
    log(s, "re-pair prompt shown; device token removed from the bridge file");
    await shoot(page, "direct-repair");
  });

  await test.step("pairing again with a new token restores the session list", async () => {
    await pair(page, s, pairingToken(s));
    // The panel opened by itself for the prompt and closes with it; the toggle shows the new state.
    await expect(page.getByTestId("host-connection-toggle")).toHaveAccessibleName("Agent host · Paired");
    await expect(page.getByTestId("host-direct-repair")).toHaveCount(0);
    expect((await page.request.get("/xtrm-api/agent-host/api/v1/sessions")).status()).toBe(200);
    await expect(sessionRow(page, NAME)).toBeVisible();
    log(s, `re-paired through ${FRONT_HOST}`);
  });
});
