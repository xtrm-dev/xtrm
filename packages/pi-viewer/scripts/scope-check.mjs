// XTRM-1066: the thread request carries the pane or window scope, a scope change refetches
// the scoped window, and the poll after it is an incremental request for that scope.
// The API is mocked by a function that applies the scope the way server/thread-cache.ts does.
import assert from "node:assert/strict"
import { createServer } from "vite"
import { chromium } from "playwright"

const PORT = 5394
const SESSION = "xx"

function agentOf(id, paneId, windowIndex, windowId, name) {
  return {
    id,
    paneId,
    panePid: 1,
    piPid: 2,
    tmuxSession: SESSION,
    windowIndex,
    windowId,
    windowName: `win${windowIndex}`,
    paneIndex: 0,
    name,
    title: name,
    cwd: `/tmp/${name}`,
    sessionFile: `/tmp/${name}.jsonl`,
    sessionId: name,
    sessionName: name,
    model: "fixture",
    thinkingLevel: null,
    role: null,
    provider: "pi",
    modifiedAt: Date.now(),
    lastWriteAt: Date.now(),
    eventCount: 10,
    status: "idle",
    statusNote: null,
  }
}

// %1 and %2 share window @1; %3 is alone in @2.
const agents = [
  agentOf("%1", "%1", 1, "@1", "alpha"),
  agentOf("%2", "%2", 1, "@1", "bravo"),
  agentOf("%3", "%3", 2, "@2", "charlie"),
]
const sessions = { sessions: [{ name: SESSION, serverId: "test:tmux", agents }], capturedAt: Date.now(), error: null }

const T0 = Date.now() - 3_600_000
const events = []
let cursor = 0
const cursors = new Map()
for (const [lane, agent] of agents.entries()) {
  for (let index = 0; index < 4; index += 1) {
    const at = T0 + index * 60_000 + lane * 5_000
    for (const kind of ["user", "assistant"]) {
      const text = `${agent.name} ${kind === "user" ? "question" : "answer"} ${index}`
      const id = `${agent.id}:${events.length}`
      events.push({
        id,
        agentId: agent.id,
        agentName: agent.name,
        seq: events.length,
        at: kind === "user" ? at : at + 1_000,
        kind,
        role: kind,
        summary: text,
        text,
        ...(kind === "assistant" ? { parts: [{ type: "text", text }], stopReason: "stop" } : {}),
        onBranch: true,
        raw: null,
      })
      cursors.set(id, ++cursor)
    }
  }
}
events.sort((a, b) => a.at - b.at)

const requests = []
let delayMs = 0

function scopedAgents(params) {
  const pane = params.get("p")
  const window = params.get("w")
  if (pane) return agents.filter((agent) => agent.paneId === pane)
  if (window) return agents.filter((agent) => agent.windowId === window)
  return null
}

const server = await createServer({
  root: process.cwd(),
  logLevel: "error",
  server: { host: "127.0.0.1", port: PORT, strictPort: true },
})
await server.listen()
const base = `http://127.0.0.1:${PORT}`

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
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
  if (url.pathname !== "/api/thread") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
  if (url.searchParams.get("meta") === "1") {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: SESSION, serverId: "test:tmux", version: "v", agents, capturedAt: Date.now() }) })
  }
  const params = url.searchParams
  requests.push(Object.fromEntries(params))
  if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
  const scope = scopedAgents(params)
  const ids = scope ? new Set(scope.map((agent) => agent.id)) : null
  const tag = scope ? `~${scope.map((agent) => agent.id).join("")}` : ""
  const revision = `r1${tag}`
  const since = params.get("since")
  const mine = events.filter((event) => !ids || ids.has(event.agentId))
  const reset = since !== null && params.get("revision") !== revision
  const fresh = since !== null && !reset ? mine.filter((event) => cursors.get(event.id) > Number(since)) : mine
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      session: SESSION,
      serverId: "test:tmux",
      version: "v",
      agents,
      capturedAt: Date.now(),
      events: fresh,
      cursor,
      revision,
      hasEarlier: false,
      earlier: null,
      earlierTurns: 0,
      ...(reset ? { reset: true } : {}),
      ...(since !== null && !reset ? { unchanged: fresh.length === 0 } : {}),
    }),
  })
})

