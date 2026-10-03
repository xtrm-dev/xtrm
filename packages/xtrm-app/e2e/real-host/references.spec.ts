import { expect, test, type Page, type Request } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostGet, hostPayloads, log, startPi, tmux, until, type RealHostState } from "./harness.ts";

// XTRM-598 validation against a real host: @ references resolve at submit with revisions and budgets.
// - @file with a line range resolves in the session cwd with a sha256 revision of the file;
// - @issue resolves through the Substrate bridge (read only: XTRM_SUBSTRATE_WRITES=0) with its revision;
// - @session of another live session attaches its context and delivers nothing to it;
// - an oversize @file becomes an excerpt plus a pointer;
// - a `../` escape is rejected by the host and blocks submit in the composer.
const OUT = "docs/screenshots/agent-half/real-host";
const NAME = "refs-pi";
const PEER = "refs-peer";
const ISSUE = "XTRM-598";
const SUBMIT = "/xtrm-api/agent-host/api/v1/submit";
const state = () => JSON.parse(process.env.XTRM_REAL_HOST_STATE!) as RealHostState;

const composer = (page: Page) => page.getByRole("textbox", { name: `Message ${NAME}` });
const lastFrame = (page: Page) => page.getByTestId("frame").last();
const pane = (s: RealHostState, name: string) => tmux(s, "capture-pane", "-p", "-t", name).trim().split("\n").slice(-12).join("\n");

interface SentReference {
  kind: string;
  raw: string;
  status: string;
  revision?: string;
  content?: string;
  truncated?: boolean;
  pointer?: string;
  bytes?: number;
}
interface SentSubmit {
  command: { commandId: string; message: string };
  references?: SentReference[];
}

async function setTheme(page: Page, t: "light" | "dark", reload: boolean) {
  await page.evaluate((v) => {
    localStorage.setItem("xtrm.console.theme.v1", v);
    document.documentElement.dataset.theme = v;
  }, t);
  if (reload) {
    await page.reload();
    await expect(page.getByTestId("agent-surface")).toBeVisible();
  }
}

async function shoot(page: Page, name: string) {
  for (const t of ["light", "dark"] as const) {
    await setTheme(page, t, true);
    await page.screenshot({ path: `${OUT}/${t}-${name}.png` });
  }
}

/** Press Enter in the composer; returns the submit_request the app sent and the host's answer. */
async function send(page: Page): Promise<{ sent: SentSubmit; status: string }> {
  const request = page.waitForRequest((r) => r.url().endsWith(SUBMIT), { timeout: 60_000 });
  await composer(page).press("Enter");
  const req = await request;
  const answer = (await (await req.response())!.json()) as { status: string };
  return { sent: req.postDataJSON() as SentSubmit, status: answer.status };
}

