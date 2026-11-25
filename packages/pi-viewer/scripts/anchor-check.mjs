import assert from "node:assert/strict"
import { createServer } from "vite"
import { chromium } from "playwright"

const PORT = 5198
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
  modifiedAt: Date.now(), lastWriteAt: Date.now(),
  eventCount: 100,
  status: "idle",
  statusNote: null,
}

const sessions = { sessions: [{ name: SESSION, agents: [agent] }], capturedAt: Date.now(), error: null }
const baseEvents = makeFixture()
let metaCalls = 0
let fullCalls = 0
let armed = false
// 0: fixture; 1: a row above grows and one row is appended; 2: one more row is appended.
let stage = 0

const server = await createServer({
  root: process.cwd(),
  logLevel: "error",
  server: { host: "127.0.0.1", port: PORT, strictPort: true },
})
await server.listen()
const base = `http://127.0.0.1:${PORT}`

/** Layout has happened when two animation frames have passed; no fixed sleep. */
async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

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
  if (armed && stage >= 1) {
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
  }
  if (armed && stage >= 2) {
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
  }
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: SESSION,
      version: `v${metaCalls}`,
      agents: [agent],
      capturedAt: Date.now(),
      events,
      cursor: events.length,
      revision: "fixture-r1",
      hasEarlier: false,
      earlier: null,
      earlierTurns: 0,
    }),
  })
})

try {
  await page.goto(`${base}/?s=${SESSION}`, { waitUntil: "domcontentloaded" })
  await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "visible" })
  await page.evaluate(() => document.fonts.ready)
  await settle(page)

  const before = await page.evaluate(() => {
    const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
    viewport.scrollTop = Math.round(viewport.scrollHeight * 0.5)
    const viewportTop = viewport.getBoundingClientRect().top
    const items = Array.from(document.querySelectorAll('[data-slot="message-scroller-item"]'))
    const anchor = items.find((item) => item.getBoundingClientRect().top >= viewportTop)
    if (!anchor) throw new Error("no anchor row at the middle of the fixture")
    window.__anchorId = anchor.dataset.messageId
    return {
      id: anchor.dataset.messageId,
      top: anchor.getBoundingClientRect().top - viewportTop,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
    }
  })

  armed = true
  stage = 1
  await page.getByText("ANCHOR POLL APPEND").waitFor({ state: "visible", timeout: 8_000 })
  await page.waitForFunction(
    (id) => {
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
      return Array.from(document.querySelectorAll('[data-slot="message-scroller-item"]')).some(
        (item) => item.dataset.messageId === id && item.getBoundingClientRect().top >= viewport.getBoundingClientRect().top,
      )
    },
    before.id,
    { timeout: 8_000 },
  )
  await settle(page)

  const after = await page.evaluate(() => {
    const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
    const viewportTop = viewport.getBoundingClientRect().top
    const items = Array.from(document.querySelectorAll('[data-slot="message-scroller-item"]'))
    const anchor = items.find((item) => item.dataset.messageId === window.__anchorId)
    const added = items.find((item) => item.textContent.includes("ANCHOR POLL APPEND"))
    return {
      top: anchor ? anchor.getBoundingClientRect().top - viewportTop : null,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      addedTop: added ? added.getBoundingClientRect().top - viewportTop : null,
      viewportHeight: viewport.clientHeight,
    }
  })

  const drift = after.top === null ? Infinity : after.top - before.top
  assert.ok(Math.abs(drift) < 2, `anchor drifted ${drift}px after a poll changed rows above (expected < 2px)`)
  assert.ok(after.addedTop === null || after.addedTop > after.viewportHeight, "an appended poll event was scrolled into view")

  const bottomBefore = await page.evaluate(() => {
    const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
    viewport.scrollTop = viewport.scrollHeight
    return { scrollTop: viewport.scrollTop, scrollHeight: viewport.scrollHeight, clientHeight: viewport.clientHeight }
  })
  stage = 2
  await page.getByText("ANCHOR BOTTOM APPEND").waitFor({ state: "visible", timeout: 8_000 })
  await page.waitForFunction(
    () => {
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
      return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2
    },
    undefined,
    { timeout: 8_000 },
  )
  await settle(page)
  const bottomAfter = await page.evaluate(() => {
    const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
    return {
      distance: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
    }
  })

  assert.ok(bottomAfter.distance <= 2, `reader fell ${bottomAfter.distance}px behind the bottom after an append`)

  // Smooth scroll-to-end must stay pinned while the content grows mid-flight.
  await page.evaluate(() => {
    const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
    viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight - 400)
  })
  await settle(page)
  await page.getByRole("button", { name: "Scroll to end" }).click()
  await page.evaluate(() => {
    const content = document.querySelector('[data-slot="message-scroller-content"]')
    const spacer = document.createElement("div")
    spacer.id = "anchor-smooth-growth"
    spacer.style.height = "1200px"
    content.append(spacer)
  })
  await page.waitForFunction(
    () => {
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
      return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2
    },
    undefined,
    { timeout: 4_000 },
  )
  const smoothAfter = await page.evaluate(() => {
    const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
    return {
      distance: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
    }
  })
  assert.ok(
    smoothAfter.distance <= 2,
    `smooth scroll lost its pin while content grew (${smoothAfter.distance}px from the bottom)`,
  )
  await page.evaluate(() => document.getElementById("anchor-smooth-growth")?.remove())
  await settle(page)

  // A viewport-only resize (composer growth, window resize) at the bottom must re-pin.
  await page.evaluate(() => {
    const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
    viewport.scrollTop = viewport.scrollHeight
  })
  await settle(page)
  await page.setViewportSize({ width: 1440, height: 600 })
  await page.waitForFunction(
    () => {
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
      return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2
    },
    undefined,
    { timeout: 4_000 },
  )
  const resizedAfter = await page.evaluate(() => {
    const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
    return {
      distance: viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop,
      scrollTop: viewport.scrollTop,
      scrollHeight: viewport.scrollHeight,
      clientHeight: viewport.clientHeight,
    }
  })
  assert.ok(
    resizedAfter.distance <= 2,
    `a viewport-only resize left the reader ${resizedAfter.distance}px above the bottom`,
  )
  await page.setViewportSize({ width: 1440, height: 1000 })
  await settle(page)

  assert.equal(errors.length, 0, `console errors: ${errors.join(" | ")}`)

  console.log(
    JSON.stringify(
      {
        anchor: before.id,
        drift,
        appendedInView: after.addedTop !== null && after.addedTop <= after.viewportHeight,
        bottomDistance: bottomAfter.distance,
        smoothDistance: smoothAfter.distance,
        resizedDistance: resizedAfter.distance,
        before,
        after,
        bottomBefore,
        bottomAfter,
        smoothAfter,
        resizedAfter,
      },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
  await server.close()
}
