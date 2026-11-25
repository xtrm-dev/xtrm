// Palette switch browser check (XTRM-1046).
//
// Runs the app in-process with a mocked API (its own port, stopped at the end) and, for 1440 and 390
// wide, dark and light, asserts:
// - Threads is the default; the page canvas, the sidebar (at 1440) and the composer wear the values in
//   docs/design/palette-console.md for the active palette, and the composer edge only in Console;
// - choosing Console in the header control switches at once: the root data-palette changes, the
//   scroll position of the thread does not move, nothing reloads, and the choice survives a reload;
// - no console error and no horizontal overflow.
// It also writes a side-by-side image of both palettes per theme to PALETTE_SHOTS.
import assert from "node:assert/strict"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer } from "vite"
import { chromium } from "playwright"

const PORT = 5195
const SHOTS = process.env.PALETTE_SHOTS ?? tmpdir()
const SESSION = "xx"
const T0 = Date.now() - 3 * 60 * 60_000

function agent(index) {
  return {
    id: `%${index}`, paneId: `%${index}`, panePid: index, piPid: index, provider: "claude",
    tmuxSession: SESSION, windowIndex: 0, windowId: "@0", windowName: "w0", paneIndex: index,
    name: `agent-${["", "alpha", "beta", "gamma"][index]}`, title: "", cwd: `/home/u/agent${index}`,
    sessionFile: `/tmp/agent${index}.jsonl`, sessionId: `s${index}`, sessionName: `agent${index}`,
    model: "claude-opus-5-5", thinkingLevel: null, role: "worker", modifiedAt: Date.now(),
    lastWriteAt: Date.now(), eventCount: 0, status: "idle", statusNote: null, statusDetail: null,
  }
}
function ev(index, seq, at, kind, extra = {}) {
  return {
    id: `%${index}:${seq}`, agentId: `%${index}`, agentName: agent(index).name, seq, at, kind,
    role: kind === "user" ? "user" : "assistant", summary: `${kind} ${seq}`, onBranch: true, ...extra,
  }
}
const events = []
for (let i = 0; i < 30; i += 1) {
  const a = 1 + (i % 2)
  const at = T0 + i * 60_000
  events.push(ev(a, i * 2, at, "user", { text: `Question ${i}`, summary: `Question ${i}` }))
  const text = `Answer ${i}\n\n${"A paragraph of the answer. ".repeat(10)}\n\n\`\`\`ts\nconst value = ${i}\n\`\`\``
  events.push(ev(a, i * 2 + 1, at + 5_000, "assistant", { parts: [{ type: "text", text }], stopReason: "stop", text }))
}
const agents = [agent(1), agent(2)]
// A third agent works, so the presence line above the composer shows its pill (XTRM-1047). A working
// agent makes the thread follow the end, so the pill is checked in its own page, after the switch checks.
const workingAgents = [...agents, { ...agent(3), name: "agent-gamma", status: "working", statusNote: "running tools" }]


// What docs/design/palette-console.md says each region wears.
const EXPECT = {
  "threads dark": { canvas: "rgb(13, 13, 13)", sidebar: "rgb(24, 24, 24)", composer: "rgb(21, 21, 21)", edge: false },
  "console dark": { canvas: "rgb(21, 21, 21)", sidebar: "rgb(35, 35, 35)", composer: "rgb(21, 21, 21)", edge: true },
  "threads light": { canvas: "rgb(244, 244, 245)", sidebar: "rgb(244, 244, 245)", composer: "rgb(255, 255, 255)", edge: false },
  "console light": { canvas: "rgb(255, 255, 255)", sidebar: "rgb(244, 244, 245)", composer: "rgb(255, 255, 255)", edge: true },
}

const server = await createServer({ root: process.cwd(), logLevel: "error", server: { host: "127.0.0.1", port: PORT, strictPort: true } })
await server.listen()
const base = `http://127.0.0.1:${PORT}`
const browser = await chromium.launch({ headless: true })

