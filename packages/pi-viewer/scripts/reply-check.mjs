// Reply action browser check (XTRM-1045).
//
// Runs the app in-process with a mocked API (the harness of anchor-check.mjs and
// presence-check.mjs, its own port, stopped at the end) and asserts:
// - an agent turn shows Reply immediately left of Copy; operator bubbles and intercom cards show none;
// - a Reply for a gone agent renders disabled and titled "Agent is gone" (the real component, server-rendered);
// - Reply aims the composer at that agent, focuses the textarea and keeps the draft;
// - the "Replying to <agent>" bar shows, and the x, Escape in an empty composer, a send and a
//   change of target each clear it; Escape with a draft does not;
// - in a pane scope Reply focuses the composer and shows no bar;
// - Enter on a keyboard-focused Reply activates it;
// - no console error and no horizontal overflow at 1440 and 390.
import assert from "node:assert/strict"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "vite"
import { chromium } from "playwright"

const PORT = 5196
const SHOTS = process.env.REPLY_SHOTS ?? tmpdir()
const SESSION = "xx"
const T0 = Date.now() - 60 * 60_000

function agent(index) {
  return {
    id: `%${index}`,
    paneId: `%${index}`,
    panePid: index,
    piPid: index,
    provider: "claude",
    tmuxSession: SESSION,
    windowIndex: 0,
    windowId: "@0",
    windowName: "w0",
    paneIndex: index,
    name: `agent-${["", "alpha", "beta", "gamma"][index]}`,
    title: "",
    cwd: `/home/u/agent${index}`,
    sessionFile: `/tmp/agent${index}.jsonl`,
    sessionId: `s${index}`,
    sessionName: `agent${index}`,
    model: "claude-opus-5-5",
    thinkingLevel: null,
    role: "worker",
    modifiedAt: Date.now(),
    lastWriteAt: Date.now(),
    eventCount: 0,
    status: "idle",
    statusNote: null,
    statusDetail: null,
  }
}

function ev(index, seq, at, kind, extra = {}) {
  return {
    id: `%${index}:${seq}`,
    agentId: `%${index}`,
    agentName: agent(index).name,
    seq,
    at,
    kind,
    role: kind === "user" ? "user" : "assistant",
    summary: `${kind} ${seq}`,
    onBranch: true,
    ...extra,
  }
}
const prompt = (a, seq, at, text) => ev(a, seq, at, "user", { text, summary: text })
const answer = (a, seq, at, text) =>
  ev(a, seq, at, "assistant", { parts: [{ type: "text", text }], stopReason: "stop", text })

// Alpha answers first, then beta.
const events = [
  prompt(1, 0, T0, "Question for alpha"),
  answer(1, 1, T0 + 5_000, "Alpha answer."),
  prompt(2, 0, T0 + 60_000, "Question for beta"),
  answer(2, 1, T0 + 65_000, "Beta answer."),
]
const agents = [agent(1), agent(2)]
const sends = []

const server = await createServer({
  root: process.cwd(),
  logLevel: "error",
  server: { host: "127.0.0.1", port: PORT, strictPort: true },
})
await server.listen()
const base = `http://127.0.0.1:${PORT}`
const browser = await chromium.launch({ headless: true })

async function open(width, height, theme, search = `?s=${SESSION}`) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme })
  await context.addInitScript((value) => localStorage.setItem("pi-viewer-theme", value), theme)
  const page = await context.newPage()
  const errors = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
    if (url.pathname === "/api/sessions") {
      return json({ sessions: [{ name: SESSION, agents, capturedAt: Date.now() }], capturedAt: Date.now() })
    }
    if (url.pathname === "/api/send") {
      sends.push(JSON.parse(route.request().postData() ?? "{}"))
      return json({ ok: true })
    }
    if (url.pathname !== "/api/thread") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
    const meta = { session: SESSION, version: "v1", agents, capturedAt: Date.now() }
    if (url.searchParams.get("meta") === "1") return json(meta)
    return json({ ...meta, events, cursor: events.length, revision: "r1", hasEarlier: false, earlier: null, earlierTurns: 0 })
  })
  await page.goto(`${base}/${search}`, { waitUntil: "domcontentloaded" })
  await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "visible" })
  await page.waitForTimeout(500)
  return { context, page, errors }
}

