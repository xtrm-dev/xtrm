import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { hostPayloads, log, startPi, tmux, until, type RealHostState } from "./harness.ts";

// XTRM-597 validation against a real host: the Agent half acts on a live Pi session. A GUI prompt
// opens a Frame with ingress gui; a normal submit from a second app client while the session works
// is answered busy and its Steer reaches the session; Stop aborts the Frame; an extension confirm is
// answered once in the GUI (resolvedBy host) and once in the terminal (resolvedBy local).
const OUT = "docs/screenshots/agent-half/real-host";
const NAME = "write-pi";
const PROBE = resolve("e2e/real-host/probe-extension.ts");
const state = () => JSON.parse(process.env.XTRM_REAL_HOST_STATE!) as RealHostState;

// Each probe prompt asks for a new run: "exactly once" phrasing made the model refuse a second call.
const PROBE_PROMPT = (run: string) => `Probe run ${run}: call the probe_confirm tool now (a new, separate run), then reply with its result in one short sentence.`;
const pane = (s: RealHostState) => tmux(s, "capture-pane", "-p", "-t", NAME).trim().split("\n").slice(-12).join("\n");
const composer = (page: Page) => page.getByRole("textbox", { name: `Message ${NAME}` });
const lastFrame = (page: Page) => page.getByTestId("frame");

async function shoot(page: Page, name: string) {
  for (const t of ["light", "dark"] as const) {
    await page.evaluate((v) => {
      localStorage.setItem("xtrm.console.theme.v1", v);
      document.documentElement.dataset.theme = v;
    }, t);
    await page.reload();
    await expect(page.getByTestId("agent-surface")).toBeVisible();
    await page.screenshot({ path: `${OUT}/${t}-${name}.png` });
  }
}

/** Send from the composer and return the host's submit_result as the bridge answered it. */
async function send(page: Page, text: string, how: () => Promise<void> = () => composer(page).press("Enter")) {
  await composer(page).fill(text);
  const answer = page.waitForResponse((r) => r.url().endsWith("/xtrm-api/agent-host/api/v1/submit"));
  await how();
  return (await (await answer).json()) as { status: string; reason?: string; commandId: string };
}

/** Wait until the host has seen `n` events of `type` for the session. */
const hostCount = (s: RealHostState, id: string, type: string, n: number, timeoutMs = 120_000) =>
  until(`${n} × ${type}`, async () => (await hostPayloads(s, id)).filter((p) => p.type === type).length >= n, timeoutMs);

test("live Agent half write path against a real xt host", async ({ page }) => {
  test.setTimeout(900_000);
  const s = state();
  page.on("console", (m) => m.type() === "error" && log(s, `browser console: ${m.text()}`));
  const id = await startPi(s, NAME, [PROBE]);
  test.info().annotations.push({ type: "pi-session", description: id });
  try {
    await validate(page, s, id);
  } catch (e) {
    try {
      log(s, `pane:\n${pane(s)}`);
      log(s, `host events: ${(await hostPayloads(s, id)).map((p) => p.type).join(" ")}`);
    } catch {
      // diagnostics are best effort
    }
    throw e;
  }
});

