import assert from "node:assert/strict"
import { createServer } from "vite"
import { chromium } from "playwright"

const PORT = 5296
const SESSION = "queued"
const MARKER = "QUEUED PIN"
const now = Date.now()

const agent = {
  id: "a1", paneId: "%1", panePid: 1, piPid: 2, tmuxSession: SESSION,
  windowIndex: 0, windowId: "@1", windowName: "queued", paneIndex: 0,
  name: "queued-agent", title: "queued-agent", cwd: "/tmp/queued",
  sessionFile: "/tmp/queued.jsonl", sessionId: "s1", sessionName: "queued-agent",
  model: "fixture", thinkingLevel: null, role: null, provider: "claude",
  modifiedAt: now, lastWriteAt: now, eventCount: 3, status: "waiting", statusNote: null,
}

const baseEvents = [
  { id: "a1:0", agentId: "a1", agentName: "queued-agent", seq: 0, at: now - 9000, kind: "user", role: "user", summary: "Earlier question", text: "Earlier question", onBranch: true },
  { id: "a1:1", agentId: "a1", agentName: "queued-agent", seq: 1, at: now - 8000, kind: "assistant", role: "assistant", summary: "Earlier answer", text: "Earlier answer.", parts: [{ type: "text", text: "Earlier answer." }], stopReason: "stop", onBranch: true },
]

const sessions = { sessions: [{ name: SESSION, serverId: "test:tmux", agents: [agent] }], capturedAt: now, error: null }
const sends = []
let sendAt = null
let queued = false
let delivered = false

const server = await createServer({ root: process.cwd(), logLevel: "error", server: { host: "127.0.0.1", port: PORT, strictPort: true } })
await server.listen()
const base = `http://127.0.0.1:${PORT}`
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()) })
page.on("pageerror", (e) => errors.push(String(e)))

await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url())
  if (url.pathname === "/api/sessions") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sessions) })
  if (url.pathname === "/api/send") {
    sends.push(JSON.parse(route.request().postData() ?? "{}"))
    sendAt = Date.now()
    setTimeout(() => { queued = true }, 120)
    setTimeout(() => { delivered = true }, 2600)
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
  }
  if (url.pathname !== "/api/thread") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
  const events = [...baseEvents]
  if (queued && sendAt != null) {
    events.push({ id: "a1:3", agentId: "a1", agentName: "queued-agent", seq: 3, at: sendAt, kind: "user", role: "user", summary: MARKER, text: MARKER, queued: delivered ? undefined : true, onBranch: true })
  }
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    session: SESSION, serverId: "test:tmux", version: delivered ? "v3" : queued ? "v2" : "v1", agents: [agent], capturedAt: Date.now(),
    events, cursor: events.length, revision: delivered ? "r3" : queued ? "r2" : "r1", hasEarlier: false, earlier: null, earlierTurns: 0,
  }) })
})

const markerRows = page.locator('[data-message-id^="optimistic:"], [data-message-id^="user:"]').filter({ hasText: MARKER })

try {
  await page.goto(`${base}/?s=${SESSION}`, { waitUntil: "domcontentloaded" })
  await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "visible" })
  await page.evaluate(() => document.fonts.ready)
  const composer = page.locator("[data-composer-input]")
  await composer.fill(MARKER)
  await composer.press("Enter")

  await markerRows.first().waitFor({ state: "visible" })
  await page.evaluate((text) => {
    const node = [...document.querySelectorAll('[data-slot="message-scroller-item"]')].find((row) => row.textContent?.includes(text))
    window.__queueNode = node
    window.__queueMut = []
    const content = document.querySelector('[data-slot="message-scroller-content"]')
    new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) if (added === node || (added instanceof Element && added.contains(node))) window.__queueMut.push("added")
        for (const removed of record.removedNodes) if (removed === node || (removed instanceof Element && removed.contains(node))) window.__queueMut.push("removed")
      }
    }).observe(content, { childList: true, subtree: true })
  }, MARKER)

  await page.waitForFunction((text) => {
    const row = [...document.querySelectorAll('[data-slot="message-scroller-item"]')].find((node) => node.textContent?.includes(text))
    return row?.querySelector('[data-delivery="pending"]')
  }, MARKER, { timeout: 5000 })
  const atQueue = await markerRows.first().evaluate((node) => {
    const mark = node.querySelector("[data-delivery]")
    return {
      id: node.getAttribute("data-message-id"),
      same: node === window.__queueNode,
      mark: mark?.getAttribute("data-delivery"),
      label: mark?.getAttribute("aria-label"),
      count: [...document.querySelectorAll('[data-slot="message-scroller-item"]')].filter((n) => n.textContent?.includes("QUEUED PIN")).length,
    }
  })

  await page.waitForFunction((text) => {
    const row = [...document.querySelectorAll('[data-slot="message-scroller-item"]')].find((node) => node.textContent?.includes(text))
    return row?.querySelector('[data-delivery="seen"]')
  }, MARKER, { timeout: 7000 })
  const atDelivery = await markerRows.first().evaluate((node) => {
    const mark = node.querySelector("[data-delivery]")
    return {
      id: node.getAttribute("data-message-id"),
      same: node === window.__queueNode,
      mark: mark?.getAttribute("data-delivery"),
      label: mark?.getAttribute("aria-label"),
      mutations: window.__queueMut,
      count: [...document.querySelectorAll('[data-slot="message-scroller-item"]')].filter((n) => n.textContent?.includes("QUEUED PIN")).length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  console.log(JSON.stringify({ atQueue, atDelivery, sends, errors }, null, 2))
  assert.deepEqual(sends, [{ paneId: "%1", text: MARKER }], "the composer did not send the prompt")
  assert.equal(atQueue.same, true, "optimistic row remounted when it became queued")
  assert.equal(atQueue.mark, "pending")
  assert.equal(atQueue.count, 1, "the queued echo duplicated the optimistic row")
  assert.equal(atDelivery.same, true, "queued row remounted when it was delivered")
  assert.equal(atDelivery.mark, "seen")
  assert.deepEqual(atDelivery.mutations, [], "queued row was removed or re-added")
  assert.equal(atDelivery.count, 1)
  assert.equal(atDelivery.overflow, 0)
  assert.equal(errors.length, 0, `console errors: ${errors.join(" | ")}`)
} finally {
  await browser.close()
  await server.close()
}
