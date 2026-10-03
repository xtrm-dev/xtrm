import { expect, test, type Page } from "@playwright/test";
import { CODEWORD, MODEL, RETRY_MODEL, RETRY_REPLY, SKILL_TOKEN, TEMPLATE_REPLY, hostPayloads, launchTmux, log, passTrust, startPi, typeInTerminal, until } from "../real-host/harness.ts";
import { detail, ensurePi, expectSettled, frame, hostTypes, PROBE, send, settledOnHost, shoot, state, summary, watchConsole } from "./support.ts";

// Launch, resource discovery and retry criteria against the real host: §31-2, -3, -4, -5 and -8.
const RES = "acc-res";
const RETRY = "acc-retry";
const LAUNCHED = "acc-launched";

let res = "";

test.beforeAll(async () => {
  res = await ensurePi(RES, [PROBE]);
});

const openRes = async (page: Page) => {
  await page.goto(`/agent/${res}`);
  await page.getByRole("radio", { name: "All" }).click();
  await expect(page.getByTestId("session-header")).toContainText(RES);
};

test("§31-2 / §31-3 the operator picks a directory and a launch profile; the agent starts in tmux on the host and the GUI binds to it", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await openRes(page);
  await page.getByRole("button", { name: "New session" }).click();
  const form = page.getByTestId("new-session");
  // The open session's cwd on the host is the default directory.
  await expect(form.getByLabel("Working directory")).toHaveValue(s.work);
  await expect(form.getByRole("radio", { name: "pi", exact: true })).toHaveAttribute("aria-checked", "true");
  // Never an Anthropic model with pi: the bridge refuses it before the host sees it.
  await form.getByLabel("Name").fill(LAUNCHED);
  await form.getByLabel("Model").fill("anthropic/claude-sonnet-5-5");
  await form.getByRole("button", { name: "Start session" }).click();
  await expect(form.getByRole("alert")).toContainText("Anthropic models are not launched with pi");
  await form.getByLabel("Model").fill(MODEL);
  await shoot(page, "31-02-new-session-form", s);

  const launched = page.waitForResponse((r) => r.url().endsWith("/api/v1/launch"));
  const startedAt = Date.now();
  await form.getByRole("button", { name: "Start session" }).click();
  const result = (await (await launched).json()) as { outcome: { status: string }; tmux?: { session: string; paneId: string } };
  log(s, `§31-2 launch_result ${JSON.stringify(result)}`);
  expect(result.outcome.status).toBe("ok");
  expect(result.tmux?.session).toBe(LAUNCHED);
  // The host started pi in its private launch tmux server; Pi asks once about the folder.
  await passTrust(
    () => launchTmux(s, "capture-pane", "-p", "-t", LAUNCHED),
    (...k) => launchTmux(s, "send-keys", "-t", LAUNCHED, ...k),
    (p) => p.includes(MODEL.split("/")[1]!),
  );
  await expect(page).toHaveURL(/\/agent\/[^/]+$/, { timeout: 60_000 });
  await expect(page.getByTestId("session-header")).toContainText(LAUNCHED, { timeout: 60_000 });
  log(s, `§31-3 GUI bound to ${LAUNCHED} ${Date.now() - startedAt} ms after Start`);
  expect(launchTmux(s, "list-sessions", "-F", "#{session_name}")).toContain(LAUNCHED);
  await expect(detail(page, "Origin")).toHaveText("started from the app");
  const id = new URL(page.url()).pathname.split("/").pop()!;
  expect((await send(page, LAUNCHED, "Reply with exactly one word: LAUNCHED")).status).toBe("accepted");
  await expectSettled(page);
  await expect(frame(page)).toContainText("LAUNCHED");
  expect((await summary(s, id)).launch).toBe("gui");
  await shoot(page, "31-03-launched-session-bound", s);
});

