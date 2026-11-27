// Composer screenshots (XTRM-1054, XTRM-1056, XTRM-1087, XTRM-1149, XTRM-1153): the empty box at rest and
// focused, a typed draft, the To menu, a Claude target, a nearly full context ring, and a working target
// (the bare Stop glyph beside the bare Send glyph, no filled boxes).
//
// Runs the app in-process with a mocked API on its own port (stopped at the end) and writes PNGs to this
// issue's folder, docs/design/shots/XTRM-1153/, so a plain `node scripts/shots-composer.mjs` reproduces the
// committed set. `--widths=1440,390,1024` (or SHOTS_WIDTHS) narrows the widths and `SHOTS_OUT` moves the
// folder. Not a gate: composer-check.mjs asserts the geometry, the absence of border and ring, and the
// context ring's fraction.
import { mkdir } from "node:fs/promises"

import { chromium } from "playwright"
import { createServer } from "vite"

const PORT = 5298
const SESSION = "xx"
const T0 = Date.now() - 60 * 60_000
// A plain run must land where the committed PNGs live and cover the same widths (XTRM-1153, #523 review).
const flag = process.argv.slice(2).find((arg) => arg.startsWith("--widths="))
const widths = (flag ? flag.slice("--widths=".length) : process.env.SHOTS_WIDTHS || "1440,390")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0)
if (!widths.length) throw new Error("no width to shoot: pass --widths=1440,390")
const out = process.env.SHOTS_OUT || "docs/design/shots/XTRM-1153"

function agent(index, name, provider, model, thinkingLevel, context = null, status = "idle") {
  return {
    id: `%${index}`, paneId: `%${index}`, panePid: index, piPid: index, provider,
    tmuxSession: SESSION, windowIndex: 0, windowId: "@0", windowName: "w0", paneIndex: index,
    name, title: "", cwd: `/home/u/${name}`,
    sessionFile: `/tmp/${name}.jsonl`, sessionId: `s${index}`, sessionName: name,
    model, thinkingLevel, role: "worker", modifiedAt: Date.now(),
    lastWriteAt: Date.now(), eventCount: 0, status, statusNote: null, statusDetail: null, context,
  }
}

// 46% of a 200k window, so the ring shows a readable arc; the Claude target reports no usage at all.
const PI = agent(1, "agent-pi", "pi", "anthropic/claude-sonnet-4-5", "high", { used: 92_000, window: 200_000 })
const CLAUDE = agent(2, "agent-claude", "claude", "claude-opus-4-5", null, null)
const events = [
  { id: "%1:0", agentId: "%1", agentName: PI.name, seq: 0, at: T0, kind: "user", role: "user", summary: "hi", onBranch: true, text: "hi" },
  { id: "%1:1", agentId: "%1", agentName: PI.name, seq: 1, at: T0 + 5_000, kind: "assistant", role: "assistant", summary: "hello", onBranch: true, text: "hello", parts: [{ type: "text", text: "hello" }], stopReason: "stop" },
]
// The working pass captures the Stop control (XTRM-1149). The agent's status is fixed before the page
// loads, because the session poll that refreshes a status runs every 10s. Every /api request except the
// two read endpoints is refused here, so no stop or send can leave the page.
const states = [
  { state: "idle", agents: [PI, CLAUDE] },
  { state: "working", agents: [{ ...PI, status: "working" }, CLAUDE] },
]

await mkdir(out, { recursive: true })
const server = await createServer({ root: process.cwd(), logLevel: "error", server: { host: "127.0.0.1", port: PORT, strictPort: true } })
await server.listen()
const base = `http://127.0.0.1:${PORT}`
const browser = await chromium.launch({ headless: true })
const written = []

try {
  for (const width of widths) {
    for (const theme of ["dark", "light"]) {
    for (const { state, agents } of states) {
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

    if (state === "working") {
      await page.locator("[data-composer-stop]").waitFor({ state: "visible" })
      const lane = page.locator(".xtrm-lane", { has: input }).first()
      await lane.screenshot({ path: `${out}/composer-working-${width}-${theme}.png` })
      written.push(`${out}/composer-working-${width}-${theme}.png`)
      await input.fill("checking the guardrails")
      await page.waitForTimeout(200)
      await lane.screenshot({ path: `${out}/composer-working-typed-${width}-${theme}.png` })
      written.push(`${out}/composer-working-typed-${width}-${theme}.png`)
      await context.close()
      continue
    }

    await shot("empty")
    await input.click()
    await page.waitForTimeout(250)
    await shot("empty-focused")
    await input.fill("Draft one line")
    await page.waitForTimeout(150)
    await shot("typed")
    await input.fill("")
    await page.locator("[data-composer-under-row] button[aria-expanded]").click()
    await page.waitForTimeout(200)
    await shot("menu")
    await page.locator("[data-composer-menu] button", { hasText: CLAUDE.name }).click()
    await page.waitForTimeout(200)
    await shot("claude-target")
    await context.close()
    }
    }
  }
} finally {
  await browser.close()
  await server.close()
}
console.log(written.join("\n"))
