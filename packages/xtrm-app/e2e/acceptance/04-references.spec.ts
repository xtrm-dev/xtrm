import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page, type Request } from "@playwright/test";
import { hostPayloads, log, startPi } from "../real-host/harness.ts";
import { composer, ensurePi, expectSettled, frame, sessionRow, settledOnHost, shoot, state, SUBMIT, summary, watchConsole } from "./support.ts";

// Reference criteria against the real host: §36.11-7, -9, -10, -11 and §31-24, -25. @issue resolves
// against the operator's board read only (SUBSTRATE_DB, XTRM_SUBSTRATE_WRITES=0); @gh-issue and @pr
// resolve through the GitHub adapter in fixture mode (no Console v1 GitHub backend in this run, PRD §36.13).
const NAME = "acc-refs";
const PEER = "acc-refs-peer";
const ISSUE = "XTRM-601";
const GH_ISSUE = "xtrm-dev/xtrm#41";
const PR = "xtrm-dev/xtrm#212";

interface SentReference {
  kind: string;
  raw: string;
  status: string;
  revision?: string;
  content?: string;
}

let id = "";
let peer = "";

test.beforeAll(async () => {
  peer = await ensurePi(PEER);
  id = await ensurePi(NAME);
});

const open = async (page: Page) => {
  await page.goto(`/agent/${id}`);
  await page.getByRole("radio", { name: "All" }).click();
  await expect(page.getByTestId("session-header")).toContainText(NAME);
};
const starts = async (sessionId: string) => (await hostPayloads(state(), sessionId)).filter((p) => p.type === "before_agent_start");

test("§36.11-7 every reference kind resolves through its adapter and the Frame records its revision", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: s.work, encoding: "utf8" }).trim();
  const text = `Reply with exactly one word: NOTED. Context: @issue:${ISSUE} @gh-issue:${GH_ISSUE} @pr:${PR} @commit:${sha.slice(0, 12)} @file:notes.txt @session:${PEER} .`;
  await composer(page, NAME).fill(text);
  const request = page.waitForRequest((r) => r.url().endsWith(SUBMIT), { timeout: 60_000 });
  await composer(page, NAME).press("Enter");
  const req = await request;
  const answer = (await (await req.response())!.json()) as { status: string };
  const refs = ((req.postDataJSON() as { references?: SentReference[] }).references ?? []).map(({ content, ...r }) => ({ ...r, bytes: content?.length }));
  log(s, `§36.11-7 submit ${answer.status}; references ${JSON.stringify(refs)}`);
  expect(answer.status).toBe("accepted");
  expect(refs.map((r) => r.kind)).toEqual(["issue", "gh-issue", "pr", "commit", "file", "session"]);
  expect(refs.every((r) => r.status === "resolved" && !!r.revision)).toBe(true);
  const byKind = Object.fromEntries(refs.map((r) => [r.kind, r.revision!]));
  const sb = JSON.parse(execFileSync("sb", ["issue", "show", ISSUE, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as { data: { revision: number } };
  expect(byKind.issue).toBe(`rev:${sb.data.revision}`);
  expect(byKind.file).toBe(`sha256:${createHash("sha256").update(readFileSync(join(s.work, "notes.txt"))).digest("hex")}`);
  expect(byKind.commit).toContain(sha.slice(0, 12));
  expect(byKind.session).toMatch(/^seq:\d+$/);
  await expectSettled(page);
  // The submitted Frame keeps each revision it was given.
  for (const revision of Object.values(byKind)) await expect(frame(page).locator(`[data-revision="${revision}"]`)).toHaveCount(1);
  await shoot(page, "36.11-07-references-revisions", s);
});

test("§36.11-11 a @session reference delivers nothing to that session; /message does", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  // The previous Frame carried @session:acc-refs-peer: the peer received no prompt.
  expect(await starts(peer)).toHaveLength(0);
  expect((await summary(s, peer)).frameCount ?? 0).toBe(0);
  const ownFrames = (await summary(s, id)).frameCount ?? 0;

  await composer(page, NAME).fill(`/message @session:${PEER} Reply with exactly one word: MESSAGED`);
  const submit = page.waitForRequest((r) => r.url().endsWith(SUBMIT));
  await composer(page, NAME).press("Enter");
  expect(((await submit).postDataJSON() as { sessionId: string }).sessionId).toBe(peer);
  await expect(page.getByTestId("message-delivered")).toHaveText(`Delivered to ${PEER}.`);
  await shoot(page, "36.11-11-message-delivered", s);
  await settledOnHost(s, peer, 1);
  const [delivered] = await starts(peer);
  log(s, `§36.11-11 peer received: ${String((delivered as unknown as { prompt: string }).prompt)}`);
  expect(String((delivered as unknown as { prompt: string }).prompt)).toContain(`Message from ${NAME}`);
  expect(String((delivered as unknown as { prompt: string }).prompt)).toContain("MESSAGED");
  // The sending session opened no Frame.
  expect((await summary(s, id)).frameCount ?? 0).toBe(ownFrames);
  await sessionRow(page, PEER).click();
  await expectSettled(page);
  await expect(page.getByTestId("frame-request")).toContainText(`Message from ${NAME}`);
  await shoot(page, "36.11-11-message-in-peer", s);
});

