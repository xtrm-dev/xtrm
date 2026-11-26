import assert from "node:assert/strict"
import { createServer } from "vite"
import { chromium } from "playwright"

const PORT = 5296
const SESSION = "queued"
const MARKER = "QUEUED PIN"
const now = Date.now()
const AT = now - 1000

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
const queued = { id: "a1:3", agentId: "a1", agentName: "queued-agent", seq: 3, at: AT, kind: "user", role: "user", summary: MARKER, text: MARKER, queued: true, onBranch: true }

const sessions = { sessions: [{ name: SESSION, serverId: "test:tmux", agents: [agent] }], capturedAt: now, error: null }
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
  if (url.pathname !== "/api/thread") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
  const events = [...baseEvents, delivered ? { ...queued, queued: undefined, at: AT + 9000 } : queued]
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    session: SESSION, serverId: "test:tmux", version: delivered ? "v2" : "v1", agents: [agent], capturedAt: Date.now(),
    events, cursor: events.length, revision: delivered ? "r2" : "r1", hasEarlier: false, earlier: null, earlierTurns: 0,
  }) })
})

try {
  await page.goto(`${base}/?s=${SESSION}`, { waitUntil: "domcontentloaded" })
  const row = page.locator('[data-message-id^="user:"]').filter({ hasText: MARKER })
  await row.waitFor({ state: "visible" })
  await page.evaluate(() => document.fonts.ready)
  const before = await row.evaluate((node) => {
    const mark = node.querySelector("[data-delivery]")
    return { id: node.getAttribute("data-message-id"), mark: mark?.getAttribute("data-delivery"), label: mark?.getAttribute("aria-label") }
  })
  assert.equal(before.mark, "pending")
  assert.equal(before.label, "Queued")

  await page.evaluate(() => {
    const node = [...document.querySelectorAll('[data-message-id^="user:"]')].find((row) => row.textContent?.includes("QUEUED PIN"))
    window.__queueNode = node
    window.__queueMut = []
    const content = document.querySelector('[data-slot="message-scroller-content"]')
    new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) if (added === node || (added instanceof Element && added.contains(node))) window.__queueMut.push("added")
        for (const removed of record.removedNodes) if (removed === node || (removed instanceof Element && removed.contains(node))) window.__queueMut.push("removed")
      }
    }).observe(content, { childList: true, subtree: true })
  })

  delivered = true
  await page.waitForTimeout(3200)
  const after = await row.evaluate((node) => {
    const mark = node.querySelector("[data-delivery]")
    return {
      same: node === window.__queueNode,
      mark: mark?.getAttribute("data-delivery"),
      label: mark?.getAttribute("aria-label"),
      mutations: window.__queueMut,
      count: [...document.querySelectorAll('[data-message-id^="user:"]')].filter((n) => n.textContent?.includes("QUEUED PIN")).length,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  console.log(JSON.stringify({ before, after, errors }, null, 2))
  assert.equal(after.same, true, "queued row was remounted on delivery")
  assert.deepEqual(after.mutations, [], "queued row was removed or re-added")
  assert.equal(after.mark, "seen")
  assert.equal(after.count, 1)
  assert.equal(after.overflow, 0)
  assert.equal(errors.length, 0, `console errors: ${errors.join(" | ")}`)
} finally {
  await browser.close()
  await server.close()
}
