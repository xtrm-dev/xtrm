import { expect, test, type Page } from "@playwright/test";
import { frameTitle } from "../../src/adapters/agent/projector.ts";
import { hostGet, hostPayloads, log, startPi } from "../real-host/harness.ts";
import { dockFrames, ensurePi, expectSettled, frame, hostTypes, send, sessionRow, settledOnHost, shoot, state, summary, watchConsole } from "./support.ts";

// Frame criteria against the real host: §31-6, -7, -9 … -17, -26, -27, -28 and §36.11-2, plus the reply
// line-break behaviour from the acceptance review (XTRM-615).
const NAME = "acc-frames";
const OTHER = "acc-frames-peer";
const TOOLS = "Use the read tool to read notes.txt, then use the bash tool to run `ls`, then answer with the first line of notes.txt only. Call each tool directly, one call at a time; do not use codemode or a script.";
const LONG = "Use the bash tool to run `seq 1 4000`, then reply with exactly one word: LISTED.";
const COUNT = "Count from 1 to 400, one number per line, no other text.";

let id = "";
let peer = "";

test.beforeAll(async () => {
  id = await ensurePi(NAME);
  peer = await ensurePi(OTHER);
});

const open = async (page: Page) => {
  await page.goto(`/agent/${id}`);
  await page.getByRole("radio", { name: "All" }).click();
  await expect(page.getByTestId("session-header")).toContainText(NAME);
};

test("§31-6 a first submit creates Frame 1", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  await expect(page.getByText("No Frames yet")).toBeVisible();
  expect((await send(page, NAME, TOOLS)).status).toBe("accepted");
  await expect(page.getByTestId("frame-request")).toContainText("Use the read tool to read notes.txt");
  await expect(dockFrames(page)).toHaveCount(1);
  await expect(dockFrames(page).first()).toHaveAccessibleName(/^Frame 1: /);
  await shoot(page, "31-06-first-frame", s);
});

test("§31-7 real assistant and tool activity is projected into Frame 1", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  await expect(page.getByTestId("activity-native").first()).toBeVisible({ timeout: 120_000 });
  await expectSettled(page);
  await expect(page.getByTestId("activity-native").first()).toContainText(/Read 1 file|Read \d+ files/);
  await expect(page.getByTestId("activity-native").filter({ hasText: /[Rr]an \d+ command/ })).toHaveCount(1);
  await expect(frame(page)).toContainText("hello from the real-host run");
  const types = await hostTypes(s, id);
  log(s, `§31-7 host events for Frame 1: ${types.join(" ")}`);
  expect(types.filter((t) => t === "tool_execution_start").length).toBeGreaterThanOrEqual(2);
  await shoot(page, "31-07-activity-projected", s);
});

test("§31-9 agent_settled settles Frame 1 exactly once", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  await expectSettled(page);
  const types = await hostTypes(s, id);
  expect(types.filter((t) => t === "agent_settled")).toHaveLength(1);
  expect(types.lastIndexOf("agent_end")).toBeLessThan(types.indexOf("agent_settled"));
  await expect(page.getByTestId("frame-settled")).toHaveCount(1);
  await expect(page.getByTestId("frame-settled")).toContainText("Frame 1 · settled");
  expect((await summary(s, id)).frameCount).toBe(1);
  await shoot(page, "31-09-settled-once", s);
});

test("§31-10 a second idle submit creates Frame 2", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  expect((await send(page, NAME, LONG)).status).toBe("accepted");
  await expect(page.getByTestId("frame-request")).toContainText("seq 1 4000");
  await expect(dockFrames(page)).toHaveCount(2);
  await expectSettled(page);
  expect((await settledOnHost(s, id, 2)).frameCount).toBe(2);
  await shoot(page, "31-10-second-frame", s);
});