const sha256 = (path: string) => `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;

/** The issue revision as Substrate reports it; `sb issue show` is a read. */
function substrateRevision(ref: string): number {
  const out = JSON.parse(execFileSync("sb", ["issue", "show", ref, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) as { data: { revision: number } };
  return out.data.revision;
}

test("live @ references with revisions and budgets against a real xt host", async ({ page }) => {
  test.setTimeout(900_000);
  const s = state();
  page.on("console", (m) => m.type() === "error" && log(s, `browser console: ${m.text()}`));
  const range = join(s.work, "range.txt");
  writeFileSync(range, Array.from({ length: 10 }, (_, i) => `range line ${i + 1}`).join("\n") + "\n");
  const big = join(s.work, "big.txt");
  writeFileSync(big, Array.from({ length: 3000 }, (_, i) => `big line ${String(i + 1).padStart(4, "0")} ${"x".repeat(50)}`).join("\n") + "\n");
  // Outside the session cwd: s.root is the parent of s.work.
  writeFileSync(join(s.root, "outside.txt"), "must never reach the agent\n");
  log(s, `wrote range.txt (${readFileSync(range).length} B), big.txt (${readFileSync(big).length} B) in ${s.work}; outside.txt in ${s.root}`);

  const peer = await startPi(s, PEER);
  const id = await startPi(s, NAME);
  test.info().annotations.push({ type: "pi-session", description: id }, { type: "peer-session", description: peer });
  try {
    await validate(page, s, id, peer, range);
  } catch (e) {
    try {
      log(s, `pane ${NAME}:\n${pane(s, NAME)}`);
      log(s, `host events ${NAME}: ${(await hostPayloads(s, id)).map((p) => p.type).join(" ")}`);
    } catch {
      // diagnostics are best effort
    }
    throw e;
  }
});

async function validate(page: Page, s: RealHostState, id: string, peer: string, range: string) {
  await page.goto(`/agent/${id}`);
  await expect(page.getByTestId("session-details")).toContainText("settled · prompt · steer · abort");
  const peerBefore = (await hostPayloads(s, peer)).filter((p) => p.type === "before_agent_start").length;

  await test.step("@file range, @issue and @session resolve with revisions and travel with the submit", async () => {
    // The picker offers a typed path once the host resolves it in the session cwd.
    await composer(page).click();
    await composer(page).pressSequentially("@file:range.txt#L2-4");
    const option = page.getByTestId("reference-picker").getByRole("option").first();
    await expect(option).toContainText("range.txt#L2-4", { timeout: 30_000 });
    await composer(page).press("Enter");
    await expect(page.getByTestId("composer-ref")).toHaveCount(1);
    await composer(page).fill(`Reply with exactly one word: NOTED. Context: @issue:${ISSUE} and @session:${peer} .`);

    const { sent, status } = await send(page);
    log(s, `submit with references: status ${status}; references ${JSON.stringify(sent.references?.map(({ content, ...r }) => ({ ...r, contentBytes: content?.length })))}`);
    expect(status).toBe("accepted");
    const refs = sent.references ?? [];
    expect(refs.map((r) => r.raw)).toEqual(["@file:range.txt#L2-4", `@issue:${ISSUE}`, `@session:${peer}`]);
    expect(refs.every((r) => r.status === "resolved")).toBe(true);

    const [file, issue, session] = refs;
    expect(file!.revision).toBe(sha256(range));
    expect(file!.content).toBe("range line 2\nrange line 3\nrange line 4");
    const revision = substrateRevision(ISSUE);
    expect(issue!.revision).toBe(`rev:${revision}`);
    expect(issue!.content).toContain(ISSUE);
    expect(issue!.content).toContain("PROBLEM");
    expect(session!.revision).toMatch(/^seq:\d+$/);
    expect(session!.content).toContain(`session ${peer}`);
    log(s, `file revision ${file!.revision} = sha256 of range.txt; issue revision ${issue!.revision} = sb revision ${revision}; session revision ${session!.revision}`);

    // The context reaches the agent in its prompt; the Frame shows the operator's text and the revisions.
    await expect(lastFrame(page)).toHaveAttribute("data-frame-status", "settled", { timeout: 120_000 });
    const start = (await hostPayloads(s, id)).filter((p) => p.type === "before_agent_start").at(-1) as unknown as { prompt: string };
    expect(start.prompt).toContain("range line 3");
    expect(start.prompt).toContain(`<reference raw="@issue:${ISSUE}"`);
    await expect(page.getByTestId("frame-request").last()).toHaveText(`Reply with exactly one word: NOTED. Context: @issue:${ISSUE} and @session:${peer} .`);
    const chips = lastFrame(page).locator("[data-revision]");
    await expect(chips).toHaveCount(3);
    await expect(lastFrame(page).locator(`[data-revision="${file!.revision}"]`)).toBeVisible();
    await expect(lastFrame(page).locator(`[data-revision="rev:${revision}"]`)).toBeVisible();

    // @session attaches context only: the peer received no prompt and opened no Frame.
    const peerStarts = (await hostPayloads(s, peer)).filter((p) => p.type === "before_agent_start").length;
    const peerDetail = await hostGet<{ session: { frameCount?: number; state: string } }>(s, `/v1/sessions/${peer}`);
    log(s, `peer ${PEER}: before_agent_start ${peerBefore} → ${peerStarts}, frameCount ${peerDetail.session.frameCount ?? 0}, state ${peerDetail.session.state}`);
    expect(peerStarts).toBe(peerBefore);
    expect(peerDetail.session.frameCount ?? 0).toBe(0);
    await shoot(page, "references-frame");
  });

  await test.step("an oversize @file is sent as an excerpt plus a pointer", async () => {
    await composer(page).fill("Reply with exactly one word: SEEN. @file:big.txt .");
    const { sent, status } = await send(page);
    const [ref] = sent.references ?? [];
    log(s, `oversize submit: status ${status}; ${JSON.stringify({ raw: ref?.raw, revision: ref?.revision, bytes: ref?.bytes, truncated: ref?.truncated, pointer: ref?.pointer })}`);
    expect(status).toBe("accepted");
    expect(ref).toMatchObject({ raw: "@file:big.txt", status: "resolved", truncated: true, pointer: "@file:big.txt#L1-3000" });
    expect(ref!.content!.split("\n")).toHaveLength(200);
    expect(sent.command.message).toContain("full content: @file:big.txt#L1-3000");
    await expect(lastFrame(page)).toHaveAttribute("data-frame-status", "settled", { timeout: 120_000 });
    const chip = lastFrame(page).locator('[data-reference="@file:big.txt"]');
    await expect(chip).toContainText("excerpt");
    await expect(chip).toHaveAttribute("title", /excerpt; full: @file:big\.txt#L1-3000/);
    await shoot(page, "references-excerpt");
  });

  await test.step("a ../ escape is rejected by the host and blocks submit", async () => {
    const submits: Request[] = [];
    const onRequest = (r: Request) => r.url().endsWith(SUBMIT) && submits.push(r);
    page.on("request", onRequest);
    const resolved = page.waitForResponse((r) => r.url().endsWith("/xtrm-api/agent-host/api/v1/references/resolve"));
    await composer(page).fill("Reply with one word. @file:../outside.txt .");
    await composer(page).press("Enter");
    const answer = (await (await resolved).json()) as { references: SentReference[] & Array<{ error?: string }> };
    log(s, `escape resolve answer: ${JSON.stringify(answer.references)}`);
    expect(answer.references[0]).toMatchObject({ raw: "@file:../outside.txt", status: "unresolved", error: "path_outside_cwd" });
    await expect(page.getByRole("alert")).toHaveText("Unresolved reference @file:../outside.txt (path outside cwd). Fix or remove it before sending.");
    await expect(composer(page)).toHaveValue("Reply with one word. @file:../outside.txt .");
    await page.waitForTimeout(1_000);
    page.off("request", onRequest);
    expect(submits).toHaveLength(0);
    const starts = (await hostPayloads(s, id)).filter((p) => p.type === "before_agent_start");
    expect(starts).toHaveLength(2);
    expect(starts.some((p) => String((p as unknown as { prompt: string }).prompt).includes("must never reach the agent"))).toBe(false);
    log(s, "escape blocked in the composer; no submit was sent");
    // The block is composer state: repeat the attempt after each theme reload for the screenshots.
    for (const t of ["light", "dark"] as const) {
      await setTheme(page, t, true);
      await composer(page).fill("Reply with one word. @file:../outside.txt .");
      await composer(page).press("Enter");
      await expect(page.getByRole("alert")).toContainText("path outside cwd");
      await page.screenshot({ path: `${OUT}/${t}-references-blocked.png` });
    }
  });

  const detail = await until("the session to settle", async () => {
    const d = await hostGet<{ session: { frameCount: number; state: string } }>(s, `/v1/sessions/${id}`);
    return d.session.state === "settled" ? d : null;
  });
  log(s, `host session detail: frameCount ${detail.session.frameCount}, state ${detail.session.state}`);
  expect(detail.session.frameCount).toBe(2);
}
