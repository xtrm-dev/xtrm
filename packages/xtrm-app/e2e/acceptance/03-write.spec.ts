import { expect, test, type Page } from "@playwright/test";
import { hostPayloads, log, startPi } from "../real-host/harness.ts";
import { composer, DELAY_PROBE, ensurePi, expectSettled, frame, hostCount, PROBE, send, settledOnHost, shoot, state, summary, watchConsole } from "./support.ts";

// Write-path criteria against the real host, with the XTRM-607 delay probe (before_agent_start held
// 6 s) so busy, steer and stop meet Pi's startup window: the steer outcome from the acceptance review,
// Stop followed by a follow-up, the composer while disconnected (XTRM-615), §36.11-12, -13 and -14.
const NAME = "acc-write";

let id = "";

test.beforeAll(async () => {
  id = await ensurePi(NAME, [PROBE, DELAY_PROBE]);
});

const open = async (page: Page) => {
  await page.goto(`/agent/${id}`);
  await page.getByRole("radio", { name: "All" }).click();
  await expect(page.getByTestId("session-header")).toContainText(NAME);
};

/** User messages the session received in its latest Frame, as Pi recorded them. */
async function lastFrameUserTexts(id: string) {
  const s = state();
  const payloads = await hostPayloads(s, id);
  const start = payloads.map((p) => p.type).lastIndexOf("before_agent_start");
  return payloads
    .slice(start)
    .filter((p) => p.type === "message_end" && (p as unknown as { message: { role: string } }).message.role === "user")
    .map((p) => JSON.stringify((p as unknown as { message: { content: unknown } }).message.content));
}

test("note: a steer sent in the startup window changes the answer (delay probe)", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  const starts = (await hostPayloads(s, id)).filter((p) => p.type === "before_agent_start").length;
  // No wait for the new Frame: the steer must land inside the startup window, before it opens.
  expect((await send(page, NAME, "Reply with exactly one word: ALPHA", undefined, { awaitFrame: false })).status).toBe("accepted");
  // The probe holds before_agent_start for 6 s: the session is working before Pi runs the turn.
  await expect(page.getByRole("radiogroup", { name: "Delivery while working" })).toBeVisible({ timeout: 5_000 });
  const steer = await send(page, NAME, "Change of plan: reply with exactly one word: BRAVO");
  log(s, `steer in the startup window: ${JSON.stringify(steer)}`);
  expect(steer.status).toBe("accepted");
  await shoot(page, "note-steer-startup-window", s);
  await expectSettled(page);
  await settledOnHost(s, id, starts + 1);
  log(s, `startup-window Frame user messages: ${(await lastFrameUserTexts(id)).join(" | ")}; reply: ${await frame(page).innerText()}`);
  expect((await hostPayloads(s, id)).filter((p) => p.type === "before_agent_start")).toHaveLength(starts + 1);
  await expect(frame(page)).toContainText("BRAVO");
});

test("note: a steer sent while a tool runs changes the in-flight answer (delay probe)", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  const tools = (await hostPayloads(s, id)).filter((p) => p.type === "tool_execution_start").length;
  const frames = (await summary(s, id)).frameCount ?? 0;
  expect((await send(page, NAME, "Use the bash tool to run `sleep 15`, then reply with exactly one word: DONE.")).status).toBe("accepted");
  await hostCount(s, id, "tool_execution_start", tools + 1);
  const steer = await send(page, NAME, "When the command finishes, reply with exactly the word STEERED instead of DONE.");
  expect(steer.status).toBe("accepted");
  await expect(frame(page)).toContainText("Delivered while working: When the command finishes", { timeout: 90_000 });
  await expectSettled(page);
  await settledOnHost(s, id, frames + 1);
  const users = await lastFrameUserTexts(id);
  log(s, `in-tool steer: Frame user messages ${users.join(" | ")}; reply: ${(await frame(page).innerText()).split("\n").slice(-3).join(" | ")}`);
  expect(users.some((u) => u.includes("STEERED"))).toBe(true);
  await expect(frame(page)).toContainText("STEERED");
  await shoot(page, "note-steer-outcome", s);
});

test("note: while the stream is disconnected the composer sends nothing (XTRM-615)", async ({ page, context }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  const frames = (await summary(s, id)).frameCount ?? 0;
  expect((await send(page, NAME, "Use the bash tool to run `sleep 20`, then reply with exactly one word: BACK.")).status).toBe("accepted");
  await expect(frame(page)).toHaveAttribute("data-frame-status", "working", { timeout: 60_000 });
  await context.setOffline(true);
  await expect(page.getByTestId("stream-state")).toHaveAttribute("data-stream", "disconnected", { timeout: 10_000 });
  await composer(page, NAME).fill("draft while disconnected");
  for (const name of ["Stop", "Steer", "Follow up", "Send"]) {
    const b = page.getByTestId("composer").getByRole("button", { name, exact: true });
    if (await b.count()) await expect(b).toBeDisabled();
  }
  await shoot(page, "note-615-composer-disconnected", s);
  await context.setOffline(false);
  await expect(page.getByTestId("stream-state")).toHaveAttribute("data-stream", "connected", { timeout: 15_000 });
  await expect(composer(page, NAME)).toHaveValue("draft while disconnected");
  await composer(page, NAME).fill("");
  await expectSettled(page);
  await settledOnHost(s, id, frames + 1);
});

