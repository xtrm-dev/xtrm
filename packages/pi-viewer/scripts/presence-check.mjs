// Working presence browser check (XTRM-1035, design §5).
//
// Runs the app in-process with a mocked API (the same harness as anchor-check.mjs, its own
// port, stopped at the end) and asserts:
// - when an agent starts a turn and when it settles, every row already in the thread keeps
//   its offsetTop inside the scroll content, the scroller's clientHeight does not change, and
//   the presence line keeps its height (28px at 1440, 32px at 390);
// - the settled turn is appended as the last row; no pending turn is ever in the thread;
// - the line text follows the count (1, 3, attention) and the panel keyboard path works;
// - no console error and no horizontal overflow at 1440 and 390.
import assert from "node:assert/strict"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "vite"
import { chromium } from "playwright"

const PORT = 5197
// Screenshots of the open detail, one per width and theme.
const SHOTS = process.env.PRESENCE_SHOTS ?? tmpdir()
const SESSION = "xx"
const T0 = Date.now() - 60 * 60_000

function agent(index, status = "waiting", note = "awaiting input") {
  return {
    id: `%${index}`,
    paneId: `%${index}`,
    panePid: index,
    piPid: index,
    provider: "claude",
    tmuxSession: SESSION,
    windowIndex: index,
    windowId: `@${index}`,
    windowName: `w${index}`,
    paneIndex: 0,
    name: `xtrm-xt-claude-agent${index}`,
    title: "",
    cwd: `/home/u/dev/xtrm/.xtrm/worktrees/agent${index}`,
    sessionFile: `/tmp/agent${index}.jsonl`,
    sessionId: `s${index}`,
    sessionName: `agent${index}`,
    model: "claude-opus-5-5",
    thinkingLevel: null,
    role: "worker",
    modifiedAt: Date.now(),
    eventCount: 0,
    status,
    statusNote: note,
    statusDetail: null,
  }
}

function ev(agentIndex, seq, at, kind, extra = {}) {
  return {
    id: `%${agentIndex}:${seq}`,
    agentId: `%${agentIndex}`,
    agentName: `xtrm-xt-claude-agent${agentIndex}`,
    seq,
    at,
    kind,
    role: kind === "user" ? "user" : "assistant",
    summary: `${kind} ${seq}`,
    onBranch: true,
    ...extra,
  }
}
const prompt = (a, seq, at, text) => ev(a, seq, at, "user", { text, summary: text })
const tool = (a, seq, at) =>
  ev(a, seq, at, "assistant", {
    parts: [{ type: "tool-call", toolName: "read", toolCallId: `c${a}-${seq}`, summary: "src/lib/thread.ts" }],
    stopReason: "toolUse",
  })
const reply = (a, seq, at, text) => ev(a, seq, at, "assistant", { parts: [{ type: "text", text }], stopReason: "stop", text })

// History: 24 settled exchanges of agent 1, enough to scroll.
const history = []
for (let index = 0; index < 24; index += 1) {
  const at = T0 + index * 60_000
  history.push(prompt(1, index * 2, at, `Question ${index}`))
  history.push(reply(1, index * 2 + 1, at + 5_000, `Answer ${index}\n\n${"A paragraph of the answer. ".repeat(12)}`))
}

const state = { version: 0, events: history, agents: [agent(1), agent(2), agent(3), agent(4)] }
function set(next) {
  Object.assign(state, next)
  state.version += 1
}

const server = await createServer({
  root: process.cwd(),
  logLevel: "error",
  server: { host: "127.0.0.1", port: PORT, strictPort: true },
})
await server.listen()
const base = `http://127.0.0.1:${PORT}`
const browser = await chromium.launch({ headless: true })
const report = {}

async function open(width, height, theme) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme })
  // The app reads its theme from localStorage (index.html), not from the colour scheme.
  await context.addInitScript((value) => localStorage.setItem("pi-viewer-theme", value), theme)
  const page = await context.newPage()
  const errors = []
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  page.on("pageerror", (error) => errors.push(String(error)))
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
    if (url.pathname === "/api/sessions") {
      return json({ sessions: [{ name: SESSION, agents: state.agents, capturedAt: Date.now() }], capturedAt: Date.now() })
    }
    if (url.pathname !== "/api/thread") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
    const meta = { session: SESSION, version: `v${state.version}`, agents: state.agents, capturedAt: Date.now() }
    if (url.searchParams.get("meta") === "1") return json(meta)
    return json({ ...meta, events: state.events })
  })
  await page.goto(`${base}/?s=${SESSION}`, { waitUntil: "domcontentloaded" })
  await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "visible" })
  await page.waitForTimeout(600)
  return { context, page, errors }
}

