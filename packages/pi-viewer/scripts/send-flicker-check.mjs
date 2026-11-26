import assert from "node:assert/strict"
import { createServer } from "vite"
import { chromium } from "playwright"

const PORT = 5196
const SESSION = "flicker"
const MARKER = "FLICKER PIN"
const now = Date.now()

const agent = {
  id: "a1", paneId: "%1", panePid: 1, piPid: 2, tmuxSession: SESSION,
  windowIndex: 0, windowId: "@1", windowName: "flicker", paneIndex: 0,
  name: "flicker-agent", title: "flicker-agent", cwd: "/tmp/flicker",
  sessionFile: "/tmp/flicker.jsonl", sessionId: "s1", sessionName: "flicker-agent",
  model: "fixture", thinkingLevel: null, role: null, provider: "pi",
  modifiedAt: now, lastWriteAt: now, eventCount: 3, status: "waiting", statusNote: null,
}

const events = [
  { id: "a1:0", agentId: "a1", agentName: "flicker-agent", seq: 0, at: now - 8000, kind: "user", role: "user", summary: "Earlier question", text: "Earlier question", onBranch: true },
  { id: "a1:1", agentId: "a1", agentName: "flicker-agent", seq: 1, at: now - 7000, kind: "assistant", role: "assistant", summary: "Earlier answer", text: "Earlier answer.", parts: [{ type: "text", text: "Earlier answer." }], stopReason: "stop", onBranch: true },
]

const sessions = { sessions: [{ name: SESSION, serverId: "test:tmux", agents: [agent] }], capturedAt: now, error: null }
let echoed = false
let replied = false
let echoServed = false
let replyServed = false
const sends = []

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
    setTimeout(() => { echoed = true }, 120)
    setTimeout(() => { replied = true }, 2200)
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
  }
  if (url.pathname !== "/api/thread") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
  const list = events.map((event) => ({ ...event }))
  if (echoed && !echoServed) {
    echoServed = true
    list.push({ id: "a1:echo", agentId: "a1", agentName: "flicker-agent", seq: 2, at: Date.now(), kind: "user", role: "user", summary: MARKER, text: MARKER, onBranch: true })
  }
  if (replied && !replyServed) {
    replyServed = true
    list.push({ id: "a1:reply", agentId: "a1", agentName: "flicker-agent", seq: 3, at: Date.now(), kind: "assistant", role: "assistant", summary: "Reply", text: "Flicker reply.", parts: [{ type: "text", text: "Flicker reply." }], stopReason: "stop", onBranch: true })
  }
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    session: SESSION, serverId: "test:tmux", version: `v${list.length}`, agents: [agent], capturedAt: Date.now(),
    events: list, cursor: list.length, revision: "r1", hasEarlier: false, earlier: null, earlierTurns: 0,
  }) })
})

try {
  await page.goto(`${base}/?s=${SESSION}`, { waitUntil: "domcontentloaded" })
  await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "visible" })
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))

  await page.evaluate(() => {
    const w = window
    w.__flicker = { frames: [], mutations: [], seen: new WeakMap(), next: 1, running: true }
    const content = document.querySelector('[data-slot="message-scroller-content"]')
    const marker = "FLICKER PIN"
    const label = (node) => {
      if (!(node instanceof Element)) return null
      if (!node.textContent?.includes(marker)) return null
      if (!w.__flicker.seen.has(node)) w.__flicker.seen.set(node, w.__flicker.next++)
      return w.__flicker.seen.get(node)
    }
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          const id = label(node)
          if (id && node instanceof Element) w.__flicker.mutations.push({ t: performance.now(), kind: "added", id, text: node.textContent?.slice(0, 40) })
        }
        for (const node of record.removedNodes) {
          const id = label(node)
          if (id) w.__flicker.mutations.push({ t: performance.now(), kind: "removed", id, text: node.textContent?.slice(0, 40) })
        }
      }
    })
    observer.observe(content, { childList: true, subtree: true })
    const start = performance.now()
    function frame() {
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
      const rows = [...document.querySelectorAll('[data-slot="message-scroller-item"]')].filter((row) => row.textContent?.includes(marker))
      const row = rows[0]
      const rect = row?.getBoundingClientRect()
      const delivery = row?.querySelector('[data-delivery]')
      w.__flicker.frames.push({
        t: performance.now() - start,
        count: rows.length,
        ids: rows.map((node) => w.__flicker.seen.get(node) ?? null),
        top: rect ? rect.top : null,
        height: rect ? rect.height : null,
        docTop: rect && viewport ? rect.top + viewport.scrollTop : null,
        scrollTop: viewport?.scrollTop ?? null,
        deliveryHeight: delivery ? delivery.getBoundingClientRect().height : null,
        presence: document.querySelector('[data-presence]')?.textContent ?? null,
      })
      if (performance.now() - start < 4200) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })

  const composer = page.locator("[data-composer-input]")
  await composer.fill(MARKER)
  await composer.press("Enter")
  await page.waitForTimeout(4300)
  const capture = await page.evaluate(() => window.__flicker)
  assert.deepEqual(sends, [{ paneId: "%1", text: MARKER }], "send was not mocked cleanly")

  const frames = capture.frames.filter((frame) => frame.count > 0)
  const gaps = capture.frames.filter((frame, index) => index > 0 && capture.frames[index - 1].count > 0 && frame.count === 0)
  const removed = capture.mutations.filter((m) => m.kind === "removed")
  const added = capture.mutations.filter((m) => m.kind === "added")
  const docTops = frames.map((f) => f.docTop).filter((v) => v != null)
  const maxShift = Math.max(0, ...docTops.slice(1).map((v, i) => Math.abs(v - docTops[i])))
  const heights = [...new Set(frames.map((f) => f.height).filter((v) => v != null).map((v) => Math.round(v * 10) / 10))]
  console.log(JSON.stringify({ mutations: capture.mutations, gaps, maxShift, heights, frames: frames.slice(0, 12), errors }, null, 2))

  assert.equal(errors.length, 0, `console errors: ${errors.join(" | ")}`)
  assert.equal(gaps.length, 0, "the bubble disappeared for a frame")
  assert.ok(!(removed.length && added.length), "the bubble was removed and re-added (remount)")
  assert.ok(maxShift <= 1, `the bubble jumped ${maxShift}px in document space`)
  assert.equal(heights.length, 1, `the bubble changed height: ${heights.join(", ")}`)
} finally {
  await browser.close()
  await server.close()
}