const texts = () => page.locator('[data-slot="message-scroller-item"]').allInnerTexts().then((all) => all.join("\n"))
const last = () => requests[requests.length - 1]

async function waitText(needle, absent) {
  await page.waitForFunction(
    ([want, other]) => {
      const body = [...document.querySelectorAll('[data-slot="message-scroller-item"]')].map((node) => node.textContent).join("\n")
      return body.includes(want) && !body.includes(other)
    },
    [needle, absent],
    { timeout: 15_000 },
  )
}

try {
  // 1. A pane scope in the URL: the first request is that pane's window, nothing else.
  await page.goto(`${base}/?s=${SESSION}&p=${encodeURIComponent("%2")}`, { waitUntil: "domcontentloaded" })
  await waitText("bravo answer 3", "alpha")
  const first = requests[0]
  assert.equal(first.p, "%2", "pane scope request carries p")
  assert.equal(first.w, undefined)
  assert.equal(first.limit, "150")
  assert.equal(first.since, undefined, "first request is a window, not a poll")
  assert.ok(!(await texts()).includes("charlie"), "no other pane's turns on screen")

  // 2. The next poll is incremental, for the same scope and the scoped revision.
  const poll = await waitFor(() => requests.find((entry) => entry.since !== undefined && entry.p === "%2"))
  assert.equal(poll.revision, "r1~%2", "poll sends the scoped revision")

  // 3. Switching pane refetches the window of the new pane; the page is not blanked meanwhile.
  delayMs = 500
  const before = requests.length
  await page.locator('[data-key="p:%3"]').click()
  await waitFor(() => requests.slice(before).find((entry) => entry.p === "%3"))
  const switched = requests.slice(before).find((entry) => entry.p === "%3")
  assert.equal(switched.since, undefined, "a scope change starts with a window, not a poll")
  assert.equal(switched.revision, undefined)
  assert.equal(await page.locator('[data-slot="thread-error"], [role="alert"]').count(), 0, "no error while the scoped window loads")
  delayMs = 0
  await waitText("charlie answer 3", "bravo")
  const incremental = await waitFor(() => requests.slice(before).find((entry) => entry.p === "%3" && entry.since !== undefined))
  assert.equal(incremental.revision, "r1~%3")

  // 4. A window row sends the window id, and shows that window's agents only.
  const beforeWindow = requests.length
  await page.locator('[data-key^="w:xx:"]').first().click()
  const win = await waitFor(() => requests.slice(beforeWindow).find((entry) => entry.w !== undefined))
  assert.match(win.w, /^@\d+$/, "window scope request carries the window id")
  assert.equal(win.p, undefined)
  await waitText("alpha answer 3", "charlie")
  assert.ok((await texts()).includes("bravo answer 3"), "both agents of the window")

  // 5. The session row sends no scope.
  const beforeSession = requests.length
  await page.locator(`[data-key="s:${SESSION}"]`).click()
  const whole = await waitFor(() => requests.slice(beforeSession).find((entry) => entry.since === undefined))
  assert.equal(whole.p, undefined)
  assert.equal(whole.w, undefined)
  await waitText("charlie answer 3", "nothing-like-this")
  assert.ok((await texts()).includes("alpha answer 3"))

  assert.deepEqual(errors, [], "no console errors")
  console.log(JSON.stringify({ ok: true, requests: requests.length, first, switched, win }, null, 2))
} finally {
  await browser.close()
  await server.close()
}

async function waitFor(find, timeout = 15_000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const found = find()
    if (found) return found
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out; requests: ${JSON.stringify(requests.slice(-6))}`)
}