/** Row offsets inside the scroll content, the scroller height and the presence line. */
function measure(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
    const rows = Array.from(document.querySelectorAll('[data-slot="message-scroller-item"]'))
    const line = document.querySelector("[data-presence-line]")
    return {
      rows: rows.map((row) => [row.dataset.messageId, row.offsetTop]),
      clientHeight: viewport.clientHeight,
      lineHeight: line.getBoundingClientRect().height,
      lineText: line.innerText.replace(/\s+/g, " ").trim(),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
}

async function waitText(page, pattern) {
  await page.waitForFunction(
    (source) => new RegExp(source).test(document.querySelector("[data-presence-line]")?.innerText ?? ""),
    pattern.source,
    { timeout: 8_000 },
  )
  await page.waitForTimeout(300)
}

function assertStable(before, after, label) {
  for (const [id, top] of before.rows) {
    const now = after.rows.find(([other]) => other === id)
    assert.ok(now, `${label}: row ${id} left the thread`)
    assert.ok(Math.abs(now[1] - top) < 1, `${label}: row ${id} moved ${now[1] - top}px inside the scroll content`)
  }
  assert.equal(after.clientHeight, before.clientHeight, `${label}: the scroller height changed`)
  assert.equal(after.lineHeight, before.lineHeight, `${label}: the presence line height changed`)
}

const now = () => Date.now()
const resetState = () => set({ events: history, agents: [agent(1), agent(2), agent(3), agent(4)] })

try {
  for (const [width, height, lineHeight] of [
    [1440, 900, 28],
    [390, 844, 32],
  ]) {
    for (const theme of ["dark", "light"]) {
      resetState()
      const { context, page, errors } = await open(width, height, theme)
      const label = `${width}/${theme}`
      const idle = await measure(page)
      assert.equal(idle.lineHeight, lineHeight, `${label}: reserved line height at N=0`)
      assert.equal(idle.lineText, "", `${label}: the line is empty at N=0`)

      // Agent 2 starts: its prompt is appended, its running turn goes to presence only.
      const startAt = now()
      set({
        events: [...history, prompt(2, 0, startAt, "Start the presence work"), tool(2, 1, startAt + 500)],
        agents: [agent(1), agent(2, "working", "running tools"), agent(3), agent(4)],
      })
      await waitText(page, /agent2/)
      const started = await measure(page)
      assertStable(idle, started, `${label} start`)
      assert.ok(!started.rows.some(([id]) => id.startsWith("turn:%2")), `${label}: a running turn is in the thread`)
      assert.equal(started.rows.at(-1)[0], "user:%2:0", `${label}: the prompt is the appended row`)
      if (width === 1440) assert.match(started.lineText, /agent2 is working ?· Read src\/lib\/thread\.ts ?· \d+s/)

      // Agent 2 settles: its turn is appended last; nothing above moves.
      set({
        events: [...state.events, reply(2, 2, now(), "Presence is built.")],
        agents: [agent(1), agent(2), agent(3), agent(4)],
      })
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll('[data-slot="message-scroller-item"]')
        return rows[rows.length - 1]?.dataset.messageId?.startsWith("turn:%2")
      })
      await page.waitForTimeout(300)
      const settled = await measure(page)
      assertStable(started, settled, `${label} settle`)
      assert.equal(settled.lineText, "", `${label}: the line is empty after the settle`)

      // Three running agents, then one needs attention.
      const at = now()
      set({
        events: [...state.events, prompt(2, 3, at, "next"), tool(2, 4, at), prompt(3, 0, at, "go"), tool(3, 1, at), prompt(4, 0, at, "go"), tool(4, 1, at)],
        agents: [agent(1), agent(2, "working"), agent(3, "working"), agent(4, "working")],
      })
      await waitText(page, width === 1440 ? /agent2, agent3 and agent4 are working/ : /3 working/)
      const three = await measure(page)
      assert.equal(three.lineHeight, lineHeight, `${label}: line height at N=3`)
      set({
        agents: [agent(1), agent(2, "working"), { ...agent(3, "attention", "permission: Bash"), statusDetail: "Bash command\nrm -rf build" }, agent(4, "working")],
      })
      await waitText(page, /agent3 needs you/)
      const asking = await measure(page)
      assert.equal(asking.lineHeight, lineHeight, `${label}: line height with attention`)

      // Keyboard: line -> panel (attention first) -> detail -> back -> Escape returns focus.
      await page.locator("[data-presence-line]").focus()
      await page.keyboard.press("Enter")
      await page.locator('[role="option"]').first().waitFor()
      const first = await page.evaluate(() => document.activeElement?.getAttribute("title"))
      assert.equal(first, "xtrm-xt-claude-agent3", `${label}: attention sorts first and takes focus`)
      await page.keyboard.press("ArrowDown")
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("title")), "xtrm-xt-claude-agent2")
      await page.keyboard.press("ArrowUp")
      await page.keyboard.press("Enter")
      await page.getByText("answer it in the agent's pane").waitFor()
      await page.getByText("rm -rf build").waitFor()
      assert.equal(await page.locator("button", { hasText: /^(Allow|Approve|Deny|Interrupt)$/ }).count(), 0, "no keys to the agent")
      report[`${label}-shot`] = join(SHOTS, `presence-${width}-${theme}.png`)
      await page.screenshot({ path: report[`${label}-shot`] })
      await page.keyboard.press("ArrowLeft")
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("title")), "xtrm-xt-claude-agent3")
      await page.keyboard.press("Escape")
      await page.waitForTimeout(200)
      assert.equal(
        await page.evaluate(() => document.activeElement?.hasAttribute("data-presence-line")),
        true,
        `${label}: Escape returns focus to the line`,
      )

      // Escape works from an action button too, and closing keeps the composer target.
      await page.locator("[data-presence-line]").focus()
      await page.keyboard.press("Enter")
      await page.locator('[role="option"]').first().waitFor()
      await page.keyboard.press("Enter")
      await page.getByRole("button", { name: "Message", exact: true }).click()
      await page.waitForFunction(() =>
        document.querySelector("[data-composer-input]")?.getAttribute("placeholder")?.includes("agent3"),
      )
      await page.locator("[data-presence-line]").click()
      await page.locator('[role="option"]').first().waitFor()
      await page.keyboard.press("Enter")
      await page.getByRole("button", { name: "Open pane", exact: true }).focus()
      if (width < 640) {
        // The sheet traps Tab: from its last control focus wraps to its first.
        const wrapped = await page.evaluate(() => {
          const sheet = document.querySelector('[role="dialog"]')
          const buttons = Array.from(sheet.querySelectorAll("button")).filter((node) => node.offsetParent !== null)
          buttons.at(-1).focus()
          return buttons.length
        })
        assert.ok(wrapped > 1)
        await page.keyboard.press("Tab")
        assert.equal(
          await page.evaluate(() => document.querySelector('[role="dialog"]').contains(document.activeElement)),
          true,
          `${label}: Tab left the sheet`,
        )
      }
      await page.keyboard.press("Escape")
      await page.waitForTimeout(300)
      assert.equal(await page.locator('[role="option"], [role="dialog"]').count(), 0, `${label}: Escape from a button closes`)
      assert.match(
        (await page.locator("[data-composer-input]").getAttribute("placeholder")) ?? "",
        /agent3/,
        `${label}: closing the panel kept the composer target`,
      )

      const final = await measure(page)
      assert.ok(final.overflow <= 0, `${label}: horizontal overflow ${final.overflow}px`)
      assert.deepEqual(errors, [], `${label}: console errors`)
      report[label] = { lineHeight: final.lineHeight, rows: settled.rows.length, clientHeight: final.clientHeight }
      await context.close()
    }
  }
  console.log(JSON.stringify({ ok: true, ...report }, null, 2))
} finally {
  await browser.close()
  await server.close()
}
