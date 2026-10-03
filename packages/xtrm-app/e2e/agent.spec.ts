import { expect, test, type Page } from "@playwright/test";

// Agent half behaviour on the typed fixture (PRD §36.11; real-host criteria move to XTRM-572).
const MOD = process.platform === "darwin" ? "Meta" : "Control";

const composer = (page: Page, session: string) => page.getByRole("textbox", { name: `Message ${session}` });
const sessionRow = (page: Page, name: string) => page.getByTestId("session-row").filter({ hasText: name });

test("the Console/Agent switch is always visible and returns each half to its last route", async ({ page }) => {
  await page.goto("/program");
  const sw = page.getByTestId("half-switch");
  await expect(sw).toBeVisible();
  await expect(page.getByRole("radio", { name: "Console" })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("radio", { name: "Agent" }).click();
  await expect(page).toHaveURL(/\/agent\/pi-main$/);
  await sessionRow(page, "test-engineer").click();
  await expect(page).toHaveURL(/\/agent\/test-engineer$/);

  await page.keyboard.press(`${MOD}+.`);
  await expect(page).toHaveURL(/\/program$/);
  await expect(sw).toBeVisible();

  await page.keyboard.press(`${MOD}+.`);
  await expect(page).toHaveURL(/\/agent\/test-engineer$/);

  // Console modes keep numbered shortcuts and leave the Agent half.
  await page.keyboard.press(`${MOD}+3`);
  await expect(page).toHaveURL(/\/program/);
});

test("session rows show live state, role, work item, model, context, and last activity", async ({ page }) => {
  await page.goto("/agent/pi-main");
  const row = sessionRow(page, "pi-main");
  await expect(row).toHaveAttribute("aria-label", "pi-main · working");
  await expect(row).toContainText("coordinator");
  await expect(row).toContainText("XTRM-310");
  await expect(row).toContainText("opus 5.5 · high");
  await expect(row).toContainText("64%");
  await expect(row).toContainText("now");
  await expect(page.getByTestId("session-details")).toContainText("opus 5.5 · high");
  await expect(page.getByTestId("session-details")).toContainText("anthropic");
  await expect(page.getByTestId("session-details")).toContainText("64% · 128k / 200k");
  // A large-context one-decimal share shows its decimal, never a rounded 0% (XTRM-612).
  await expect(sessionRow(page, "quant-reviewer")).toContainText("1.0%");
  await expect(page.getByTestId("session-details")).toContainText("started in a terminal");

  // Children thread under their coordinator; history-only sessions sit apart.
  await expect(sessionRow(page, "quant-reviewer")).toHaveAttribute("aria-label", "quant-reviewer · waiting for input");
  await expect(sessionRow(page, "docs-sweep")).toHaveAttribute("aria-label", "docs-sweep · history only");

  // Scope: this repository by default; All adds other repositories and Other.
  await expect(sessionRow(page, "host-core")).toHaveCount(0);
  await page.getByRole("radio", { name: "All" }).click();
  await expect(sessionRow(page, "host-core")).toBeVisible();
  await expect(page.getByText("xtrm-dev/core", { exact: true })).toBeVisible();
});

test("history-only and presence-only sessions cannot be prompted", async ({ page }) => {
  await page.goto("/agent/docs-sweep");
  await expect(page.getByTestId("composer-notice")).toContainText("History only");
  await expect(page.getByRole("textbox", { name: /Message/ })).toHaveCount(0);

  await page.goto("/agent/claude-ui");
  await expect(page.getByTestId("composer-notice")).toContainText("presence only");
});

test("switching sessions restores the selected Frame, scroll position, and draft", async ({ page }) => {
  await page.goto("/agent/pi-main");
  await page.getByRole("button", { name: /^Frame 2: Split the tranche/ }).click();
  await expect(page.getByTestId("frame-request")).toContainText("Split the agent harness tranche");
  const scroll = page.getByTestId("frame-scroll");
  await page.setViewportSize({ width: 1440, height: 560 });
  await scroll.evaluate((el) => (el.scrollTop = 140));
  await composer(page, "pi-main").fill("draft kept across sessions");

  await sessionRow(page, "test-engineer").click();
  await expect(page.getByTestId("frame-request")).toContainText("Add Playwright coverage");
  await sessionRow(page, "pi-main").click();

  await expect(page.getByTestId("frame-request")).toContainText("Split the agent harness tranche");
  await expect(composer(page, "pi-main")).toHaveValue("draft kept across sessions");
  expect(await scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
});

test("a submit opens a new Frame that keeps streaming while another session is in view", async ({ page }) => {
  await page.goto("/agent/test-engineer");
  await composer(page, "test-engineer").fill("Cover the drawer attach flow");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("frame-request")).toHaveText("Cover the drawer attach flow");
  await expect(page.getByTestId("frame")).toHaveAttribute("data-frame-status", "working");
  await expect(page.getByRole("button", { name: /^Frame 2: Cover the drawer attach flow/ })).toBeVisible();

  await sessionRow(page, "pi-main").click();
  await expect(sessionRow(page, "test-engineer")).toHaveAttribute("aria-label", "test-engineer · settled", { timeout: 10_000 });
  await sessionRow(page, "test-engineer").click();
  await expect(page.getByTestId("frame")).toHaveAttribute("data-frame-status", "settled");
  await expect(page.getByTestId("frame-settled")).toContainText("Frame 2 · settled");
});

test("the @ picker inserts typed references that travel with the Frame and never message the referenced session", async ({ page }) => {
  await page.goto("/agent/test-engineer");
  const box = composer(page, "test-engineer");
  await box.click();
  await box.pressSequentially("Compare with @quant");
  const picker = page.getByTestId("reference-picker");
  await expect(picker.getByRole("option").first()).toContainText("quant-reviewer");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("composer-ref")).toContainText("quant-reviewer");
  await expect(box).toHaveValue("Compare with ");

  await box.pressSequentially("@pr:212");
  await expect(picker.getByRole("option")).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("composer-ref")).toHaveCount(2);

  await box.pressSequentially("the review");
  await page.keyboard.press("Enter");
  const frame = page.getByTestId("frame");
  await expect(frame.locator('[data-reference="@session:quant-reviewer"]')).toBeVisible();
  await expect(frame.locator('[data-reference="@pr:xtrm-dev/xtrm#212"]')).toBeVisible();
  await expect(page.getByTestId("composer-ref")).toHaveCount(0);

  // A reference attaches context only: quant-reviewer received no new Frame.
  await sessionRow(page, "quant-reviewer").click();
  await expect(page.getByRole("navigation", { name: "Frames" }).getByRole("button", { name: /^Frame / })).toHaveCount(1);
});