test("note: Stop aborts the Frame, and a follow-up sent after it opens the next Frame", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  const tools = (await hostPayloads(s, id)).filter((p) => p.type === "tool_execution_start").length;
  const frames = (await summary(s, id)).frameCount ?? 0;
  expect((await send(page, NAME, "Use the bash tool to run `sleep 90`, then reply with exactly one word: LATE.")).status).toBe("accepted");
  await hostCount(s, id, "tool_execution_start", tools + 1);
  const stop = page.waitForResponse((r) => r.url().endsWith("/api/v1/submit"));
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  expect(((await (await stop).json()) as { status: string }).status).toBe("accepted");
  await expect(frame(page)).toHaveAttribute("data-frame-status", "aborted", { timeout: 30_000 });
  await shoot(page, "note-stop-aborted", s);
  expect((await send(page, NAME, "Reply with exactly one word: AFTERSTOP")).status).toBe("accepted");
  await expectSettled(page);
  const h = await settledOnHost(s, id, frames + 2);
  log(s, `stop then follow-up: host frameCount ${h.frameCount} (before ${frames}); dock ${await page.getByTestId("frame-dock").innerText()}`);
  await expect(page.getByTestId("frame-dock").getByRole("button", { name: /^Frame \d+:/ })).toHaveCount(h.frameCount!);
  await expect(frame(page)).toContainText("AFTERSTOP");
});

test("§36.11-12 native, MCP and Pi extension tool calls in one Frame render with distinct contracts", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  const frames = (await summary(s, id)).frameCount ?? 0;
  const prompt =
    "Do exactly these three steps in order, then reply with one word: MIXED. " +
    "1) Use the read tool to read notes.txt. 2) Call the tool mcp__demo_direct__echo with message 'direct hello'. 3) Call the probe_note tool with note 'mixed frame'. Call each tool directly, one call at a time; do not use codemode or a script.";
  expect((await send(page, NAME, prompt)).status).toBe("accepted");
  await expectSettled(page);
  await settledOnHost(s, id, frames + 1);
  const native = page.getByTestId("activity-native").filter({ hasText: /Read \d+ file/ });
  const mcp = page.getByTestId("activity-mcp").filter({ hasText: "mcp__demo_direct__echo" });
  const ext = page.getByTestId("activity-extension").filter({ hasText: "probe_note" });
  await expect(native).toHaveCount(1);
  await expect(mcp).toContainText("MCP demo_direct");
  await expect(ext).toHaveCount(1);
  await mcp.getByRole("button").first().click();
  await expect(mcp).toContainText("MCP server demo_direct");
  await ext.getByRole("button").first().click();
  await expect(ext).toContainText("Pi extension");
  await expect(ext).toContainText("probe note recorded: mixed frame");
  const origins = (await hostPayloads(s, id)).filter((p) => p.type === "tool_execution_start").slice(-3).map((p) => (p as unknown as { toolName: string; origin?: unknown }).toolName + ":" + JSON.stringify((p as unknown as { origin?: unknown }).origin));
  log(s, `§36.11-12 host origins: ${origins.join(" ")}`);
  await shoot(page, "36.11-12-tool-classes", s);
});

test("§36.11-13 an extension confirm renders inline in the Frame and the answer reaches the extension", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  const frames = (await summary(s, id)).frameCount ?? 0;
  expect((await send(page, NAME, "Probe run A601: call the probe_confirm tool now, then reply with its result in one short sentence.")).status).toBe("accepted");
  const request = page.getByTestId("extension-request");
  await expect(request).toContainText("Allow the probe?", { timeout: 120_000 });
  await expect(frame(page).getByTestId("extension-request")).toHaveCount(1);
  await shoot(page, "36.11-13-extension-request-inline", s);
  await request.getByRole("button", { name: "Yes" }).click();
  await expect(page.getByTestId("extension-request-outcome")).toHaveText("Answered Yes");
  await expectSettled(page);
  await settledOnHost(s, id, frames + 1);
  const resolved = (await hostPayloads(s, id)).filter((p) => p.type === "extension_ui_resolved").at(-1);
  expect(resolved).toMatchObject({ resolvedBy: "host", outcome: "answered" });
  // The extension saw the answer: its tool result says so.
  const end = (await hostPayloads(s, id)).filter((p) => p.type === "tool_execution_end" && (p as unknown as { toolName: string }).toolName === "probe_confirm").at(-1);
  expect(JSON.stringify(end)).toContain("probe allowed");
  log(s, `§36.11-13 extension_ui_resolved ${JSON.stringify(resolved)}; probe_confirm result says allowed`);
  await shoot(page, "36.11-13-extension-answered", s);
});

test("§36.11-14 a specialist dispatch renders as coordination activity with transport detail on expand", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  const frames = (await summary(s, id)).frameCount ?? 0;
  expect(
    (await send(page, NAME, "Call the tool mcp__specialists__specialist_dispatch with specialist 'executor', issue 'XTRM-601' and prompt 'Run the acceptance checks'. Then reply with one word: DISPATCHED.")).status,
  ).toBe("accepted");
  await expectSettled(page);
  await settledOnHost(s, id, frames + 1);
  const start = (await hostPayloads(s, id)).filter((p) => p.type === "tool_execution_start").at(-1) as unknown as { toolName: string; origin: { class: string; server?: string } };
  log(s, `§36.11-14 host tool start ${start.toolName} origin ${JSON.stringify(start.origin)}`);
  expect(start.origin.class).toBe("coordination");
  const c = page.getByTestId("activity-coordination");
  await expect(c).toHaveCount(1);
  await expect(c).toContainText("Dispatched");
  await expect(c).toContainText("executor");
  await expect(c).toContainText("XTRM-601");
  await expect(c).not.toContainText("via MCP specialists");
  await c.getByRole("button", { name: "Transport details" }).click();
  await expect(c).toContainText("via MCP specialists · mcp__specialists__specialist_dispatch");
  await shoot(page, "36.11-14-coordination-dispatch", s);
});