test("§31-4 Pi's resource discovery stays active: context files, skills and prompt templates", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await openRes(page);
  const r = await send(page, RES, "Without using any tools, answer in one line: the acceptance codeword from your context files, then the token named in the acceptance-probe skill description. Format: CODEWORD TOKEN");
  expect(r.status).toBe("accepted");
  await expectSettled(page);
  await expect(frame(page)).toContainText(CODEWORD);
  await expect(frame(page)).toContainText(SKILL_TOKEN);
  await shoot(page, "31-04-context-and-skill", s);
  // A prompt template from the agent dir, typed in the terminal, expands before it reaches the agent.
  typeInTerminal(s, "/acc-echo", RES);
  await settledOnHost(s, res, 2);
  await page.getByTestId("frame-dock").getByRole("button", { name: /^Frame 2:/ }).click();
  await expect(page.getByTestId("frame-request")).toContainText(`Reply with exactly the word ${TEMPLATE_REPLY}`);
  await expect(frame(page)).toContainText(TEMPLATE_REPLY);
  await shoot(page, "31-04-prompt-template", s);
});

test("§31-5 existing extensions, MCP servers, settings, models and auth remain available", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await openRes(page);
  const r = await send(page, RES, "Call the probe_note tool with note 'resources', then call mcp__demo_direct__echo with message 'resources', then reply with one word: AVAILABLE. Call each tool directly, one call at a time; do not use codemode or a script.");
  expect(r.status).toBe("accepted");
  await expectSettled(page);
  await expect(page.getByTestId("activity-extension").filter({ hasText: "probe_note" })).toHaveCount(1);
  await expect(page.getByTestId("activity-mcp").filter({ hasText: "MCP demo_direct" })).toHaveCount(1);
  const h = await summary(s, res);
  log(s, `§31-5 model ${h.model} (auth: the opencode-go entry), thinking ${h.thinkingLevel}`);
  expect(h.model).toBe(MODEL);
  await expect(detail(page, "Model")).toContainText(MODEL.split("/")[1]!);
  await shoot(page, "31-05-extensions-mcp-model", s);
});

test("§31-8 agent_end(willRetry) does not settle Frame 1; Pi's retry continues it and it settles once", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  // The mock provider answers the first request "overloaded" (retryable) and then streams RETRY_REPLY.
  const id = await startPi(s, RETRY, [], s.work, { model: RETRY_MODEL });
  await page.goto(`/agent/${id}`);
  await page.getByRole("radio", { name: "All" }).click();
  expect((await send(page, RETRY, "Say hello")).status).toBe("accepted");
  // Between the failed turn's agent_end and the retry (3 s backoff), the Frame stays working.
  await until("the failed turn's agent_end", async () => (await hostTypes(s, id)).includes("agent_end"), 60_000);
  const between = await hostTypes(s, id);
  log(s, `§31-8 after the failed turn: ${between.join(" ")}`);
  if (!between.includes("agent_settled")) {
    await expect(frame(page)).toHaveAttribute("data-frame-status", "working");
    await expect(frame(page).locator('[data-activity="retry"]')).toContainText("Provider error");
    await shoot(page, "31-08-working-after-failed-turn", s);
  }
  await expectSettled(page, 60_000);
  const types = await hostTypes(s, id);
  const errors = (await hostPayloads(s, id)).filter((p) => p.type === "message_end" && (p as unknown as { message: { stopReason?: string } }).message.stopReason === "error");
  log(s, `§31-8 host events: ${types.join(" ")}`);
  expect(errors.length).toBeGreaterThanOrEqual(1);
  expect(types.filter((t) => t === "agent_settled")).toHaveLength(1);
  expect(types.filter((t) => t === "before_agent_start")).toHaveLength(1);
  await expect(page.getByTestId("frame-settled")).toContainText("Frame 1 · settled");
  await expect(frame(page)).toContainText(RETRY_REPLY);
  await expect(frame(page).locator('[data-activity="retry"]')).toContainText("Retried after a provider error");
  await shoot(page, "31-08-retried-settled-once", s);
});
