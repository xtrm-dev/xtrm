// Composer screenshots (XTRM-1054): the empty box, a typed draft, the To menu and a Claude target.
//
// Runs the app in-process with a mocked API on its own port (stopped at the end) and writes PNGs to
// docs/design/shots/XTRM-1054/. Not a gate: composer-check.mjs asserts the geometry.
import { mkdir } from "node:fs/promises"

import { chromium } from "playwright"
import { createServer } from "vite"

const PORT = 5298
const SESSION = "xx"
const T0 = Date.now() - 60 * 60_000
const out = "docs/design/shots/XTRM-1054"

function agent(index, name, provider, model, thinkingLevel) {
  return {
    id: `%${index}`, paneId: `%${index}`, panePid: index, piPid: index, provider,
    tmuxSession: SESSION, windowIndex: 0, windowId: "@0", windowName: "w0", paneIndex: index,
    name, title: "", cwd: `/home/u/${name}`,
    sessionFile: `/tmp/${name}.jsonl`, sessionId: `s${index}`, sessionName: name,
    model, thinkingLevel, role: "worker", modifiedAt: Date.now(),
    lastWriteAt: Date.now(), eventCount: 0, status: "idle", statusNote: null, statusDetail: null,
  }
}

const PI = agent(1, "agent-pi", "pi", "anthropic/claude-sonnet-4-5", "high")
const CLAUDE = agent(2, "agent-claude", "claude", "claude-opus-4-5", null)
const agents = [PI, CLAUDE]
const events = [
  { id: "%1:0", agentId: "%1", agentName: PI.name, seq: 0, at: T0, kind: "user", role: "user", summary: "hi", onBranch: true, text: "hi" },
  { id: "%1:1", agentId: "%1", agentName: PI.name, seq: 1, at: T0 + 5_000, kind: "assistant", role: "assistant", summary: "hello", onBranch: true, text: "hello", parts: [{ type: "text", text: "hello" }], stopReason: "stop" },
]

await mkdir(out, { recursive: true })
const server = await createServer({ root: process.cwd(), logLevel: "error", server: { host: "127.0.0.1", port: PORT, strictPort: true } })
await server.listen()
const base = `http://127.0.0.1:${PORT}`
const browser = await chromium.launch({ headless: true })
const written = []

try {
  for (const width of [1440, 390]) {
    for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 } })
    // The viewer's theme comes from localStorage (index.html reads pi-viewer-theme), not from colorScheme.
    await context.addInitScript((value) => localStorage.setItem("pi-viewer-theme", value), theme)
    const page = await context.newPage()
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url())
      const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
      if (url.pathname === "/api/sessions") return json({ sessions: [{ name: SESSION, agents, capturedAt: Date.now() }], capturedAt: Date.now() })
      if (url.pathname !== "/api/thread") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
      const meta = { session: SESSION, version: "v1", agents, capturedAt: Date.now() }
      if (url.searchParams.get("meta") === "1") return json(meta)
      return json({ ...meta, events, cursor: events.length, revision: "r1", hasEarlier: false, earlier: null, earlierTurns: 0 })
    })
    await page.goto(`${base}/?s=${SESSION}`, { waitUntil: "domcontentloaded" })
    const input = page.locator("[data-composer-input]")
    await input.waitFor({ state: "visible" })
    await page.waitForTimeout(300)

    const shot = async (name) => {
      const path = `${out}/composer-${name}-${width}-${theme}.png`
      await page.screenshot({ path })
      written.push(path)
    }

    await shot("empty")
    await input.fill("Draft one line")
    await page.waitForTimeout(150)
    await shot("typed")
    await input.fill("")
    await page.locator("[data-composer-under-row] button").first().click()
    await page.waitForTimeout(200)
    await shot("menu")
    await page.locator("[data-composer-menu] button", { hasText: CLAUDE.name }).click()
    await page.waitForTimeout(200)
    await shot("claude-target")
    await context.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}
console.log(written.join("\n"))
