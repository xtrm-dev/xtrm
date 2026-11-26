// Stop control check (XTRM-1088).
//
// Runs the app in-process with a mocked API and asserts the operator's ruling: while the target is
// working, the composer offers a Stop control and Esc in an empty box does the same, and either sends
// exactly ONE request to /api/stop for the target's own pane. Never a stretch of tmux: the server's
// send path is mocked here, and the mapping itself is unit-tested in test/stop.test.ts, so no key can
// reach a real pane from this script.
import assert from "node:assert/strict"

import { chromium } from "playwright"
import { createServer } from "vite"

const PORT = 5294
const SESSION = "xx"
const T0 = Date.now() - 60 * 60_000

function agent(index, name, status) {
  return {
    id: `%${index}`, paneId: `%${index}`, panePid: index, piPid: index, provider: "pi",
    tmuxSession: SESSION, windowIndex: 0, windowId: "@0", windowName: "w0", paneIndex: index,
    name, title: "", cwd: `/home/u/${name}`,
    sessionFile: `/tmp/${name}.jsonl`, sessionId: `s${index}`, sessionName: name,
    model: "anthropic/claude-sonnet-4-5", thinkingLevel: "high", role: "worker",
    modifiedAt: Date.now(), lastWriteAt: Date.now(), eventCount: 0,
    status, statusNote: null, statusDetail: null, context: null,
  }
}

const working = agent(1, "agent-pi", "working")
const idle = agent(2, "agent-idle", "idle")
const agents = [working, idle]
const events = [
  { id: "%1:0", agentId: "%1", agentName: working.name, seq: 0, at: T0, kind: "user", role: "user", summary: "hi", onBranch: true, text: "hi" },
]

const stops = []
const sends = []
let current = working // the session payload the viewer polls; the scenario flips this agent's status

const server = await createServer({ root: process.cwd(), logLevel: "error", server: { host: "127.0.0.1", port: PORT, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const consoleErrors = []
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text())
})
const label = "1440 dark"

try {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
    if (url.pathname === "/api/sessions") {
      const list = agents.map((entry) => (entry.id === current.id ? { ...entry, status: current.status } : entry))
      return json({ sessions: [{ name: SESSION, agents: list, capturedAt: Date.now() }], capturedAt: Date.now() })
    }
    if (url.pathname === "/api/stop") {
      stops.push(JSON.parse(route.request().postData() ?? "{}"))
      return json({ ok: true, at: Date.now() })
    }
    if (url.pathname === "/api/send") {
      sends.push(JSON.parse(route.request().postData() ?? "{}"))
      return json({ ok: true, at: Date.now() })
    }
    if (url.pathname !== "/api/thread") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
    const meta = { session: SESSION, version: "v1", agents, capturedAt: Date.now() }
    if (url.searchParams.get("meta") === "1") return json(meta)
    return json({ ...meta, events, cursor: events.length, revision: "r1", hasEarlier: false, earlier: null, earlierTurns: 0 })
  })

  await page.goto(`http://127.0.0.1:${PORT}/?s=${SESSION}`, { waitUntil: "domcontentloaded" })
  await page.locator("[data-composer-input]").waitFor({ state: "visible" })
  await page.waitForTimeout(400)

  const stopButton = page.locator("[data-composer-stop]")
  const input = page.locator("[data-composer-input]")

  // 1. While the target works, both controls are present and the send button is untouched.
  assert.equal(await stopButton.count(), 1, `${label}: a working target offers a Stop control`)
  assert.equal(await stopButton.getAttribute("aria-label"), `Stop ${working.name}`, `${label}: Stop names its agent`)
  assert.equal(await stopButton.getAttribute("title"), "Stop (Esc)", `${label}: Stop advertises Esc`)
  assert.equal(await page.locator("[data-composer-controls] button[aria-label='Send']").count(), 1, `${label}: Send stays available beside Stop`)

  // 2. One click, one request, for the target's own pane, and never a prompt.
  await stopButton.click()
  await page.waitForTimeout(250)
  assert.equal(stops.length, 1, `${label}: the click sends exactly one stop request (${stops.length})`)
  assert.equal(stops[0].paneId, working.paneId, `${label}: the stop addresses the target's pane (${JSON.stringify(stops[0])})`)
  assert.equal(sends.length, 0, `${label}: a stop sends no prompt`)

  // 3. Esc in the empty box does the same.
  await input.click()
  await page.keyboard.press("Escape")
  await page.waitForTimeout(250)
  assert.equal(stops.length, 2, `${label}: Esc on an empty box stops the turn (${stops.length})`)
  assert.equal(stops[1].paneId, working.paneId, `${label}: Esc addresses the same pane`)

  // 4. Esc with text in the box leaves the turn alone: it is the operator's draft, not a stop.
  await input.fill("half a thought")
  await page.keyboard.press("Escape")
  await page.waitForTimeout(250)
  assert.equal(stops.length, 2, `${label}: Esc with text in the box sends nothing (${stops.length})`)
  assert.equal(await input.inputValue(), "half a thought", `${label}: the draft survives Esc`)
  await input.fill("")

  // 5. A quiet target offers no Stop: Escape to an idle pane would type into a prompt nobody interrupts.
  current = idle
  await page.waitForTimeout(1_200)
  await page.locator("[data-composer-under-row] button[aria-expanded]").click()
  await page.locator(`[data-composer-menu] button`, { hasText: idle.name }).first().click()
  await page.waitForTimeout(400)
  assert.equal(await stopButton.count(), 0, `${label}: an idle target draws no Stop control`)
  await input.click()
  await page.keyboard.press("Escape")
  await page.waitForTimeout(250)
  assert.equal(stops.length, 2, `${label}: Esc on an idle target stops nothing (${stops.length})`)

  assert.deepEqual(consoleErrors, [], `${label}: no console error`)
  console.log(`${label}: stop ok — working shows Stop, one click and one Esc each send one /api/stop, idle shows none, no console error`)
} finally {
  await context.close()
  await browser.close()
  await server.close()
}
