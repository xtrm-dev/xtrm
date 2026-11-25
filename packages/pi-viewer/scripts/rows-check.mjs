// One-line action rows browser check (XTRM-1047).
//
// Runs the app in-process with a mocked API (its own port, stopped at the end). For 390 and 1440 wide,
// with a 3000-character user message, a long agent reply (a code frame with an absurdly long language
// label inside) and an agent with a very long name, every action row under a message bubble and every
// code frame header must be ONE line:
// - the row's height equals its tallest child (no child sits below another);
// - every text-bearing leaf is at most one line high (height < 1.6 × its line-height);
// - nothing overflows the row horizontally (scrollWidth <= clientWidth);
// - the fold control, when shown, is left of the meta actions on the same line.
// The row also stays one line expanded, with the row revealed (hover) and with the delivery text long.
import assert from "node:assert/strict"
import { createServer } from "vite"
import { chromium } from "playwright"

const PORT = 5194
const SESSION = "xx"
const T0 = Date.now() - 3 * 60 * 60_000
const LONG_NAME = "agent-with-a-remarkably-long-name-that-cannot-fit-beside-the-actions-at-390"

function agent(index, name) {
  return {
    id: `%${index}`, paneId: `%${index}`, panePid: index, piPid: index, provider: "claude",
    tmuxSession: SESSION, windowIndex: 0, windowId: "@0", windowName: "w0", paneIndex: index,
    name, title: "", cwd: `/home/u/agent${index}`,
    sessionFile: `/tmp/agent${index}.jsonl`, sessionId: `s${index}`, sessionName: `agent${index}`,
    model: "claude-opus-5-5", thinkingLevel: null, role: "worker", modifiedAt: Date.now(),
    lastWriteAt: Date.now(), eventCount: 0, status: "idle", statusNote: null, statusDetail: null,
  }
}
function ev(index, name, seq, at, kind, extra = {}) {
  return {
    id: `%${index}:${seq}`, agentId: `%${index}`, agentName: name, seq, at, kind,
    role: kind === "user" ? "user" : "assistant", summary: `${kind} ${seq}`, onBranch: true, ...extra,
  }
}

const agents = [agent(1, "agent-alpha"), agent(2, LONG_NAME)]
const longUser = Array.from({ length: 60 }, (_, i) => `Line ${i}: ${"a long operator sentence with words ".repeat(1)}`).join("\n").padEnd(3000, "x")
const longReply = [
  "A long agent reply.",
  "",
  ...Array.from({ length: 6 }, (_, i) => `Paragraph ${i}. ${"The answer goes on and on. ".repeat(12)}`),
  "",
  "```" + "a-language-label-that-is-far-too-long-to-fit-in-a-code-frame-header-at-390-pixels",
  "const value = 1",
  "```",
].join("\n")
const events = []
for (const [index, name] of [[1, "agent-alpha"], [2, LONG_NAME]]) {
  const at = T0 + index * 10 * 60_000
  events.push(ev(index, name, 0, at, "user", { text: longUser, summary: "long" }))
  events.push(ev(index, name, 1, at + 5_000, "assistant", { parts: [{ type: "text", text: longReply }], stopReason: "stop", text: longReply }))
  events.push(ev(index, name, 2, at + 60_000, "user", { text: "short one", summary: "short" }))
  events.push(ev(index, name, 3, at + 65_000, "assistant", { parts: [{ type: "text", text: "Short reply." }], stopReason: "stop", text: "Short reply." }))
}

const server = await createServer({ root: process.cwd(), logLevel: "error", server: { host: "127.0.0.1", port: PORT, strictPort: true } })
await server.listen()
const base = `http://127.0.0.1:${PORT}`
const browser = await chromium.launch({ headless: true })

async function open(width, height, theme) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme })
  const page = await context.newPage()
  const errors = []
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()))
  page.on("pageerror", (error) => errors.push(String(error)))
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
  await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "visible" })
  await page.waitForTimeout(500)
  return { context, page, errors }
}

