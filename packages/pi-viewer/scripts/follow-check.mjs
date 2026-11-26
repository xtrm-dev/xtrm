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
  modifiedAt: Date.now(), lastWriteAt: Date.now(),
  eventCount: 100,
  status: "working",
  statusNote: null,
}

const sessions = { sessions: [{ name: SESSION, serverId: "test:tmux", agents: [agent] }], capturedAt: Date.now(), error: null }
const baseEvents = makeFixture()
let metaCalls = 0
let fullCalls = 0
let armed = false
let appended = 0
let echoed = false
let echoServed = false
let tailAppend = false
let tailAppended = false
const sends = []

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
  if (url.pathname === "/api/send") {
    sends.push(JSON.parse(route.request().postData() ?? "{}"))
    echoed = true
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) })
  }
  if (url.pathname !== "/api/thread") {
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
  }

  if (url.searchParams.get("meta") === "1") {
    metaCalls += 1
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ session: SESSION, serverId: "test:tmux", version: `v${metaCalls}`, agents: [agent], capturedAt: Date.now() }),
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
  if (echoed && !echoServed) {
    echoServed = true
    events.push({
      id: "a1:echo",
      agentId: "a1",
      agentName: "anchor-agent",
      seq: 10_003,
      at: Date.now(),
      kind: "user",
      role: "user",
      summary: "SEND PIN",
      text: "SEND PIN",
      onBranch: true,
      raw: null,
    })
  }
  if (tailAppend && !tailAppended) {
    tailAppended = true
    events.push({
      id: "a1:tail",
      agentId: "a1",
      agentName: "anchor-agent",
      seq: 10_004,
      at: Date.now(),
      kind: "assistant",
      role: "assistant",
      summary: "TAIL APPEND",
      text: "TAIL APPEND",
      parts: [{ type: "text", text: "TAIL APPEND" }],
      stopReason: "stop",
      onBranch: true,
      raw: null,
    })
  }
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: SESSION,
      serverId: "test:tmux",
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
  await page.waitForFunction(
    () => document.querySelector('[data-slot="message-scroller-button"]')?.getAttribute("data-active") === "true",
    undefined,
    { timeout: 8_000 },
  )
  await settle(page)
  const away = await state()
  assert.ok(away.scrollTop < 4, `reader was pulled back to ${away.scrollTop}px`)
  assert.equal(away.pill, "true", "pill hidden while scrolled away")
  assert.match(away.pillText, /Scroll to end/)

  // 3. The pill returns to the end.
  await page.locator('[data-slot="message-scroller-button"]').click()
  await page.waitForFunction(
    () => {
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
      return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2
    },
    undefined,
    { timeout: 8_000 },
  )
  await settle(page)
  const back = await state()
  assert.ok(back.distance <= 2, `pill did not return to the end: ${back.distance}px`)
  assert.equal(back.pill, "false")

  // 4. A send from mid-thread overrides the follow policy: the new row is visible at once.
  await page.evaluate(() => {
    const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
    viewport.scrollTop = 0
  })
  await settle(page)
  const composer = page.locator("[data-composer-input]")
  await composer.fill("SEND PIN")
  await composer.press("Enter")
  await page.waitForFunction(
    () => {
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
      return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2
    },
    undefined,
    { timeout: 4_000 },
  )
  await settle(page)
  const sentState = await state()
  assert.ok(sentState.distance <= 2, `send did not reach the end: ${sentState.distance}px`)
  assert.equal(sentState.pill, "false", "the pill shows after the reader sent a message")
  assert.deepEqual(sends.at(-1), { paneId: "%1", text: "SEND PIN" }, "the send reached the agent")

  // 5. The echo replaces the optimistic row without losing the pin or counting itself as new.
  await page.waitForFunction(
    () => !document.querySelector('[data-slot="message-scroller-viewport"]')?.dataset.restoring,
    undefined,
    { timeout: 1_000 },
  ).catch(() => {})
  await page.waitForTimeout(2_200)
  await settle(page)
  const echoedState = await state()
  assert.ok(echoedState.distance <= 2, `the echo lost the pin: ${echoedState.distance}px`)
  assert.equal(echoedState.pill, "false", "the echo counted as new")
  const pinRows = await page.locator('[data-slot="message-scroller-item"]', { hasText: "SEND PIN" }).count()
  assert.equal(pinRows, 1, `the optimistic row and its echo both rendered (${pinRows})`)

  // 6. The @mention path uses the same send intent: scroll away, pick an agent, send, land at the end.
  await page.evaluate(() => {
    const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
    viewport.scrollTop = 0
  })
  await settle(page)
  await composer.fill("@")
  await page.locator("[data-composer-menu] button").first().click()
  await composer.press("End")
  await composer.type(" MENTION PIN")
  await composer.press("Enter")
  await page.waitForFunction(
    () => {
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
      return viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 2
    },
    undefined,
    { timeout: 4_000 },
  )
  await settle(page)
  const mentionState = await state()
  assert.ok(mentionState.distance <= 2, `mention send did not reach the end: ${mentionState.distance}px`)
  assert.equal(mentionState.pill, "false", "the pill shows after a mention send")
  assert.match(sends.at(-1)?.text ?? "", /MENTION PIN/, "the mention send reached the agent")

  // 7. A reader gesture clears the send intent: later growth must not pull them down.
  await page.evaluate(() => {
    const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }))
    viewport.scrollTop = 0
  })
  await settle(page)
  tailAppend = true
  await page.waitForTimeout(2_200)
  await settle(page)
  const gestureState = await state()
  assert.ok(gestureState.scrollTop < 4, `the reader was pulled back to ${gestureState.scrollTop}px after a gesture`)
  assert.equal(gestureState.pill, "true", "the pill is hidden after the reader scrolls away")
  assert.equal(errors.length, 0, `console errors: ${errors.join(" | ")}`)
  console.log(JSON.stringify({ atEnd, away, back, sent: sentState, echoed: echoedState }, null, 2))
} finally {
  await browser.close()
  await server.close()
}
