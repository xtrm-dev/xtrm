// Palette switch browser check (XTRM-1046).
//
// Runs the app in-process with a mocked API (its own port, stopped at the end) and, for 1440 and 390
// wide, dark and light, asserts:
// - Threads is the default; the page canvas, the sidebar (at 1440) and the composer wear the values in
//   docs/design/palette-console.md for the active palette, and the composer's hairline only where no
//   fill step exists (console light, XTRM-1054);
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


// What docs/design/palette-console.md says each region wears. prose and muted are the computed text colours
// of the thread prose and of the quiet meta row; Desktop in the light theme is the Threads light set.
const THREADS_LIGHT = { canvas: "rgb(244, 244, 245)", sidebar: "rgb(244, 244, 245)", composer: "rgb(255, 255, 255)", edge: false, prose: "rgb(24, 24, 27)", muted: "rgb(95, 95, 104)" }
const EXPECT = {
  "threads dark": { canvas: "rgb(13, 13, 13)", sidebar: "rgb(24, 24, 24)", composer: "rgb(21, 21, 21)", edge: false, prose: "rgb(236, 236, 239)", muted: "rgb(160, 160, 168)" },
  "console dark": { canvas: "rgb(21, 21, 21)", sidebar: "rgb(35, 35, 35)", composer: "rgb(30, 30, 30)", edge: false, prose: "rgb(236, 236, 239)", muted: "rgb(160, 160, 168)" },
  "desktop dark": { canvas: "rgb(31, 31, 31)", sidebar: "rgb(36, 36, 36)", composer: "rgb(51, 51, 51)", edge: false, prose: "rgb(200, 200, 200)", muted: "rgb(161, 161, 161)", selected: "rgb(69, 69, 69)" },
  "threads light": THREADS_LIGHT,
  "console light": { canvas: "rgb(255, 255, 255)", sidebar: "rgb(244, 244, 245)", composer: "rgb(255, 255, 255)", edge: true, prose: "rgb(24, 24, 27)", muted: "rgb(95, 95, 104)" },
  "desktop light": THREADS_LIGHT,
}
// Soft text (XTRM-1053): the base's surfaces, Desktop's text; in light the base's light values.
const SOFT_TEXT = { prose: "rgb(200, 200, 200)", muted: "rgb(161, 161, 161)", ink: "rgb(228, 228, 228)" }
EXPECT["threads-soft dark"] = { ...EXPECT["threads dark"], ...SOFT_TEXT }
EXPECT["console-soft dark"] = { ...EXPECT["console dark"], ...SOFT_TEXT }
EXPECT["threads-soft light"] = EXPECT["threads light"]
EXPECT["console-soft light"] = EXPECT["console light"]
EXPECT["desktop dark"].ink = "rgb(228, 228, 228)"
const paletteName = (palette) =>
  ({ threads: "Threads", "threads-soft": "Threads · soft text", console: "Console", "console-soft": "Console · soft text", desktop: "Desktop" })[palette]

