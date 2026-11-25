// Live Desktop palette check against the shared viewer (XTRM-1051). A client only: it never starts a
// server and sends nothing. Usage: node scripts/shots-desktop.mjs [baseUrl=http://127.0.0.1:5199] [session=xx]
// For 1440 and 390 wide, dark and light, one browser at a time: Threads is the default; choosing Desktop
// through the header control switches at once, keeps the scroll position, survives a reload and wears the
// values of docs/design/palette-console.md (canvas, sidebar at 1440, composer, thread prose, muted text,
// the selected sidebar row); in the light theme Desktop equals Threads light; 0 console errors; 0px
// overflow. Writes docs/design/shots/XTRM-1051/live-*.png and a three-palette side by side per viewport
// and theme (Threads, Console, Desktop).
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const [base = "http://127.0.0.1:5199", session = "xx"] = process.argv.slice(2)
const out = fileURLToPath(new URL("../docs/design/shots/XTRM-1051/", import.meta.url))
mkdirSync(out, { recursive: true })

const THREADS_LIGHT = { canvas: "rgb(244, 244, 245)", sidebar: "rgb(244, 244, 245)", composer: "rgb(255, 255, 255)", prose: "rgb(24, 24, 27)", muted: "rgb(95, 95, 104)" }
const EXPECT = {
  "threads dark": { canvas: "rgb(13, 13, 13)", sidebar: "rgb(24, 24, 24)", composer: "rgb(21, 21, 21)", prose: "rgb(236, 236, 239)", muted: "rgb(160, 160, 168)" },
  "console dark": { canvas: "rgb(21, 21, 21)", sidebar: "rgb(35, 35, 35)", composer: "rgb(21, 21, 21)", prose: "rgb(236, 236, 239)", muted: "rgb(160, 160, 168)" },
  "desktop dark": { canvas: "rgb(31, 31, 31)", sidebar: "rgb(36, 36, 36)", composer: "rgb(51, 51, 51)", prose: "rgb(200, 200, 200)", muted: "rgb(142, 142, 142)", selected: "rgb(69, 69, 69)" },
  "threads light": THREADS_LIGHT,
  "console light": { canvas: "rgb(255, 255, 255)", sidebar: "rgb(244, 244, 245)", composer: "rgb(255, 255, 255)", prose: "rgb(24, 24, 27)", muted: "rgb(95, 95, 104)" },
  "desktop light": THREADS_LIGHT,
}
const NAME = { threads: "Threads", console: "Console", desktop: "Desktop" }

const paint = (page) =>
  page.evaluate(() => {
    const bg = (node) => (node ? getComputedStyle(node).backgroundColor : null)
    const box = document.querySelector(".xtrm-composer-box")
    const sidebar = document.querySelector('[data-testid="sidebar"]')
    const wide = sidebar && sidebar.getBoundingClientRect().width > 0
    const selected = wide ? sidebar.querySelector('[aria-selected="true"]') : null
    // Reveal the quiet meta row for measuring; opacity does not change the colour.
    const meta = document.querySelector(".xtrm-meta")
    return {
      palette: document.documentElement.dataset.palette,
      canvas: bg(box.closest(".bg-canvas")),
      sidebar: wide ? bg(sidebar) : null,
      composer: bg(box),
      prose: document.querySelector(".xtrm-prose") ? getComputedStyle(document.querySelector(".xtrm-prose")).color : null,
      muted: meta ? getComputedStyle(meta).color : null,
      selected: selected ? bg(selected) : null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }
  })

function matches(seen, want) {
  return (
    seen.canvas === want.canvas &&
    seen.composer === want.composer &&
    (seen.sidebar === null || seen.sidebar === want.sidebar) &&
    (seen.prose === null || seen.prose === want.prose) &&
    (seen.muted === null || seen.muted === want.muted) &&
    (!want.selected || seen.selected === null || seen.selected === want.selected)
  )
}

async function choose(page, name) {
  await page.getByRole("button", { name: /^Colours:/ }).click()
  await page.getByRole("radiogroup", { name: "Colours" }).getByRole("radio", { name }).click()
  await page.keyboard.press("Escape")
}