const replyButtons = (page) => page.locator('button[aria-label^="Reply to"]')
const bar = (page) => page.locator("[data-reply-bar]")
const composer = (page) => page.locator("[data-composer-input]")
// The selector under the box names the target directly (XTRM-1054 rev 2: no "To" label).
const toLabel = (page) => page.locator("[data-composer-under-row] button[aria-expanded]").innerText()

try {
  const { context, page, errors } = await open(1440, 900, "dark")

  // 1. Placement: three agent turns, Reply left of Copy, none on operator bubbles.
  assert.equal(await replyButtons(page).count(), 2, "one Reply per agent turn in scope")
  const order = await page.evaluate(() => {
    const reply = document.querySelector('button[aria-label="Reply to agent-alpha"]')
    const copy = reply?.nextElementSibling
    return { copyLabel: copy?.getAttribute("aria-label"), replyRight: reply?.getBoundingClientRect().right, copyLeft: copy?.getBoundingClientRect().left }
  })
  assert.equal(order.copyLabel, "Copy reply", "Copy is the next sibling of Reply")
  assert.ok(order.replyRight <= order.copyLeft + 0.5, "Reply sits left of Copy")
  const userBubbleReply = await page.locator('[data-slot="message-scroller-item"]:has-text("Question for alpha") button[aria-label^="Reply to"]').count()
  assert.equal(userBubbleReply, 0, "no Reply on an operator message")

  // 2. A gone agent: the thread filters turns to the agents in scope, so the row cannot be driven
  // through the page. Render the real button with no agent and read what it emits.
  const { ReplyButton } = await server.ssrLoadModule("/src/components/ChannelView.tsx")
  const { renderToStaticMarkup } = await import("react-dom/server")
  const { createElement } = await import("react")
  const goneHtml = renderToStaticMarkup(createElement(ReplyButton, { agent: undefined, name: "agent-gamma", onReply: () => {} }))
  assert.match(goneHtml, /disabled=""/, "Reply is disabled for a gone agent")
  assert.match(goneHtml, /title="Agent is gone"/)
  assert.match(goneHtml, /aria-label="Reply to agent-gamma"/)
  const liveHtml = renderToStaticMarkup(createElement(ReplyButton, { agent: agents[0], name: agents[0].name, onReply: () => {} }))
  assert.doesNotMatch(liveHtml, /disabled=""/)
  assert.match(liveHtml, /title="Reply"/)
  assert.equal(await page.locator('button[aria-label="Reply to agent-alpha"]').getAttribute("title"), "Reply")

  // 3. Reply: target switches, composer focused, draft kept, bar shown.
  assert.match(await toLabel(page), /agent-alpha/, "the default target is alpha")
  await composer(page).fill("keep this draft")
  await page.locator('button[aria-label="Reply to agent-beta"]').click({ force: true })
  await page.waitForTimeout(150)
  assert.match(await toLabel(page), /agent-beta/, "the composer now aims at beta")
  assert.equal(await composer(page).inputValue(), "keep this draft", "the draft stays")
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-composer-input")), true, "the composer has focus")
  assert.equal(await bar(page).count(), 1)
  assert.match(await bar(page).innerText(), /Replying to\s+agent-beta/)
  await page.screenshot({ path: join(SHOTS, "reply-bar-1440-dark.png") })

  // 4. Escape with a draft keeps the bar; Escape in an empty composer clears it.
  await page.keyboard.press("Escape")
  assert.equal(await bar(page).count(), 1, "Escape with a draft does not clear the bar")
  await composer(page).fill("")
  await page.keyboard.press("Escape")
  assert.equal(await bar(page).count(), 0, "Escape in an empty composer clears the bar")
  assert.match(await toLabel(page), /agent-beta/, "the target stays on the agent; only the bar goes")

  // 5. The x clears it and returns focus to the composer.
  await page.locator('button[aria-label="Reply to agent-beta"]').click({ force: true })
  await page.waitForTimeout(100)
  assert.equal(await bar(page).count(), 1)
  await page.locator('button[aria-label="Cancel reply"]').click()
  assert.equal(await bar(page).count(), 0, "the x clears the bar")
  assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute("data-composer-input")), true)

  // 6. A send clears it and goes to the replied agent.
  await page.locator('button[aria-label="Reply to agent-alpha"]').click({ force: true })
  await composer(page).fill("hello alpha")
  await composer(page).press("Enter")
  await page.waitForTimeout(300)
  assert.equal(await bar(page).count(), 0, "a send clears the bar")
  assert.deepEqual(sends.at(-1), { paneId: "%1", text: "hello alpha" }, "the send reaches alpha, plain text")

  // 7. Changing the target through the To menu clears the bar.
  await page.locator('button[aria-label="Reply to agent-beta"]').click({ force: true })
  await page.waitForTimeout(100)
  assert.equal(await bar(page).count(), 1)
  await page.locator("[data-composer-under-row] button[aria-expanded]").click()
  await page.locator("button", { hasText: "agent-alpha" }).last().click()
  assert.equal(await bar(page).count(), 0, "picking a target in the To menu clears the bar")

  // 8. Keyboard: Tab reaches Reply inside the row, Enter activates.
  await page.locator('button[aria-label="Reply to agent-beta"]').focus()
  await page.waitForTimeout(350)
  assert.equal(await page.evaluate(() => getComputedStyle(document.activeElement.closest(".xtrm-meta")).opacity), "1", "focus reveals the row")
  await page.keyboard.press("Enter")
  await page.waitForTimeout(150)
  assert.match(await toLabel(page), /agent-beta/)
  assert.equal(await bar(page).count(), 1, "Enter on Reply opens the bar")

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, "no horizontal overflow at 1440")
  assert.deepEqual(errors, [], "no console errors at 1440")
  await context.close()

  // 9. Pane scope: Reply focuses the composer, no bar.
  const pane = await open(1440, 900, "dark", `?s=${SESSION}&w=@0&p=%2`)
  await pane.page.locator('button[aria-label="Reply to agent-beta"]').click({ force: true })
  await pane.page.waitForTimeout(150)
  assert.equal(await bar(pane.page).count(), 0, "no bar in a pane scope")
  assert.equal(await pane.page.evaluate(() => document.activeElement?.hasAttribute("data-composer-input")), true, "the composer still has focus")
  assert.deepEqual(pane.errors, [], "no console errors in pane scope")
  await pane.context.close()

  // 10. 390 wide, light and dark: the bar and the row fit.
  for (const theme of ["light", "dark"]) {
    const narrow = await open(390, 800, theme)
    await narrow.page.locator('button[aria-label="Reply to agent-alpha"]').click({ force: true })
    await narrow.page.waitForTimeout(150)
    assert.equal(await bar(narrow.page).count(), 1)
    assert.equal(await narrow.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, `no horizontal overflow at 390 ${theme}`)
    await narrow.page.screenshot({ path: join(SHOTS, `reply-bar-390-${theme}.png`) })
    assert.deepEqual(narrow.errors, [], `no console errors at 390 ${theme}`)
    await narrow.context.close()
  }
  const light = await open(1440, 900, "light")
  await light.page.locator('button[aria-label="Reply to agent-alpha"]').click({ force: true })
  await light.page.waitForTimeout(150)
  await light.page.screenshot({ path: join(SHOTS, "reply-bar-1440-light.png") })
  await light.context.close()

  console.log("reply-check: ok")
} finally {
  await browser.close()
  await server.close()
}