async function validate(page: Page, s: RealHostState, id: string) {
  await page.goto(`/agent/${id}`);
  await expect(page.getByTestId("session-details")).toContainText("settled · prompt · steer · abort");

  await test.step("a GUI prompt opens a Frame with ingress gui that settles", async () => {
    const r = await send(page, "Reply with exactly one word: PONG");
    log(s, `GUI prompt: submit_result ${JSON.stringify(r)}`);
    expect(r.status).toBe("accepted");
    await expect(page.getByTestId("frame-request")).toContainText("Reply with exactly one word: PONG");
    await expect(page.getByTestId("frame-ingress")).toHaveText("GUI");
    await expect(lastFrame(page)).toHaveAttribute("data-frame-status", "settled", { timeout: 120_000 });
    const start = (await hostPayloads(s, id)).find((p) => p.type === "before_agent_start") as unknown as { ingress: { origin: string; commandId?: string } };
    expect(start.ingress).toEqual({ origin: "gui", commandId: r.commandId });
    log(s, `GUI Frame settled; host before_agent_start ingress ${JSON.stringify(start.ingress)}`);
    await shoot(page, "gui-prompt");
  });

  await test.step("a normal submit while working returns busy, and its Steer reaches the session", async () => {
    // A second app client whose view is still idle: its event stream is cut, so it sends a normal
    // prompt. This is the race §35.8 item 5 resolves on the host: the first accepted submit wins.
    const other = await page.context().newPage();
    await other.route("**/xtrm-api/agent-host/api/v1/events*", (route) => route.abort());
    await other.goto(`/agent/${id}`);
    await expect(composer(other)).toBeVisible();

    const r = await send(page, "Use the bash tool to run `sleep 20`, then reply with one word: DONE.");
    expect(r.status).toBe("accepted");
    await hostCount(s, id, "tool_execution_start", 1);
    await expect(page.getByTestId("session-header")).toContainText("working");
    log(s, "first GUI prompt is running its bash tool");

    const busy = await send(other, "Also add the word STEERED to your reply.");
    log(s, `second GUI prompt while working: submit_result ${JSON.stringify(busy)}`);
    expect(busy.status).toBe("busy");
    await expect(other.getByRole("alert")).toContainText("The session is working");
    await expect(other.getByRole("button", { name: "Send as steer" })).toBeVisible();
    await expect(other.getByRole("button", { name: "Send as follow-up" })).toBeVisible();
    // The second client keeps the theme the previous step left; one screenshot is enough here.
    await other.screenshot({ path: `${OUT}/busy-offers-steer.png` });

    const steerAnswer = other.waitForResponse((res) => res.url().endsWith("/xtrm-api/agent-host/api/v1/submit"));
    await other.getByRole("button", { name: "Send as steer" }).click();
    const steer = (await (await steerAnswer).json()) as { status: string };
    log(s, `steer: submit_result ${JSON.stringify(steer)}`);
    expect(steer.status).toBe("accepted");
    await expect(composer(other)).toHaveValue("");
    await other.close();

    await expect(lastFrame(page)).toContainText("Delivered while working: Also add the word STEERED to your reply.", { timeout: 90_000 });
    await expect(lastFrame(page)).toHaveAttribute("data-frame-status", "settled", { timeout: 120_000 });
    // One Frame: the steer joined the running Frame instead of opening another.
    expect((await hostPayloads(s, id)).filter((p) => p.type === "before_agent_start")).toHaveLength(2);
    log(s, `steered Frame settled; response: ${(await page.getByTestId("frame").innerText()).split("\n").slice(-3).join(" | ")}`);
    await shoot(page, "steer-delivered");
  });

  await test.step("Stop aborts the running Frame", async () => {
    const starts = (await hostPayloads(s, id)).filter((p) => p.type === "tool_execution_start").length;
    const r = await send(page, "Use the bash tool to run `sleep 90`, then reply with one word: DONE.");
    expect(r.status).toBe("accepted");
    await hostCount(s, id, "tool_execution_start", starts + 1);
    const stopAnswer = page.waitForResponse((res) => res.url().endsWith("/xtrm-api/agent-host/api/v1/submit"));
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    const stop = (await (await stopAnswer).json()) as { status: string };
    log(s, `abort: submit_result ${JSON.stringify(stop)}`);
    expect(stop.status).toBe("accepted");
    await expect(lastFrame(page)).toHaveAttribute("data-frame-status", "aborted", { timeout: 30_000 });
    await expect(page.getByTestId("frame-settled")).toContainText("aborted");
    await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
    log(s, "Frame aborted from the GUI");
    await shoot(page, "abort");
  });

  await test.step("an extension confirm answered in the GUI resolves with resolvedBy host", async () => {
    const r = await send(page, PROBE_PROMPT("A"));
    expect(r.status).toBe("accepted");
    const request = page.getByTestId("extension-request");
    await expect(request).toContainText("Allow the probe?", { timeout: 120_000 });
    log(s, `terminal while the GUI shows the request:\n${pane(s)}`);
    await page.screenshot({ path: `${OUT}/light-extension-request-open.png` });
    await request.getByRole("button", { name: "Yes" }).click();
    const outcome = page.getByTestId("extension-request-outcome");
    await expect(outcome).toHaveText("Answered Yes");
    await expect(outcome).toHaveAttribute("data-resolved-by", "host");
    await expect(lastFrame(page)).toHaveAttribute("data-frame-status", "settled", { timeout: 120_000 });
    const resolved = (await hostPayloads(s, id)).filter((p) => p.type === "extension_ui_resolved");
    expect(resolved.at(-1)).toMatchObject({ resolvedBy: "host", outcome: "answered" });
    expect(pane(s)).not.toContain("Allow the probe?");
    log(s, `GUI answer: host extension_ui_resolved ${JSON.stringify(resolved.at(-1))}; terminal dialog dismissed`);
    await shoot(page, "extension-answered-gui");
  });

  await test.step("an extension confirm answered in the terminal closes the GUI block (resolvedBy local)", async () => {
    const r = await send(page, PROBE_PROMPT("B"));
    expect(r.status).toBe("accepted");
    await expect(page.getByTestId("extension-request")).toContainText("Allow the probe?", { timeout: 120_000 });
    await until("the terminal dialog", () => pane(s).includes("Allow the probe?"), 30_000);
    tmux(s, "send-keys", "-t", NAME, "Enter");
    log(s, "answered the confirm in the terminal (Enter on Yes)");
    const outcome = page.getByTestId("extension-request-outcome");
    await expect(outcome).toHaveText("Answered in the terminal");
    await expect(outcome).toHaveAttribute("data-resolved-by", "local");
    await expect(page.getByTestId("extension-request")).toHaveCount(0);
    await expect(lastFrame(page)).toHaveAttribute("data-frame-status", "settled", { timeout: 120_000 });
    const resolved = (await hostPayloads(s, id)).filter((p) => p.type === "extension_ui_resolved");
    expect(resolved.at(-1)).toMatchObject({ resolvedBy: "local", outcome: "answered" });
    log(s, `terminal answer: host extension_ui_resolved ${JSON.stringify(resolved.at(-1))}`);
    await shoot(page, "extension-answered-terminal");
  });

  const detail = (await (await fetch(`http://127.0.0.1:${s.port}/v1/sessions/${id}`)).json()) as { session: { frameCount: number; state: string } };
  log(s, `host session detail: frameCount ${detail.session.frameCount}, state ${detail.session.state}`);
  expect(detail.session.frameCount).toBe(5);
}