async function open(width, height, theme, list = agents) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme })
  await context.addInitScript((value) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("pi-viewer-theme", value)
      sessionStorage.setItem("seeded", "1")
    }
  }, theme)
  const page = await context.newPage()
  const errors = []
  page.on("console", (message) => message.type() === "error" && errors.push(message.text()))
  page.on("pageerror", (error) => errors.push(String(error)))
  let loads = 0
  page.on("load", () => (loads += 1))
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url())
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
    if (url.pathname === "/api/sessions") return json({ sessions: [{ name: SESSION, agents: list, capturedAt: Date.now() }], capturedAt: Date.now() })
    if (url.pathname !== "/api/thread") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
    const meta = { session: SESSION, version: "v1", agents: list, capturedAt: Date.now() }
    if (url.searchParams.get("meta") === "1") return json(meta)
    return json({ ...meta, events, cursor: events.length, revision: "r1", hasEarlier: false, earlier: null, earlierTurns: 0 })
  })
  await page.goto(`${base}/?s=${SESSION}`, { waitUntil: "domcontentloaded" })
  await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "visible" })
  await page.waitForTimeout(500)
  return { context, page, errors, loads: () => loads }
}

const paint = (page) =>
  page.evaluate(() => {
    const bg = (node) => (node ? getComputedStyle(node).backgroundColor : null)
    const box = document.querySelector(".xtrm-composer-box")
    const sidebar = document.querySelector('[data-testid="sidebar"]')
    const shell = document.querySelector('[data-slot="message-scroller"]')?.closest(".bg-canvas")
    return {
      palette: document.documentElement.dataset.palette,
      canvas: bg(box.closest(".bg-canvas")),
      shell: bg(shell),
      body: bg(document.body),
      sidebar: sidebar && sidebar.getBoundingClientRect().width > 0 ? bg(sidebar) : null,
      composer: bg(box),
      shadow: getComputedStyle(box).boxShadow,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      // The presence pill's edge is the surrounding background (the console's cut-out trick).
      pillShadow: (() => {
        const mark = document.querySelector("[data-presence-line] span[aria-hidden]")
        return mark ? getComputedStyle(mark).boxShadow : null
      })(),
    }
  })

async function choose(page, name) {
  await page.getByRole("button", { name: /^Colours:/ }).click()
  await page.getByRole("radiogroup", { name: "Colours" }).getByRole("radio", { name }).click()
  await page.keyboard.press("Escape")
}