test("an unresolvable typed reference blocks submit", async ({ page }) => {
  await page.goto("/agent/test-engineer");
  const box = composer(page, "test-engineer");
  await box.fill("Look at @issue:NOPE-1 first");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Unresolved reference @issue:NOPE-1");
  await expect(page.getByRole("navigation", { name: "Frames" }).getByRole("button", { name: /^Frame / })).toHaveCount(1);
  await expect(box).toHaveValue("Look at @issue:NOPE-1 first");
});

test("the drawer attaches an inspected entity to the composer", async ({ page }) => {
  await page.goto("/agent/pi-main");
  await page.getByRole("button", { name: /^Frame 2: Split the tranche/ }).click();
  await page.getByTestId("frame").getByRole("button", { name: "Session quant-reviewer" }).first().click();
  await expect(page.getByTestId("session-panel")).toContainText("quant-reviewer");
  // Repository identity (owner/name) and its root on the host (XTRM-609).
  await expect(page.getByTestId("session-panel")).toContainText("xtrm-dev/xtrm");
  await expect(page.getByTestId("session-panel")).toContainText("~/dev/xtrm");
  await page.getByRole("button", { name: "Attach to composer" }).click();
  await expect(page.getByTestId("composer-ref")).toContainText("quant-reviewer");

  // The session in the main surface is never offered as its own attachment.
  await page.getByRole("button", { name: "Session options" }).click();
  await page.getByRole("menuitem", { name: "Inspect in drawer" }).click();
  await expect(page.getByTestId("session-panel")).toContainText("pi-main");
  await expect(page.getByRole("button", { name: "Attach to composer" })).toHaveCount(0);
});

