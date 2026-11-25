// Live palette check against the shared viewer (XTRM-1046). A client only: it never starts a server
// and sends nothing. Usage: node scripts/shots-palette.mjs [baseUrl=http://127.0.0.1:5199] [session=xx]
// For 1440 and 390 wide, dark and light: the default is Threads; the canvas, sidebar (1440) and composer
// wear the values of docs/design/palette-console.md in each palette; the switch through the header control
// leaves the scroll position alone and survives a reload; 0 console errors; 0px overflow. Writes
// docs/design/shots/XTRM-1046/live-*.png and a side-by-side per viewport and theme.
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const [base = "http://127.0.0.1:5199", session = "xx"] = process.argv.slice(2)
const out = fileURLToPath(new URL("../docs/design/shots/XTRM-1046/", import.meta.url))
mkdirSync(out, { recursive: true })

const EXPECT = {
  "threads dark": { canvas: "rgb(13, 13, 13)", sidebar: "rgb(24, 24, 24)", composer: "rgb(21, 21, 21)", edge: false },
  "console dark": { canvas: "rgb(21, 21, 21)", sidebar: "rgb(35, 35, 35)", composer: "rgb(21, 21, 21)", edge: true },
  "threads light": { canvas: "rgb(244, 244, 245)", sidebar: "rgb(244, 244, 245)", composer: "rgb(255, 255, 255)", edge: false },
  "console light": { canvas: "rgb(255, 255, 255)", sidebar: "rgb(244, 244, 245)", composer: "rgb(255, 255, 255)", edge: true },
}
const paint = (page) =>
  page.evaluate(() => {
    const bg = (node) => (node ? getComputedStyle(node).backgroundColor : null)
    const box = document.querySelector(".xtrm-composer-box")
    const sidebar = document.querySelector('[data-testid="sidebar"]')
    return {
      palette: document.documentElement.dataset.palette,
      canvas: bg(box.closest(".bg-canvas")),
      body: bg(document.body),
      sidebar: sidebar && sidebar.getBoundingClientRect().width > 0 ? bg(sidebar) : null,
      composer: bg(box),
      edge: !/rgba\(0, 0, 0, 0\) 0px 0px 0px 1px inset/.test(getComputedStyle(box).boxShadow),
      sidebarBorder: sidebar ? getComputedStyle(sidebar).borderRightWidth : null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }
  })
async function choose(page, name) {
  await page.getByRole("button", { name: /^Colours:/ }).click()
  await page.getByRole("radiogroup", { name: "Colours" }).getByRole("radio", { name }).click()
  await page.keyboard.press("Escape")
}

const browser = await chromium.launch()
const rows = []
const shots = {}
let problems = 0
for (const [width, height, label] of [[1440, 900, "1440"], [390, 844, "390"]]) {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width, height } })
    await context.addInitScript((value) => {
      try {
        // Seed once: the init script runs again on a reload, which must keep the chosen palette.
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

    const row = { viewport: label, theme, checks: {} }
    const before = await paint(page)
    const t = EXPECT[`threads ${theme}`]
    row.checks.defaultThreads = before.palette === "threads"
    row.checks.threadsPaint = before.canvas === t.canvas && before.composer === t.composer && (before.sidebar === null || before.sidebar === t.sidebar) && !before.edge
    shots[`${label}-${theme}-threads`] = await page.screenshot({ path: `${out}live-${label}-${theme}-threads.png` })

    const viewport = page.locator('[data-slot="message-scroller-viewport"]')
    await viewport.evaluate((node) => (node.scrollTop = Math.round((node.scrollHeight - node.clientHeight) / 2)))
    await page.waitForTimeout(400)
    const top = await viewport.evaluate((node) => node.scrollTop)
    await choose(page, "Console")
    await page.waitForTimeout(300)
    const after = await paint(page)
    const c = EXPECT[`console ${theme}`]
    row.checks.consolePaint = after.palette === "console" && after.canvas === c.canvas && after.body === c.canvas && after.composer === c.composer && (after.sidebar === null || after.sidebar === c.sidebar) && after.edge
    row.checks.scrollKept = Math.abs((await viewport.evaluate((node) => node.scrollTop)) - top) <= 2
    row.checks.sidebarBorder0 = (after.sidebarBorder ?? "0px") === "0px" && (before.sidebarBorder ?? "0px") === "0px"
    shots[`${label}-${theme}-console`] = await page.screenshot({ path: `${out}live-${label}-${theme}-console.png` })

    await page.reload({ waitUntil: "domcontentloaded" })
    await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "attached" })
    await page.waitForTimeout(1_500)
    const persisted = await paint(page)
    row.checks.persisted = persisted.palette === "console"
    row.checks.noOverflow = before.overflow <= 0 && after.overflow <= 0 && persisted.overflow <= 0
    row.checks.noErrors = errors.length === 0
    row.errors = errors
    row.ok = Object.values(row.checks).every(Boolean)
    if (!row.ok) problems += 1
    rows.push(row)
    await context.close()
  }
}

const page = await browser.newPage({ viewport: { width: 2000, height: 1000 } })
for (const label of ["1440", "390"]) {
  for (const theme of ["dark", "light"]) {
    const a = shots[`${label}-${theme}-threads`].toString("base64")
    const b = shots[`${label}-${theme}-console`].toString("base64")
    const w = label === "1440" ? 960 : 390
    await page.setContent(`<body style="margin:0;display:flex;gap:16px;background:#888;padding:16px;align-items:flex-start;font:14px sans-serif"><figure style="margin:0"><figcaption>Threads</figcaption><img style="max-width:${w}px" src="data:image/png;base64,${a}"></figure><figure style="margin:0"><figcaption>Console</figcaption><img style="max-width:${w}px" src="data:image/png;base64,${b}"></figure></body>`)
    await page.screenshot({ path: `${out}live-side-by-side-${label}-${theme}.png`, fullPage: true })
  }
}
console.log(JSON.stringify(rows, null, 1))
await browser.close()
process.exit(problems ? 1 : 0)
