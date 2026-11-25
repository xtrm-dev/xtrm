import assert from "node:assert/strict"
import { createServer } from "vite"
import { chromium } from "playwright"

const PORT = 5197
const SESSION = "xx"

function makeFixture() {
  const now = Date.now()
  const events = []
  for (let index = 0; index < 50; index += 1) {
    const at = now - (50 - index) * 10_000
    const text = `Answer ${index}\n\n${Array.from({ length: 4 }, (_, line) => `Answer paragraph ${index}.${line + 1}.`).join("\n\n")}`
    events.push({
      id: `a1:${index * 2}`,
      agentId: "a1",
      agentName: "anchor-agent",
      seq: index * 2,
      at,
      kind: "user",
      role: "user",
      summary: `Question ${index}`,
      text: `Question ${index}`,
      onBranch: true,
      raw: null,
    })
    events.push({
      id: `a1:${index * 2 + 1}`,
      agentId: "a1",
      agentName: "anchor-agent",
      seq: index * 2 + 1,
      at: at + 1_000,
      kind: "assistant",
      role: "assistant",
      summary: `Answer ${index}`,
      text,
      parts: [{ type: "text", text }],
      stopReason: "stop",
      onBranch: true,
      raw: null,
    })
  }
  return events
}

const agent = {
  id: "a1",
  paneId: "%1",
  panePid: 1,
  piPid: 2,
  tmuxSession: SESSION,
  windowIndex: 0,
  windowName: "anchor",
  paneIndex: 0,
  name: "anchor-agent",
  title: "anchor-agent",
  cwd: "/tmp/anchor",
  sessionFile: "/tmp/anchor.jsonl",
  sessionId: "anchor-session",
  sessionName: "anchor-agent",
  model: "fixture",
  thinkingLevel: null,
  role: null,
  provider: "pi",
  modifiedAt: Date.now(),
  eventCount: 100,
  status: "working",
  statusNote: null,
}

const sessions = { sessions: [{ name: SESSION, agents: [agent] }], capturedAt: Date.now(), error: null }
const baseEvents = makeFixture()
let metaCalls = 0
let fullCalls = 0
let armed = false
let appended = 0

const server = await createServer({
  root: process.cwd(),
  logLevel: "error",
  server: { host: "127.0.0.1", port: PORT, strictPort: true },
})
await server.listen()
const base = `http://127.0.0.1:${PORT}`

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text())
})
page.on("pageerror", (error) => errors.push(String(error)))

await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url())
  if (url.pathname === "/api/sessions") {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sessions) })
  }
  if (url.pathname !== "/api/thread") {
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
  }

  if (url.searchParams.get("meta") === "1") {
    metaCalls += 1
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ session: SESSION, version: `v${metaCalls}`, agents: [agent], capturedAt: Date.now() }),
    })
  }

  fullCalls += 1
  const events = baseEvents.map((event) => ({ ...event }))
  if (armed && appended === 0) {
    const firstFinal = events.find((event) => event.kind === "assistant" && event.stopReason === "stop")
    firstFinal.text += `\n\n${Array.from({ length: 60 }, (_, line) => `Poll growth above the reader, line ${line + 1}.`).join("\n\n")}`
    events.push({
      id: "a1:new-append",
      agentId: "a1",
      agentName: "anchor-agent",
      seq: 10_001,
      at: Date.now(),
      kind: "user",
      role: "user",
      summary: "ANCHOR POLL APPEND",
      text: "ANCHOR POLL APPEND",
      onBranch: true,
      raw: null,
    })
    appended += 1
  } else if (armed && appended === 1) {
    events.push({
      id: "a1:new-bottom",
      agentId: "a1",
      agentName: "anchor-agent",
      seq: 10_002,
      at: Date.now(),
      kind: "user",
      role: "user",
      summary: "ANCHOR BOTTOM APPEND",
      text: "ANCHOR BOTTOM APPEND",
      onBranch: true,
      raw: null,
    })
    appended += 1
  }
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ session: SESSION, version: `v${metaCalls}`, agents: [agent], capturedAt: Date.now(), events }),
  })
})

try {
  await page.goto(`${base}/?s=${SESSION}`, { waitUntil: "domcontentloaded" })
  await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "visible" })
  await page.waitForTimeout(800)

  const state = () =>
    page.evaluate(() => {
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
      const pill = document.querySelector('[data-slot="message-scroller-button"]')
      return {
        scrollTop: viewport.scrollTop,
        distance: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
        pill: pill.getAttribute("data-active"),
        pillText: pill.textContent,
      }
    })

  // 1. A working agent keeps the reader at the end.
  const atEnd = await state()
  assert.ok(atEnd.distance <= 2, `reader not at the end on open: ${atEnd.distance}px`)
  assert.equal(atEnd.pill, "false", "pill visible at the end")

  // 2. A reader who scrolls away while the agent works is never pulled back down.
  await page.evaluate(() => {
    const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
    viewport.scrollTop = 0
  })
  await page.waitForTimeout(1200)
  const away = await state()
  assert.ok(away.scrollTop < 4, `reader was pulled back to ${away.scrollTop}px`)
  assert.equal(away.pill, "true", "pill hidden while scrolled away")
  assert.match(away.pillText, /Scroll to end/)

  // 3. The pill returns to the end.
  await page.locator('[data-slot="message-scroller-button"]').click()
  await page.waitForTimeout(1500)
  const back = await state()
  assert.ok(back.distance <= 2, `pill did not return to the end: ${back.distance}px`)
  assert.equal(back.pill, "false")
  assert.equal(errors.length, 0, `console errors: ${errors.join(" | ")}`)
  console.log(JSON.stringify({ atEnd, away, back }, null, 2))
} finally {
  await browser.close()
  await server.close()
}