test("§31-11 Frames 1 and 2 switch without re-prompting the agent", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  const starts = (await hostTypes(s, id)).filter((t) => t === "before_agent_start").length;
  const submits: string[] = [];
  page.on("request", (r) => r.url().endsWith("/api/v1/submit") && submits.push(r.url()));
  for (const n of [0, 1, 0, 1]) {
    await dockFrames(page).nth(n).click();
    await expect(page.getByTestId("frame-request")).toContainText(n === 0 ? "read notes.txt" : "seq 1 4000");
  }
  expect(submits).toHaveLength(0);
  expect((await hostTypes(s, id)).filter((t) => t === "before_agent_start")).toHaveLength(starts);
  await dockFrames(page).first().click();
  await shoot(page, "31-11-frames-switch", s);
});

test("§31-12 the current Frame is the foreground surface, not an unbounded transcript", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  await expect(dockFrames(page)).toHaveCount(2);
  // One Frame article is mounted at a time; the other Frame's request is not on the page.
  await expect(frame(page)).toHaveCount(1);
  await expect(page.getByTestId("frame-request")).toContainText("seq 1 4000");
  await expect(page.getByTestId("frame-request")).toHaveCount(1);
  await expect(page.getByTestId("frame-request")).not.toContainText("Use the read tool to read notes.txt");
  await shoot(page, "31-12-foreground-frame", s);
});

test("§31-13 recent Frames are reachable from a dock beneath the composer", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  const composerBox = (await page.getByTestId("composer").boundingBox())!;
  const dockBox = (await page.getByTestId("frame-dock").boundingBox())!;
  expect(dockBox.y).toBeGreaterThanOrEqual(composerBox.y + composerBox.height - 1);
  await dockFrames(page).first().click();
  await expect(page.getByTestId("frame-request")).toContainText("read notes.txt");
  await shoot(page, "31-13-frame-dock", s);
});

test("§31-14 History expands into a Frames projection without occupying a sidebar", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  const mainBefore = (await page.getByTestId("agent-surface").boundingBox())!.width;
  await page.getByTestId("frame-dock").getByRole("button", { name: "History" }).click();
  const list = page.getByRole("list", { name: "Frames" });
  await expect(list.getByRole("button")).toHaveCount(2);
  await shoot(page, "31-14-history-frames", s);
  // An overlay: the Frame surface keeps its width; choosing a Frame closes it.
  expect((await page.getByTestId("agent-surface").boundingBox())!.width).toBe(mainBefore);
  await list.getByRole("button").last().click();
  await expect(list).toHaveCount(0);
  await expect(page.getByTestId("frame-request")).toContainText("read notes.txt");
});

test("§31-15 [deviation] History offers the Tree projection tab; the provider-native tree is not projected yet", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  await page.getByTestId("frame-dock").getByRole("button", { name: "History" }).click();
  await page.getByRole("tab", { name: "tree" }).click();
  await expect(page.getByText("The provider-native branch and fork tree is not projected yet")).toBeVisible();
  log(s, "§31-15 deviation: the Tree tab states that the provider-native tree is not projected (PRD §36.13)");
  await shoot(page, "31-15-tree-deviation", s);
});

test("§31-16 activity groups are collapsed by default and can be inspected", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  await dockFrames(page).first().click();
  const group = page.getByTestId("activity-native").first();
  const toggle = group.getByRole("button").first();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(group.getByRole("button", { name: /^read / })).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(group.getByRole("button", { name: /^read .*notes\.txt/ }).first()).toBeVisible();
  await shoot(page, "31-16-groups-collapsed-inspectable", s);
});

test("§31-17 a tool's command and output detail mounts lazily", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  await dockFrames(page).first().click();
  const group = page.getByTestId("activity-native").filter({ hasText: /[Rr]an \d+ command/ });
  await group.getByRole("button").first().click();
  const ls = group.getByRole("button", { name: /^bash ls/ });
  await expect(ls).toBeVisible();
  // The ls output (the work dir holds notes.txt and AGENTS.md) is not in the DOM until the row opens.
  await expect(group.getByText("AGENTS.md")).toHaveCount(0);
  await ls.click();
  await expect(group.getByText("AGENTS.md").first()).toBeVisible();
  await shoot(page, "31-17-lazy-tool-detail", s);
});