test("native, MCP, extension, and coordination activity render with distinct contracts", async ({ page }) => {
  await page.goto("/agent/pi-main");
  await page.getByRole("button", { name: /^Frame 2: Split the tranche/ }).click();
  const frame = page.getByTestId("frame");

  const mcp = frame.getByTestId("activity-mcp");
  await expect(mcp).toContainText("MCP github");
  await mcp.getByRole("button", { name: /search_issues/ }).click();
  await expect(mcp).toContainText("perPage");
  await expect(mcp).toContainText("MCP server github · stdio");

  const ext = frame.getByTestId("activity-extension");
  await expect(ext).toContainText("pi-substrate 0.2.2");
  await ext.getByRole("button", { name: /plan_check/ }).click();
  await expect(ext).toContainText("Pi extension pi-substrate 0.2.2");

  await expect(frame.getByTestId("activity-coordination")).toHaveCount(2);
  await expect(frame.getByTestId("activity-coordination").first()).toContainText("Messaged");
  await frame.getByTestId("activity-coordination").first().getByRole("button", { name: "Transport details" }).click();
  await expect(frame).toContainText("via pi-intercom · direct message");

  await page.getByRole("button", { name: /^Frame 1: Map the Frame contract/ }).click();
  const native = page.getByTestId("activity-native");
  await expect(native).toHaveCount(1);
  await native.getByRole("button", { name: "Read 3 files · searched 1 pattern" }).click();
  await native.getByRole("button", { name: /grep agent_settled/ }).click();
  await expect(native).toContainText("agent_settled closes the Frame");
});

test("an extension UI request is answered inline and the session continues", async ({ page }) => {
  await page.goto("/agent/quant-reviewer");
  const request = page.getByTestId("extension-request");
  await expect(request).toContainText("Allow git push origin feature/XTRM-312?");
  await request.getByRole("button", { name: "Allow" }).click();
  await expect(page.getByText("Answered Allow")).toBeVisible();
  await expect(sessionRow(page, "quant-reviewer")).toHaveAttribute("aria-label", "quant-reviewer · settled", { timeout: 10_000 });
});

test("a working session takes explicit steer input instead of a new Frame", async ({ page }) => {
  await page.goto("/agent/pi-main");
  await expect(page.getByRole("radio", { name: "Steer" })).toHaveAttribute("aria-checked", "true");
  await composer(page, "pi-main").fill("Skip the flaky suite for now");
  await page.getByRole("button", { name: "Steer", exact: true }).click();
  await expect(page.getByTestId("frame")).toContainText("Steer: Skip the flaky suite for now");
  await expect(page.getByRole("navigation", { name: "Frames" }).getByRole("button", { name: /^Frame / })).toHaveCount(3);
});

test("Stop aborts the working Frame and the Frame header names its ingress", async ({ page }) => {
  await page.goto("/agent/pi-main");
  await expect(page.getByTestId("frame-ingress")).toHaveText("terminal");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByTestId("frame")).toHaveAttribute("data-frame-status", "aborted");
  await expect(page.getByTestId("frame-settled")).toContainText("aborted");
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toHaveCount(0);
});

test("New session starts an agent in a chosen directory with a launch profile and opens it", async ({ page }) => {
  await page.goto("/agent/pi-main");
  await page.getByRole("button", { name: "New session" }).click();
  const form = page.getByTestId("new-session");
  // The open session's cwd is the default directory on the same host.
  await expect(form.getByLabel("Working directory")).toHaveValue("~/dev/xtrm/.xtrm/worktrees/xtrm-xt-pi-7k2m");
  await form.getByRole("radio", { name: "xt pi" }).click();
  await form.getByLabel("Name").fill("fixture-launch");
  await form.getByLabel("Role").fill("reviewer");
  await form.getByRole("button", { name: "Start session" }).click();
  await expect(page).toHaveURL(/\/agent\/fixture-launch$/);
  await expect(page.getByTestId("session-header")).toContainText("reviewer");
  await expect(page.getByTestId("session-details")).toContainText("started from the app");
});


test("/message delivers to the named session and opens no Frame in the sender", async ({ page }) => {
  await page.goto("/agent/test-engineer");
  const frames = page.getByRole("navigation", { name: "Frames" }).getByRole("button", { name: /^Frame / });
  const before = await frames.count();
  await composer(page, "test-engineer").fill("/message @session:host-core Please rebase on main");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("message-delivered")).toHaveText("Delivered to host-core.");
  await expect(composer(page, "test-engineer")).toHaveValue("");
  await expect(frames).toHaveCount(before);

  // The fixture keeps its state in the page: navigate in the app, never reload.
  await page.getByRole("radio", { name: "All" }).click();
  await sessionRow(page, "host-core").click();
  await expect(page.getByTestId("frame-request")).toContainText("Message from test-engineer (sent with /message from xtrm-app): Please rebase on main");

  // A history-only target cannot receive it; the composer says why and keeps the text.
  await sessionRow(page, "test-engineer").click();
  await composer(page, "test-engineer").fill("/message @session:docs-sweep hello");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("docs-sweep cannot receive messages (history only)");
});
