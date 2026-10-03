import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { hostCli, hostPayloads, log, startPi } from "../real-host/harness.ts";
import { SUBMIT, composer, frame, shoot, state, watchConsole } from "./support.ts";

// §36.11-8 against a remote host. This app server has no loopback host: it reaches the agent host only
// through the direct-mode front (standing in for `tailscale serve`), which marks every request as
// remote, with a paired device token (§35.5). A @file reference is resolved by the host in the
// session's cwd; the desktop side (browser and bridge) never reads the path.
const NAME = "acc-remote";
const FILE = "remote-only-601.txt";

test("§36.11-8 @file against a remote host reads the file on that host, not on the desktop", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  writeFileSync(join(s.work, FILE), "written on the agent host for §36.11-8\n");
  const id = await startPi(s, NAME);

  // Pair this app with the host through the front.
  const { token } = JSON.parse(hostCli(s, "pair", "--json")) as { token: string };
  expect((await page.request.get("/xtrm-api/agent-host/api/v1/sessions")).status()).toBe(409);
  await page.goto("/agent");
  const panel = page.getByTestId("host-connection");
  if (!(await panel.isVisible())) await page.getByTestId("host-connection-toggle").click();
  await panel.getByTestId("host-mode-direct").click();
  const form = panel.getByRole("form", { name: "Pair with an agent host" });
  await form.getByRole("textbox", { name: "Front URL" }).fill(`http://127.0.0.1:${s.frontPort}`);
  await form.getByLabel("Pairing token").fill(token);
  await form.getByRole("textbox", { name: "Device name" }).fill("acceptance-remote");
  await form.getByRole("button", { name: "Pair", exact: true }).click();
  await expect(panel.getByTestId("host-direct-phase")).toHaveText("Paired");
  log(s, "§36.11-8 remote app paired through the front");

  // The bridge answers repository lookups only for a local host: it never reads a remote path.
  const repo = await page.request.get(`/xtrm-api/agent-host/repo?path=${encodeURIComponent(s.work)}`);
  expect(await repo.json()).toEqual({ repo: null });

  await page.goto(`/agent/${id}`);
  await page.getByRole("radio", { name: "All" }).click();
  await composer(page, NAME).fill(`Reply with exactly one word: REMOTE. @file:${FILE} .`);
  const request = page.waitForRequest((r) => r.url().endsWith(SUBMIT), { timeout: 60_000 });
  await composer(page, NAME).press("Enter");
  const sent = (await request).postDataJSON() as { references?: Array<{ raw: string; status: string; revision?: string; content?: string }> };
  const [ref] = sent.references ?? [];
  const expected = `sha256:${createHash("sha256").update(readFileSync(join(s.work, FILE))).digest("hex")}`;
  log(s, `§36.11-8 resolved ${ref?.raw}: ${ref?.status} ${ref?.revision}`);
  expect(ref).toMatchObject({ raw: `@file:${FILE}`, status: "resolved", revision: expected });
  expect(ref!.content).toContain("written on the agent host");
  // The Frame records the revision it was given, whatever the model then does.
  await expect(frame(page).locator(`[data-revision="${expected}"]`)).toHaveCount(1);
  await expect(frame(page)).not.toHaveAttribute("data-frame-status", "working", { timeout: 180_000 });
  const status = await frame(page).getAttribute("data-frame-status");
  const ends = (await hostPayloads(s, id)).filter((p) => p.type === "message_end") as unknown as Array<{ message: { role: string; stopReason?: string; errorMessage?: string } }>;
  log(s, `§36.11-8 Frame ${status}; host assistant ends ${JSON.stringify(ends.filter((e) => e.message.role === "assistant").map((e) => [e.message.stopReason, e.message.errorMessage]))}`);
  if (status !== "settled") log(s, "§36.11-8 the Frame did not settle: a provider-side result, recorded; the criterion is where the file was read");
  // Both the resolve and the submit went through the front, with the device token.
  const runLog = readFileSync(s.log, "utf8");
  expect(runLog).toMatch(/front POST \/v1\/references\/resolve 200 bearer=yes/);
  expect(runLog).toMatch(/front POST \/v1\/submit 200 bearer=yes/);
  await shoot(page, "36.11-08-remote-file", s);
});