test("§31-27 a long tool output is not mounted eagerly", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  await dockFrames(page).nth(1).click();
  const before = await page.evaluate(() => document.body.innerText.length);
  const group = page.getByTestId("activity-native").filter({ hasText: /[Rr]an \d+ command/ });
  await expect(page.getByText("3999", { exact: true })).toHaveCount(0);
  await group.getByRole("button").first().click();
  await group.getByRole("button", { name: /^bash seq 1 4000/ }).click();
  await expect(group.getByText(/3999/).first()).toBeAttached();
  const after = await page.evaluate(() => document.body.innerText.length);
  log(s, `§31-27 page text ${before} chars before opening the seq output, ${after} after`);
  // Pi's bash tool keeps the tail of a long output; it still adds thousands of characters once opened.
  expect(after - before).toBeGreaterThan(5_000);
  await shoot(page, "31-27-long-output-lazy", s);
});

test("§36.11-2 switching halves, sessions and Frames does not interrupt a working session (§31-26)", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  const settledBefore = (await hostTypes(s, id)).filter((t) => t === "agent_settled").length;
  expect((await send(page, NAME, COUNT)).status).toBe("accepted");
  await expect(frame(page)).toHaveAttribute("data-frame-status", "working", { timeout: 60_000 });
  // Halves.
  await page.getByRole("radio", { name: "Work" }).click();
  await expect(page.getByTestId("half-switch")).toBeVisible();
  await page.getByRole("radio", { name: "Agent" }).click();
  // Sessions.
  await sessionRow(page, OTHER).click();
  await expect(page.getByTestId("session-header")).toContainText(OTHER);
  await sessionRow(page, NAME).click();
  // Frames.
  await dockFrames(page).first().click();
  await dockFrames(page).last().click();
  await expect(page.getByTestId("frame-request")).toContainText("Count from 1 to 400");
  await expectSettled(page);
  const types = await hostTypes(s, id);
  expect(types.filter((t) => t === "agent_settled")).toHaveLength(settledBefore + 1);
  const ends = (await hostPayloads(s, id)).filter((p) => p.type === "message_end") as unknown as Array<{ message: { role: string; stopReason?: string } }>;
  expect(ends.filter((e) => e.message.role === "assistant").at(-1)!.message.stopReason).toBe("stop");
  await expect(frame(page)).toContainText("400");
  await expect(page.getByTestId("frame-settled")).toContainText("settled");
  log(s, `§36.11-2 Frame settled after half, session and Frame switches; stopReason stop; peer ${peer}`);
  await shoot(page, "36.11-02-stream-uninterrupted", s);
});

test("note: a plain-text reply keeps its line breaks (XTRM-615)", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  await dockFrames(page).last().click();
  await expect(page.getByTestId("frame-request")).toContainText("Count from 1 to 400");
  // innerText follows the rendering: collapsed newlines read as spaces, rendered breaks as newlines.
  const lines = await frame(page).locator(".xtrm-prose").last().evaluate((el) => (el as HTMLElement).innerText.split("\n").filter((l) => l.trim()).length);
  log(s, `XTRM-615 reply rendered as ${lines} lines`);
  expect(lines).toBeGreaterThanOrEqual(300);
  await shoot(page, "note-615-reply-line-breaks", s);
});

test("§31-28 no GUI-local state contradicts the provider-owned session history", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  await page.reload();
  await page.getByRole("radio", { name: "All" }).click();
  const host = await summary(s, id);
  const history = await hostGet<{ entries?: unknown[] }>(s, `/v1/sessions/${id}/history`);
  const prompts = (await hostPayloads(s, id)).filter((p) => p.type === "before_agent_start").map((p) => String((p as unknown as { prompt: string }).prompt));
  const shown = await dockFrames(page).evaluateAll((b) => b.map((x) => x.getAttribute("aria-label")));
  log(s, `§31-28 host frameCount ${host.frameCount}, history entries ${history.entries?.length ?? "?"}; dock ${JSON.stringify(shown)}`);
  expect(shown).toHaveLength(host.frameCount!);
  // Every Frame the provider recorded, in order, titled from its own request (frameTitle).
  expect(shown).toEqual(prompts.map((p, i) => `Frame ${i + 1}: ${frameTitle(p)}`));
  await shoot(page, "31-28-gui-matches-history", s);
});
