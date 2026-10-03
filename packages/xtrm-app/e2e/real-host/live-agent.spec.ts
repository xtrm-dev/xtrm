import { expect, test, type Page } from "@playwright/test";
import { CLAUDE_NAME, CLAUDE_SESSION, PI_NAME, claudeHook, log, startPi, tmux, typeInTerminal, until, type RealHostState } from "./harness.ts";

// XTRM-572 validation against a real host: a real Pi session in tmux, a prompt typed in its terminal,
// Frames, tool origins, a codemode script with nested calls, a Claude presence session, history only.
const OUT = "docs/screenshots/agent-half/real-host";
const state = () => JSON.parse(process.env.XTRM_REAL_HOST_STATE!) as RealHostState;

const PROMPT =
  "Do exactly these three steps in order, then answer in one short sentence. " +
  "1) Use the read tool to read notes.txt. " +
  "2) Call the tool mcp__demo_direct__echo with message 'direct hello'. " +
  "3) Run ONE codemode script that awaits tools.mcp__demo_script__echo({message: 'from script'}) and tools.read({path: 'notes.txt'}) and returns both results.";

const sessionRow = (page: Page, name: string) => page.getByTestId("session-row").filter({ hasText: name });

/** Event types the host retained for one session, read from its replay buffer (Last-Event-ID 0). */
async function hostEvents(s: RealHostState, sessionId: string): Promise<string[]> {
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 1_500);
  const types: string[] = [];
  try {
    const res = await fetch(`http://127.0.0.1:${s.port}/v1/events?sessionId=${encodeURIComponent(sessionId)}`, { headers: { "last-event-id": "0" }, signal: ctl.signal });
    const dec = new TextDecoder();
    let buf = "";
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) buf += dec.decode(chunk, { stream: true });
    } catch {
      // aborted after the replay was written
    }
    for (const line of buf.split("\n")) if (line.startsWith("data: ")) types.push((JSON.parse(line.slice(6)) as { frame: { payload: { type: string } } }).frame.payload.type);
  } catch {
    // host unreachable: no events
  }
  return types;
}

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

/** On failure: the pi pane, the host's view of the session, and its retained event types. */
async function diagnose(s: RealHostState, piId: string) {
  try {
    log(s, `pane:\n${tmux(s, "capture-pane", "-p", "-t", PI_NAME).trim().split("\n").slice(-25).join("\n")}`);
  } catch {
    log(s, "pane: gone");
  }
  try {
    const d = await (await fetch(`http://127.0.0.1:${s.port}/v1/sessions/${piId}`)).json();
    log(s, `host session: ${JSON.stringify(d.session)}`);
  } catch (e) {
    log(s, `host session: ${String(e)}`);
  }
  log(s, `host events: ${(await hostEvents(s, piId)).join(" ")}`);
}

test("live Agent half against a real xt host", async ({ page }) => {
  const s = state();
  page.on("console", (m) => m.type() === "error" && log(s, `browser console: ${m.text()}`));
  const piId = await startPi(s);
  log(s, `pi session id ${piId}`);
  test.info().annotations.push({ type: "pi-session", description: piId });
  try {
    await validate(page, s, piId);
  } catch (e) {
    await diagnose(s, piId);
    throw e;
  }
});