test("§36.11-9 an unresolvable reference blocks submit and is marked in the composer", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  const submits: Request[] = [];
  page.on("request", (r) => r.url().endsWith(SUBMIT) && submits.push(r));
  await composer(page, NAME).fill("Reply with one word. @file:missing-601.txt");
  const resolved = page.waitForResponse((r) => r.url().endsWith("/api/v1/references/resolve"));
  await composer(page, NAME).press("Enter");
  log(s, `§36.11-9 resolve answer ${JSON.stringify((await (await resolved).json()) as unknown)}`);
  await expect(page.getByRole("alert")).toContainText("Unresolved reference @file:missing-601.txt");
  await expect(composer(page, NAME)).toHaveValue("Reply with one word. @file:missing-601.txt");
  await page.waitForTimeout(1_000);
  expect(submits).toHaveLength(0);
  await shoot(page, "36.11-09-unresolved-blocks", s);
  await composer(page, NAME).fill("");
});

test("§36.11-10 Attach to composer in the drawer inserts the matching typed reference", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  // The Frame of §36.11-7 carries the reference chips; one opens its entity in the drawer.
  await page.getByTestId("frame-dock").getByRole("button", { name: /^Frame 1:/ }).click();
  await frame(page).locator(`[data-reference="@session:${PEER}"]`).first().click();
  await expect(page.getByTestId("session-panel")).toContainText(PEER);
  await page.getByRole("button", { name: /Attach to composer/ }).click();
  const attached = page.getByLabel("Attached references");
  await expect(attached).toContainText(PEER);
  await shoot(page, "36.11-10-attach-to-composer", s);
  await frame(page).locator(`[data-reference="@issue:${ISSUE}"]`).first().click();
  await page.getByRole("button", { name: /Attach to composer/ }).click();
  await expect(attached).toContainText(ISSUE);
});

test("§31-24 / §31-25 an inspected session promotes from the drawer to the main Agent surface", async ({ page }) => {
  const s = state();
  watchConsole(page, s);
  await open(page);
  await page.getByTestId("frame-dock").getByRole("button", { name: /^Frame 1:/ }).click();
  await frame(page).locator(`[data-reference="@session:${PEER}"]`).first().click();
  const panel = page.getByTestId("session-panel");
  await expect(panel).toContainText(PEER);
  await shoot(page, "31-24-drawer-inspects-session", s);
  await panel.getByRole("button", { name: "Open session" }).click();
  await expect(page).toHaveURL(new RegExp(`/agent/${peer}(\\?|$)`));
  await expect(page.getByTestId("session-header")).toContainText(PEER);
  await shoot(page, "31-25-open-session-promoted", s);
});
