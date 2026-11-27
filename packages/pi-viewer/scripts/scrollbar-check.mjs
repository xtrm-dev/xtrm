// One scrollbar everywhere (operator, 2026-11-27). The chat scroller's thin, dim bar is the app's only
// scrollbar: this check mounts the viewer with enough events to overflow the thread, then walks every
// element whose content overflows and asserts the computed scrollbar treatment is that one.
//
// Runs the app in-process with a mocked API on its own port (stopped at the end) and writes one PNG per
// theme to docs/design/shots/XTRM-1153/ (override with SHOTS_OUT). Exit 1 on any violation.
import { mkdir } from "node:fs/promises"

import { chromium } from "playwright"
import { createServer } from "vite"

const PORT = 5299
const SESSION = "xx"
const T0 = Date.now() - 60 * 60_000
const out = process.env.SHOTS_OUT || "docs/design/shots/XTRM-1153"

const PI = {
  id: "%1", paneId: "%1", panePid: 1, piPid: 1, provider: "pi",
  tmuxSession: SESSION, windowIndex: 0, windowId: "@0", windowName: "w0", paneIndex: 1,
  name: "agent-pi", title: "", cwd: "/home/u/agent-pi",
  sessionFile: "/tmp/agent-pi.jsonl", sessionId: "s1", sessionName: "agent-pi",
  model: "anthropic/claude-sonnet-4-5", thinkingLevel: "high", role: "worker",
  modifiedAt: Date.now(), lastWriteAt: Date.now(), eventCount: 0, status: "idle", statusNote: null,
  statusDetail: null, context: { used: 92_000, window: 200_000 },
}
// Enough turns that the thread scroller overflows at 900px, which is the point of the check.
const events = Array.from({ length: 24 }, (_, i) => ({
  id: `%1:${i}`, agentId: "%1", agentName: PI.name, seq: i, at: T0 + i * 1000,
  kind: i % 2 === 0 ? "user" : "assistant", role: i % 2 === 0 ? "user" : "assistant",
  summary: `turn ${i}`, onBranch: true, text: `turn ${i} of the thread, long enough to take a whole line in the lane`,
  ...(i % 2 === 0 ? {} : { parts: [{ type: "text", text: `turn ${i} of the thread, long enough to take a whole line in the lane` }], stopReason: "stop" }),
}))

// Every overflowing element must compute the chat's treatment: thin, and the dim border colour on a
// transparent track. `scrollbar-width: none` (no-scrollbar) and `display: none` are deliberate opt-outs.
const AUDIT = () => {
  const chat = document.querySelector(".xtrm-scroll-thread") ?? document.querySelector("[data-thread-scroller]")
    ?? document.querySelector(".thin-scrollbar") ?? document.body
  const normalize = (value) => String(value).replace(/\s+/g, " ").trim()
  const chatStyle = getComputedStyle(chat)
  const reference = { width: chatStyle.scrollbarWidth, color: normalize(chatStyle.scrollbarColor) }
  const scrollers = []
  for (const element of document.querySelectorAll("*")) {
    const style = getComputedStyle(element)
    if (style.display === "none" || style.visibility === "hidden") continue
    const overflowsY = element.scrollHeight > element.clientHeight + 1
    const overflowsX = element.scrollWidth > element.clientWidth + 1
    if (!overflowsY && !overflowsX) continue
    const hidden = style.scrollbarWidth === "none" || (element.className && String(element.className).includes("no-scrollbar"))
    scrollers.push({
      tag: element.tagName.toLowerCase(),
      cls: String(element.className ?? "").slice(0, 80),
      axis: overflowsY && overflowsX ? "both" : overflowsY ? "y" : "x",
      width: style.scrollbarWidth,
      color: normalize(style.scrollbarColor),
      hidden,
    })
  }
  return { reference, scrollers }
}

await mkdir(out, { recursive: true })
const server = await createServer({ root: process.cwd(), logLevel: "error", server: { host: "127.0.0.1", port: PORT, strictPort: true } })
await server.listen()
const base = `http://127.0.0.1:${PORT}`
const browser = await chromium.launch({ headless: true })
const problems = []
const written = []

try {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await context.addInitScript((value) => localStorage.setItem("pi-viewer-theme", value), theme)
    const page = await context.newPage()
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url())
      const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
      const agents = [PI]
      if (url.pathname === "/api/sessions") return json({ sessions: [{ name: SESSION, agents, capturedAt: Date.now() }], capturedAt: Date.now() })
      if (url.pathname !== "/api/thread") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
      const meta = { session: SESSION, version: "v1", agents, capturedAt: Date.now() }
      if (url.searchParams.get("meta") === "1") return json(meta)
      return json({ ...meta, events, cursor: events.length, revision: "r1", hasEarlier: false, earlier: null, earlierTurns: 0 })
    })
    await page.goto(`${base}/?s=${SESSION}`, { waitUntil: "domcontentloaded" })
    await page.locator("[data-composer-input]").waitFor({ state: "visible" })
    await page.waitForTimeout(400)

    const { reference, scrollers } = await page.evaluate(AUDIT)
    if (!reference.width || !reference.color) problems.push(`${theme}: the chat scroller declares no bar (${JSON.stringify(reference)})`)
    const visible = scrollers.filter((s) => !s.hidden)
    for (const s of visible) {
      if (s.width !== reference.width) problems.push(`${theme}: ${s.tag}.${s.cls} scrolls ${s.axis} with width ${s.width}, the chat uses ${reference.width}`)
      if (s.color !== reference.color) problems.push(`${theme}: ${s.tag}.${s.cls} scrolls ${s.axis} with colour ${s.color}, the chat uses ${reference.color}`)
    }
    // Scroll the thread to the middle so the state is a scrolled one. Headless Chromium paints overlay
    // scrollbars, so the PNG cannot show the bar; the computed-style audit above is the evidence.
    await page.evaluate(() => {
      const scroller = document.querySelector(".group\\/message-scroller")
      if (scroller) scroller.scrollTop = Math.round((scroller.scrollHeight - scroller.clientHeight) / 2)
    })
    await page.waitForTimeout(200)
    const path = `${out}/scrollbars-1440-${theme}.png`
    await page.screenshot({ path })
    written.push(path)
    console.log(`${theme}: reference ${reference.width} / ${reference.color}; ${visible.length} visible scrollers, ${scrollers.length - visible.length} opted out`)
    await context.close()
  }
} finally {
  await browser.close()
  await server.close()
}

if (problems.length) {
  console.error(problems.join("\n"))
  process.exit(1)
}
console.log(written.join("\n"))