async function validate(page: Page, s: RealHostState, piId: string) {

  await test.step("the pi session appears in the sidebar with live state", async () => {
    await page.goto(`/agent/${piId}`);
    await page.getByRole("radio", { name: "All" }).click();
    await expect(sessionRow(page, PI_NAME)).toHaveAttribute("aria-label", `${PI_NAME} · settled`);
    await expect(page.getByTestId("session-header")).toContainText(PI_NAME);
    await expect(page.getByTestId("session-details")).toContainText("settled · prompt · steer");
    await expect(page.getByTestId("session-details")).toContainText(`${PI_NAME}:%`);
  });

  await test.step("a prompt typed in the terminal opens a Frame that settles once", async () => {
    typeInTerminal(s, PROMPT);
    await expect(sessionRow(page, PI_NAME)).toHaveAttribute("aria-label", `${PI_NAME} · working`, { timeout: 30_000 });
    const frame = page.getByTestId("frame");
    await expect(frame).toHaveAttribute("data-frame-status", "working");
    await expect(page.getByTestId("frame-request")).toContainText("Do exactly these three steps");
    log(s, "frame open (working) in the UI");
    await expect(frame).toHaveAttribute("data-frame-status", "settled", { timeout: 240_000 });
    await expect(sessionRow(page, PI_NAME)).toHaveAttribute("aria-label", `${PI_NAME} · settled`);
    await expect(page.getByTestId("frame-settled")).toHaveCount(1);
    await expect(page.getByTestId("frame-settled")).toContainText("Frame 1 · settled");
    await expect(page.getByTestId("frame-dock").getByRole("button", { name: /^Frame \d+:/ })).toHaveCount(1);
    log(s, `frame settled in the UI; pane tail:\n${tmux(s, "capture-pane", "-p", "-t", PI_NAME).trim().split("\n").slice(-6).join("\n")}`);
  });

  await test.step("tool origins: read is native, MCP shows its server, codemode nests its calls", async () => {
    const native = page.getByTestId("activity-native").filter({ hasText: /Read \d+ file/ });
    await expect(native).toBeVisible();
    await native.first().getByRole("button").first().click();
    await expect(native.first().getByRole("button", { name: /read .*notes\.txt/ })).toBeVisible();

    const mcp = page.getByTestId("activity-mcp").filter({ hasText: "mcp__demo_direct__echo" });
    await expect(mcp).toContainText("MCP demo_direct");

    const script = page.getByTestId("activity-script");
    await expect(script).toHaveCount(1);
    await expect(script.getByTestId("script-verdict")).toHaveText("Script completed");
    const nested = script.getByTestId("nested-call");
    await expect(nested.filter({ hasText: "mcp__demo_script__echo" })).toHaveAttribute("data-class", "mcp");
    await expect(nested.filter({ hasText: "mcp__demo_script__echo" })).toContainText("MCP demo_script");
    await expect(nested.filter({ hasText: /^nativeread/ })).toHaveAttribute("data-class", "native");
    // Nested calls never appear as top-level rows.
    await expect(page.getByTestId("activity-mcp").filter({ hasText: "mcp__demo_script__echo" })).toHaveCount(0);
    await script.getByRole("button", { name: "Script source" }).click();
    await expect(script.getByTestId("script-source")).toContainText("tools.mcp__demo_script__echo");
    await shoot(page, "frame-tool-origins");
  });

  await test.step("the host closed the Frame exactly once", async () => {
    const types = await hostEvents(s, piId);
    log(s, `host replay for ${piId}: ${types.length} events; ${types.filter((t) => t.startsWith("tool_execution_start")).length} tool starts`);
    expect(types.filter((t) => t === "before_agent_start")).toHaveLength(1);
    expect(types.filter((t) => t === "agent_settled")).toHaveLength(1);
    expect(types.indexOf("agent_end")).toBeLessThan(types.indexOf("agent_settled"));
    const detail = await (await fetch(`http://127.0.0.1:${s.port}/v1/sessions/${piId}`)).json();
    expect(detail.session.frameCount).toBe(1);
    log(s, `host session detail: frameCount ${detail.session.frameCount}, state ${detail.session.state}`);
  });

  await test.step("a Claude presence session (hook reporter) shows presence only", async () => {
    claudeHook(s, { hook_event_name: "SessionStart", source: "startup" });
    claudeHook(s, { hook_event_name: "UserPromptSubmit", prompt: "not reported" });
    claudeHook(s, { hook_event_name: "PreToolUse", tool_use_id: "toolu_572_1", tool_name: "Read", tool_input: { file_path: `${s.work}/notes.txt` } });
    claudeHook(s, { hook_event_name: "PostToolUse", tool_use_id: "toolu_572_1", tool_name: "Read", tool_response: {} });
    claudeHook(s, { hook_event_name: "Stop" });
    const row = sessionRow(page, CLAUDE_NAME);
    await expect(row).toHaveAttribute("aria-label", `${CLAUDE_NAME} · settled`);
    await expect(row).toContainText("claude");
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/agent/${CLAUDE_SESSION}$`));
    await expect(page.getByTestId("composer-notice")).toContainText("presence only");
    await expect(page.getByTestId("session-details")).toContainText("Claude Code");
    await expect(page.getByTestId("session-details")).toContainText("settled · presence only");
    await expect(page.getByTestId("frame")).toHaveAttribute("data-frame-status", "settled");
    await expect(page.getByTestId("frame")).toContainText("Read");
    await shoot(page, "claude-presence");
  });

  await test.step("after pi quits, the session is history only", async () => {
    typeInTerminal(s, "/quit");
    await until(
      "the pi session to leave the live registry",
      async () => {
        const list = (await (await fetch(`http://127.0.0.1:${s.port}/v1/sessions`)).json()) as { sessions: Array<{ sessionId: string; state: string }> };
        return list.sessions.find((x) => x.sessionId === piId)?.state === "history_only";
      },
      60_000,
    );
    await page.goto(`/agent/${piId}`);
    await expect(page.getByTestId("session-header")).toContainText("history only");
    await expect(page.getByTestId("composer-notice")).toContainText("History only");
    await expect(page.getByTestId("session-details")).toContainText("Statehistory only");
    // The Frame projected while the session was live stays readable.
    await expect(page.getByTestId("frame")).toHaveAttribute("data-frame-status", "settled");
    await shoot(page, "history-only");
    log(s, "history-only session shown");
  });
}