function expectPalette(seen, palette, theme, width, label) {
  const want = EXPECT[`${palette} ${theme}`]
  const tag = `${label} ${theme} ${palette}`
  assert.equal(seen.canvas, want.canvas, `${tag} canvas`)
  assert.equal(seen.composer, want.composer, `${tag} composer`)
  if (width >= 1024) assert.equal(seen.sidebar, want.sidebar, `${tag} sidebar`)
  assert.equal(/inset/.test(seen.shadow) && !/rgba\(0, 0, 0, 0\) 0px 0px 0px 1px inset/.test(seen.shadow), want.edge, `${tag} composer edge`)
  assert.equal(seen.prose, want.prose, `${tag} thread prose colour`)
  assert.equal(seen.muted, want.muted, `${tag} muted text colour`)
  if (want.ink) assert.equal(seen.ink, want.ink, `${tag} primary text colour`)
  // Soft text keeps the base's attributes: data-palette is the base, data-text marks the layer.
  assert.equal(seen.text, (palette.endsWith("-soft") || palette === "desktop") ? "soft" : null, `${tag} data-text`)
  if (want.selected && seen.selected) assert.equal(seen.selected, want.selected, `${tag} selected sidebar row`)
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
      text: document.documentElement.dataset.text ?? null,
      // The primary text colour, read through a probe that wears the text-ink class.
      ink: (() => {
        const probe = document.createElement("span")
        probe.className = "text-ink"
        document.body.append(probe)
        const color = getComputedStyle(probe).color
        probe.remove()
        return color
      })(),
      canvas: bg(box.closest(".bg-canvas")),
      shell: bg(shell),
      body: bg(document.body),
      sidebar: sidebar && sidebar.getBoundingClientRect().width > 0 ? bg(sidebar) : null,
      composer: bg(box),
      shadow: getComputedStyle(box).boxShadow,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      prose: (() => {
        const node = document.querySelector(".xtrm-prose")
        return node ? getComputedStyle(node).color : null
      })(),
      muted: (() => {
        // The agent turn's meta row (ChannelView `data-action-row="agent"`): the one quiet row that always
        // wears text-ink-muted. A bare `.xtrm-meta` also matches the user row's wrapper, which carries no
        // colour and inherits ink, so the probe names the row it means.
        const node = document.querySelector('[data-action-row="agent"].xtrm-meta')
        return node ? getComputedStyle(node).color : null
      })(),
      selected: (() => {
        const node = document.querySelector('[data-testid="sidebar"] [aria-selected="true"]')
        return node && sidebar.getBoundingClientRect().width > 0 ? bg(node) : null
      })(),
      // The presence pill's edge is the surrounding background (the console's cut-out trick).
      pillShadow: (() => {
        const mark = document.querySelector("[data-presence-line] span[aria-hidden]")
        return mark ? getComputedStyle(mark).boxShadow : null
      })(),
    }
  })

async function choose(page, name) {
  await page.getByRole("button", { name: /^Colours:/ }).click()
  await page.getByRole("radiogroup", { name: "Colours" }).getByRole("radio", { name, exact: true }).click()
  await page.keyboard.press("Escape")
}