const shots = {}
try {
  for (const [width, height, label] of [[1440, 900, "1440"], [390, 844, "390"]]) {
    for (const theme of ["dark", "light"]) {
      const { context, page, errors, loads } = await open(width, height, theme)
      const viewport = page.locator('[data-slot="message-scroller-viewport"]')

      const before = await paint(page)
      assert.equal(before.palette, "threads", `${label} ${theme}: Threads is the default`)
      const t = EXPECT[`threads ${theme}`]
      assert.equal(before.canvas, t.canvas, `${label} ${theme} threads canvas`)
      assert.equal(before.composer, t.composer, `${label} ${theme} threads composer`)
      if (width >= 1024) assert.equal(before.sidebar, t.sidebar, `${label} ${theme} threads sidebar`)
      assert.match(before.shadow, /rgba\(0, 0, 0, 0\)/, `${label} ${theme} threads composer has no edge`)
      await page.screenshot({ path: join(SHOTS, `mock-${label}-${theme}-threads.png`) })
      shots[`${label}-${theme}-threads`] = await page.screenshot()

      // Scroll the thread mid-way, then switch.
      await viewport.evaluate((node) => (node.scrollTop = Math.round((node.scrollHeight - node.clientHeight) / 2)))
      await page.waitForTimeout(250)
      const top = await viewport.evaluate((node) => node.scrollTop)
      const loadsBefore = loads()
      await choose(page, "Console")
      await page.waitForTimeout(200)
      const after = await paint(page)
      const c = EXPECT[`console ${theme}`]
      assert.equal(after.palette, "console")
      assert.equal(after.canvas, c.canvas, `${label} ${theme} console canvas`)
      assert.equal(after.shell, c.canvas, `${label} ${theme} console shell`)
      assert.equal(after.body, c.canvas, `${label} ${theme} console body`)
      assert.equal(after.composer, c.composer, `${label} ${theme} console composer`)
      if (width >= 1024) assert.equal(after.sidebar, c.sidebar, `${label} ${theme} console sidebar`)
      assert.ok(!/rgba\(0, 0, 0, 0\) 0px 0px 0px 1px inset/.test(after.shadow) && /inset/.test(after.shadow), `${label} ${theme} console composer has an edge`)
      assert.equal(await viewport.evaluate((node) => node.scrollTop), top, `${label} ${theme}: the switch leaves the scroll position alone`)
      assert.equal(loads(), loadsBefore, "no reload")
      assert.equal(await page.evaluate(() => localStorage.getItem("pi-viewer-palette")), "console")
      await page.screenshot({ path: join(SHOTS, `mock-${label}-${theme}-console.png`) })
      shots[`${label}-${theme}-console`] = await page.screenshot()

      // Persisted: a reload keeps Console without a flash of Threads.
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "visible" })
      assert.equal((await paint(page)).palette, "console", "Console persists across a reload")
      assert.equal((await paint(page)).overflow, 0, `${label} ${theme}: no horizontal overflow`)

      // And back.
      await choose(page, "Threads")
      assert.equal((await paint(page)).palette, "threads")
      assert.deepEqual(errors, [], `${label} ${theme}: no console errors`)
      await context.close()
    }
  }

  // The presence pill's edge is the surrounding background, the console's cut-out trick: in each
  // palette and theme it equals that palette's canvas, so the pill reads as a cut-out, not an outlined chip.
  for (const [width, height, label] of [[1440, 900, "1440"], [390, 844, "390"]]) {
    for (const theme of ["dark", "light"]) {
      const { context, page, errors } = await open(width, height, theme, workingAgents)
      await page.locator("[data-presence-line] span[aria-hidden]").first().waitFor({ state: "visible" })
      for (const palette of ["threads", "console"]) {
        if (palette === "console") await choose(page, "Console")
        const seen = await paint(page)
        const want = EXPECT[`${palette} ${theme}`].canvas
        assert.ok(seen.pillShadow?.includes(`${want} 0px 0px 0px 2px`), `${label} ${theme} ${palette}: presence pill edge equals the canvas ${want}: ${seen.pillShadow}`)
        console.log(`pill edge ${label} ${theme} ${palette}: ${want}`)
      }
      assert.deepEqual(errors, [], `${label} ${theme}: no console errors (pill)`)
      await context.close()
    }
  }

  // Side by side, one image per viewport and theme.
  const page = await browser.newPage({ viewport: { width: 2000, height: 1000 } })
  for (const label of ["1440", "390"]) {
    for (const theme of ["dark", "light"]) {
      const a = shots[`${label}-${theme}-threads`].toString("base64")
      const b = shots[`${label}-${theme}-console`].toString("base64")
      await page.setContent(`<body style="margin:0;display:flex;gap:16px;background:#888;padding:16px;align-items:flex-start;font:14px sans-serif">
        <figure style="margin:0"><figcaption>Threads</figcaption><img style="max-width:${label === "1440" ? 960 : 390}px" src="data:image/png;base64,${a}"></figure>
        <figure style="margin:0"><figcaption>Console</figcaption><img style="max-width:${label === "1440" ? 960 : 390}px" src="data:image/png;base64,${b}"></figure></body>`)
      await page.screenshot({ path: join(SHOTS, `mock-side-by-side-${label}-${theme}.png`), fullPage: true })
    }
  }
  console.log("palette-check: ok")
} finally {
  await browser.close()
  await server.close()
}