const browser = await chromium.launch()
const rows = []
const shots = {}
let problems = 0
try {
  for (const [width, height, label] of [[1440, 900, "1440"], [390, 844, "390"]]) {
    for (const theme of ["dark", "light"]) {
      const context = await browser.newContext({ viewport: { width, height } })
      await context.addInitScript((value) => {
        try {
          if (sessionStorage.getItem("seeded")) return
          sessionStorage.setItem("seeded", "1")
          localStorage.setItem("pi-viewer-theme", value)
          localStorage.removeItem("pi-viewer-palette")
        } catch {}
      }, theme)
      const page = await context.newPage()
      page.setDefaultTimeout(90_000)
      const errors = []
      page.on("console", (message) => message.type() === "error" && errors.push(message.text()))
      page.on("pageerror", (error) => errors.push(String(error)))
      page.on("request", (request) => request.method() === "POST" && errors.push(`unexpected POST ${request.url()}`))
      await page.goto(`${base}/?s=${session}`, { waitUntil: "domcontentloaded" })
      await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "attached" })
      await page.waitForTimeout(2_000)
      const viewport = page.locator('[data-slot="message-scroller-viewport"]')

      const row = { viewport: label, theme, checks: {} }
      const first = await paint(page)
      row.checks.defaultThreads = first.palette === "threads" && matches(first, EXPECT[`threads ${theme}`])
      shots[`${label}-${theme}-threads`] = await page.screenshot({ path: `${out}live-${label}-${theme}-threads.png` })

      let before = first
      for (const palette of ["console", "desktop"]) {
        await viewport.evaluate((node) => (node.scrollTop = Math.round((node.scrollHeight - node.clientHeight) / 2)))
        await page.waitForTimeout(400)
        const top = await viewport.evaluate((node) => node.scrollTop)
        await choose(page, NAME[palette])
        await page.waitForTimeout(300)
        const after = await paint(page)
        row.checks[`${palette}Paint`] = after.palette === palette && matches(after, EXPECT[`${palette} ${theme}`])
        row.checks[`${palette}ScrollKept`] = Math.abs((await viewport.evaluate((node) => node.scrollTop)) - top) <= 2
        row.checks[`${palette}NoOverflow`] = after.overflow <= 0
        if (palette === "desktop" && theme === "light") row.checks.lightFallbackEqualsThreads = matches(after, THREADS_LIGHT)
        if (palette === "desktop") row.seen = { prose: after.prose, muted: after.muted, selected: after.selected, canvas: after.canvas }
        shots[`${label}-${theme}-${palette}`] = await page.screenshot({ path: `${out}live-${label}-${theme}-${palette}.png` })
        before = after
      }
      // The last choice (Desktop) persists across a reload.
      await page.reload({ waitUntil: "domcontentloaded" })
      await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "attached" })
      await page.waitForTimeout(1_500)
      const persisted = await paint(page)
      row.checks.desktopPersisted = persisted.palette === "desktop" && matches(persisted, EXPECT[`desktop ${theme}`])
      row.checks.noOverflowAfterReload = persisted.overflow <= 0
      row.checks.noErrors = errors.length === 0
      row.errors = errors
      row.ok = Object.values(row.checks).every(Boolean)
      if (!row.ok) problems += 1
      rows.push(row)
      await context.close()
    }
  }

  const page = await browser.newPage({ viewport: { width: 3000, height: 1000 } })
  for (const label of ["1440", "390"]) {
    for (const theme of ["dark", "light"]) {
      const w = label === "1440" ? 960 : 390
      const figure = (palette) =>
        `<figure style="margin:0"><figcaption>${NAME[palette]}</figcaption><img style="max-width:${w}px" src="data:image/png;base64,${shots[`${label}-${theme}-${palette}`].toString("base64")}"></figure>`
      await page.setContent(`<body style="margin:0;display:flex;gap:16px;background:#888;padding:16px;align-items:flex-start;font:14px sans-serif">${["threads", "console", "desktop"].map(figure).join("")}</body>`)
      await page.screenshot({ path: `${out}live-side-by-side-${label}-${theme}.png`, fullPage: true })
    }
  }
} finally {
  await browser.close()
}
console.log(JSON.stringify(rows, null, 1))
console.log(problems ? `shots-desktop: ${problems} problem(s)` : "shots-desktop: ok")
process.exit(problems ? 1 : 0)