const shots = {}
const OTHERS = ["threads-soft", "console", "console-soft", "desktop"]
try {
  for (const [width, height, label] of [[1440, 900, "1440"], [390, 844, "390"]]) {
    for (const theme of ["dark", "light"]) {
      const { context, page, errors, loads } = await open(width, height, theme)
      const viewport = page.locator('[data-slot="message-scroller-viewport"]')

      const before = await paint(page)
      assert.equal(before.palette, "threads", `${label} ${theme}: Threads is the default`)
      expectPalette(before, "threads", theme, width, label)
      await page.screenshot({ path: join(SHOTS, `mock-${label}-${theme}-threads.png`) })
      shots[`${label}-${theme}-threads`] = await page.screenshot()

      for (const palette of OTHERS) {
        // Scroll the thread mid-way, then switch.
        await viewport.evaluate((node) => (node.scrollTop = Math.round((node.scrollHeight - node.clientHeight) / 2)))
        await page.waitForTimeout(250)
        const top = await viewport.evaluate((node) => node.scrollTop)
        const loadsBefore = loads()
        await choose(page, paletteName(palette))
        await page.waitForTimeout(200)
        const after = await paint(page)
        assert.equal(after.palette, palette.replace("-soft", ""))
        expectPalette(after, palette, theme, width, label)
        assert.equal(after.shell, EXPECT[`${palette} ${theme}`].canvas, `${label} ${theme} ${palette} shell`)
        assert.equal(after.body, EXPECT[`${palette} ${theme}`].canvas, `${label} ${theme} ${palette} body`)
        assert.equal(await viewport.evaluate((node) => node.scrollTop), top, `${label} ${theme} ${palette}: the switch leaves the scroll position alone`)
        assert.equal(loads(), loadsBefore, "no reload")
        assert.equal(await page.evaluate(() => localStorage.getItem("pi-viewer-palette")), palette)
        await page.screenshot({ path: join(SHOTS, `mock-${label}-${theme}-${palette}.png`) })
        shots[`${label}-${theme}-${palette}`] = await page.screenshot()

        // Persisted: a reload keeps the palette without a flash of Threads.
        await page.reload({ waitUntil: "domcontentloaded" })
        await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "visible" })
        const reloaded = await paint(page)
        assert.equal(reloaded.palette, palette.replace("-soft", ""), `${palette} persists across a reload`)
        assert.equal(reloaded.text, (palette.endsWith("-soft") || palette === "desktop") ? "soft" : null, `${palette} text layer persists across a reload`)
        assert.equal(await page.evaluate(() => localStorage.getItem("pi-viewer-palette")), palette)
        assert.equal(reloaded.overflow, 0, `${label} ${theme} ${palette}: no horizontal overflow`)
      }

      // Independent mix (operator, 2026-11-26): Desktop sidebar, Threads chat, standard text. Each region keeps
      // its own plane, the trigger reads Custom, and the mix survives a reload.
      await page.getByRole("button", { name: /^Colours:/ }).click()
      await page.getByRole("radiogroup", { name: "Sidebar" }).getByRole("radio", { name: "Desktop", exact: true }).click()
      await page.getByRole("radiogroup", { name: "Chat" }).getByRole("radio", { name: "Threads", exact: true }).click()
      await page.getByRole("radiogroup", { name: "Text" }).getByRole("radio", { name: "Standard", exact: true }).click()
      await page.keyboard.press("Escape")
      await page.waitForTimeout(150)
      for (const pass of ["live", "reload"]) {
        if (pass === "reload") {
          await page.reload({ waitUntil: "domcontentloaded" })
          await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "visible" })
        }
        const mix = await paint(page)
        const tag = `${label} ${theme} mix (${pass})`
        assert.equal(mix.palette, "threads", `${tag}: the chat palette is Threads`)
        assert.equal(mix.text, null, `${tag}: standard text`)
        assert.equal(mix.canvas, EXPECT[`threads ${theme}`].canvas, `${tag}: the chat canvas is Threads'`)
        assert.equal(mix.prose, EXPECT[`threads ${theme}`].prose, `${tag}: prose reads in standard ink`)
        if (width >= 1024) {
          assert.equal(mix.sidebar, theme === "dark" ? "rgb(36, 36, 36)" : EXPECT[`threads ${theme}`].sidebar, `${tag}: the sidebar is Desktop's in dark, the shared light sidebar in light`)
        }
        assert.match(await page.getByRole("button", { name: /^Colours:/ }).getAttribute("aria-label"), /Custom$/, `${tag}: the trigger names the mix Custom`)
        assert.equal(mix.overflow, 0, `${tag}: no horizontal overflow`)
      }

      // And back; the choice list offers all three.
      await page.getByRole("button", { name: /^Colours:/ }).click()
      const names = await page.getByRole("radiogroup", { name: "Colours" }).getByRole("radio").allTextContents()
      assert.deepEqual(names.map((name) => name.replace(/dark only$/, "").trim()), ["Threads", "Threads · soft text", "Console", "Console · soft text", "Desktop"])
      await page.keyboard.press("Escape")
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
      for (const palette of ["threads", ...OTHERS]) {
        if (palette !== "threads") await choose(page, paletteName(palette))
        const seen = await paint(page)
        const want = EXPECT[`${palette} ${theme}`].canvas
        assert.ok(seen.pillShadow?.includes(`${want} 0px 0px 0px 2px`), `${label} ${theme} ${palette}: presence pill edge equals the canvas ${want}: ${seen.pillShadow}`)
        console.log(`pill edge ${label} ${theme} ${palette}: ${want}`)
      }
      assert.deepEqual(errors, [], `${label} ${theme}: no console errors (pill)`)
      await context.close()
    }
  }

  // Side by side, one image per viewport and theme: Threads, Console, Desktop.
  const page = await browser.newPage({ viewport: { width: 5000, height: 1000 } })
  for (const label of ["1440", "390"]) {
    for (const theme of ["dark", "light"]) {
      const figure = (name) => `<figure style="margin:0"><figcaption>${paletteName(name)}</figcaption><img style="max-width:${label === "1440" ? 900 : 390}px" src="data:image/png;base64,${shots[`${label}-${theme}-${name}`].toString("base64")}"></figure>`
      await page.setContent(`<body style="margin:0;display:flex;gap:16px;background:#888;padding:16px;align-items:flex-start;font:14px sans-serif">${["threads", ...OTHERS].map(figure).join("")}</body>`)
      await page.screenshot({ path: join(SHOTS, `mock-side-by-side-${label}-${theme}.png`), fullPage: true })
    }
  }
  console.log("palette-check: ok")
} finally {
  await browser.close()
  await server.close()
}