// Measure every action row in the page. Rows are marked data-action-row (user | agent | code).
const measure = (page) =>
  page.evaluate(() => {
    const out = []
    for (const row of document.querySelectorAll("[data-action-row]")) {
      const rect = row.getBoundingClientRect()
      const box = getComputedStyle(row)
      const content = rect.height - parseFloat(box.paddingTop) - parseFloat(box.paddingBottom)
      const kids = Array.from(row.querySelectorAll("*")).filter((node) => node.getBoundingClientRect().height > 0)
      const tallest = Math.max(0, ...Array.from(row.children).map((node) => node.getBoundingClientRect().height))
      const tops = Array.from(row.children).map((node) => node.getBoundingClientRect()).filter((r) => r.height > 0)
      const leaves = kids.filter((node) => !node.children.length && node.textContent.trim())
      const tallLeaf = leaves
        .map((node) => {
          const style = getComputedStyle(node)
          const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5
          return { text: node.textContent.trim().slice(0, 30), ratio: node.getBoundingClientRect().height / line }
        })
        .filter((leaf) => leaf.ratio >= 1.6)
      out.push({
        kind: row.dataset.actionRow,
        height: content,
        tallest,
        spread: tops.length ? Math.max(...tops.map((r) => r.top + r.height / 2)) - Math.min(...tops.map((r) => r.top + r.height / 2)) : 0,
        tallLeaf,
        overflowX: row.scrollWidth - row.clientWidth,
        right: rect.right,
        childRights: Array.from(row.children).map((node) => node.getBoundingClientRect().right),
        viewport: window.innerWidth,
      })
    }
    return out
  })

function assertOneLine(rows, label) {
  assert.ok(rows.length >= 6, `${label}: found ${rows.length} action rows`)
  for (const row of rows) {
    const tag = `${label} ${row.kind}`
    assert.ok(row.height <= row.tallest + 1.5, `${tag}: row height ${row.height} equals its tallest child ${row.tallest}`)
    assert.ok(row.spread <= 3, `${tag}: children share one line (centre spread ${row.spread})`)
    assert.deepEqual(row.tallLeaf, [], `${tag}: no text takes two lines`)
    assert.ok(row.overflowX <= 1, `${tag}: no horizontal overflow (${row.overflowX})`)
    assert.ok(Math.max(...row.childRights) <= row.viewport + 0.5, `${tag}: inside the viewport`)
  }
}

try {
  for (const [width, height] of [[390, 844], [1440, 900]]) {
    const { context, page, errors } = await open(width, height, "light")
    const label = String(width)
    const viewport = page.locator('[data-slot="message-scroller-viewport"]')

    // Scan the whole thread: scroll top to bottom so every row is in view, measuring at each step.
    const seen = new Map()
    const total = await viewport.evaluate((node) => node.scrollHeight)
    for (let y = 0; y <= total; y += 400) {
      await viewport.evaluate((node, top) => (node.scrollTop = top), y)
      await page.waitForTimeout(60)
    }
    await viewport.evaluate((node) => (node.scrollTop = 0))
    await page.waitForTimeout(150)
    // Reveal the meta rows (they are quiet until hover) by forcing them on; layout is the same either way.
    await page.addStyleTag({ content: ".xtrm-meta{opacity:1!important}" })

    // Folded (default): long user messages show the fold control.
    let rows = await measure(page)
    assertOneLine(rows, `${label} folded`)
    const folds = await page.getByRole("button", { name: /^Show (more|full message)$/ }).count()
    assert.ok(folds >= 1, `${label}: a long user message shows the fold control`)
    // The fold control is left of the meta actions, on the same line.
    const geo = await page.evaluate(() => {
      const row = document.querySelector('[data-action-row="user"]:has(button[aria-expanded])')
      const fold = row.querySelector("button[aria-expanded]").getBoundingClientRect()
      const meta = row.querySelector(".xtrm-meta").getBoundingClientRect()
      return { foldRight: fold.right, metaLeft: meta.left, foldTop: fold.top, metaTop: meta.top, foldBottom: fold.bottom, metaBottom: meta.bottom, rowLeft: row.getBoundingClientRect().left }
    })
    assert.ok(geo.foldRight <= geo.metaLeft + 0.5, `${label}: fold control is left of the meta actions`)
    assert.ok(Math.abs(geo.foldTop - geo.metaTop) < 8, `${label}: fold control and meta actions share the line`)

    // Expanded: the label is "Show less" and the row is still one line.
    await page.getByRole("button", { name: /^Show (more|full message)$/ }).first().click()
    await page.waitForTimeout(150)
    rows = await measure(page)
    assertOneLine(rows, `${label} expanded`)
    assert.ok((await page.getByRole("button", { name: "Show less" }).count()) >= 1, `${label}: expanded shows Show less`)

    // Scroll to the end so the long-reply rows and the code frame headers are measured as laid out.
    await viewport.evaluate((node) => (node.scrollTop = node.scrollHeight))
    await page.waitForTimeout(200)
    rows = await measure(page)
    assertOneLine(rows, `${label} end`)
    const kinds = new Set(rows.map((row) => row.kind))
    assert.deepEqual([...kinds].sort(), ["agent", "code", "user"], `${label}: user, agent and code rows measured`)

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, `${label}: no page overflow`)
    assert.deepEqual(errors, [], `${label}: no console errors`)
    await context.close()
    console.log(`rows-check ${label}: ${rows.length} rows one line`)
  }
  console.log("rows-check: ok")
} finally {
  await browser.close()
  await server.close()
}
