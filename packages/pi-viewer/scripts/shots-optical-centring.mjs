// Composer optical centring, before and after (XTRM-1087).
//
// The operator reads the prompt box on a 2x display at about 1000px, dark, palette Threads, one empty
// line. This script renders that, measures the painted ink band of the placeholder and of the send glyph,
// and writes two crops: "before" with the old even 4px/4px text padding forced through a style override,
// "after" with the shipped 3.25px/4.75px pair. Not a gate: composer-check.mjs asserts the same numbers.
import { mkdir } from "node:fs/promises"

import { chromium } from "playwright"
import { createServer } from "vite"

const PORT = 5295
const SESSION = "xx"
const T0 = Date.now() - 60 * 60_000
const out = "docs/design/shots/XTRM-1087"
const OUT_W = 1000

const agent = {
  id: "%1", paneId: "%1", panePid: 1, piPid: 1, provider: "pi",
  tmuxSession: SESSION, windowIndex: 0, windowId: "@0", windowName: "w0", paneIndex: 1,
  name: "agent-pi", title: "", cwd: "/home/u/agent-pi",
  sessionFile: "/tmp/agent-pi.jsonl", sessionId: "s1", sessionName: "agent-pi",
  model: "anthropic/claude-sonnet-4-5", thinkingLevel: "high", role: "worker",
  modifiedAt: Date.now(), lastWriteAt: Date.now(), eventCount: 0,
  status: "idle", statusNote: null, statusDetail: null, context: null,
}
const events = [
  { id: "%1:0", agentId: "%1", agentName: agent.name, seq: 0, at: T0, kind: "user", role: "user", summary: "hi", onBranch: true, text: "hi" },
]

await mkdir(out, { recursive: true })
const server = await createServer({ root: process.cwd(), logLevel: "error", server: { host: "127.0.0.1", port: PORT, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ headless: true })
const written = []

// The painted band of one element: rasterise it, decode through a canvas, and take the rows that differ
// from the region's modal colour. Text is scanned in the box's left columns, the glyph inside the button.
async function ink(page, selector, mode) {
  const shot = await page.locator(selector).first().screenshot({ animations: "disabled" })
  return page.evaluate(
    async ({ b64, mode }) => {
      const img = new Image()
      img.src = `data:image/png;base64,${b64}`
      await img.decode()
      const canvas = document.createElement("canvas")
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext("2d", { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const at = (x, y) => {
        const index = (y * width + x) * 4
        return [data[index], data[index + 1], data[index + 2]]
      }
      const counts = new Map()
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const key = at(x, y).join(",")
          counts.set(key, (counts.get(key) ?? 0) + 1)
        }
      }
      const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0].split(",").map(Number)
      const from = mode === "text" ? Math.round(width * 0.03) : 6
      const to = mode === "text" ? Math.round(width * 0.62) : width - 6
      const rowFrom = mode === "text" ? 0 : 4
      const rowTo = mode === "text" ? height : height - 4
      let top = null
      let bottom = null
      for (let y = rowFrom; y < rowTo; y += 1) {
        for (let x = from; x < to; x += 1) {
          const [r, g, bl] = at(x, y)
          if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(bl - bg[2]) > 90) {
            if (top === null) top = y
            bottom = y
            break
          }
        }
      }
      const ratio = window.devicePixelRatio || 1
      const height1x = height / ratio
      return {
        top: Math.round((top / ratio) * 10) / 10,
        bottom: Math.round((bottom / ratio) * 10) / 10,
        height: Math.round(height1x * 10) / 10,
        topGap: Math.round((top / ratio) * 10) / 10,
        bottomGap: Math.round((height1x - bottom / ratio) * 10) / 10,
      }
    },
    { b64: shot.toString("base64"), mode },
  )
}

try {
  const context = await browser.newContext({ viewport: { width: OUT_W, height: 900 }, deviceScaleFactor: 2 })
  await context.addInitScript(() => {
    localStorage.setItem("pi-viewer-theme", "dark")
    localStorage.setItem("pi-viewer-palette", "threads")
  })
  const page = await context.newPage()
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
    if (url.pathname === "/api/sessions") return json({ sessions: [{ name: SESSION, agents: [agent], capturedAt: Date.now() }], capturedAt: Date.now() })
    if (url.pathname !== "/api/thread") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
    const meta = { session: SESSION, version: "v1", agents: [agent], capturedAt: Date.now() }
    if (url.searchParams.get("meta") === "1") return json(meta)
    return json({ ...meta, events, cursor: events.length, revision: "r1", hasEarlier: false, earlier: null, earlierTurns: 0 })
  })
  await page.goto(`http://127.0.0.1:${PORT}/?s=${SESSION}`, { waitUntil: "domcontentloaded" })
  await page.locator("[data-composer-input]").waitFor({ state: "visible" })
  await page.waitForTimeout(400)

  const crop = async () => {
    const rect = await page.locator(".xtrm-composer-box").boundingBox()
    return {
      x: Math.max(0, Math.round(rect.x - 20)),
      y: Math.max(0, Math.round(rect.y - 16)),
      width: Math.round(rect.width + 40),
      height: Math.round(rect.height + 32),
    }
  }
  const report = async (tag) => {
    const placeholder = await ink(page, ".xtrm-composer-box", "text")
    const glyph = await ink(page, "[data-composer-controls] button", "send")
    console.log(
      `${tag}: placeholder ${placeholder.top}..${placeholder.bottom} in ${placeholder.height} (top ${placeholder.topGap}, bottom ${placeholder.bottomGap}); ` +
        `glyph ${glyph.top}..${glyph.bottom} in ${glyph.height} (top ${glyph.topGap}, bottom ${glyph.bottomGap})`,
    )
    const path = `${out}/composer-optical-${tag}-${OUT_W}-dark.png`
    await page.screenshot({ path, clip: await crop() })
    written.push(path)
  }

  // Before: the shipped 4fdea680 padding, forced through an override so the two crops differ only in it.
  await page.addStyleTag({ content: "[data-composer-input]{padding-top:4px !important;padding-bottom:4px !important}" })
  await page.waitForTimeout(200)
  await report("before")

  // After: the shipped rule.
  await page.evaluate(() => {
    const style = [...document.querySelectorAll("style")].find((node) => node.textContent?.includes("padding-top:4px !important"))
    style?.remove()
  })
  await page.waitForTimeout(200)
  await report("after")
  await context.close()
} finally {
  await browser.close()
  await server.close()
}
console.log(written.join("\n"))
