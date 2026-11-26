// XTRM-1057: the sidebar pane row's second line is text-xs and ink-muted, so a pane row is 48px.
// Captures the sidebar in both themes and measures what the class change produced.
//
//   PI_VIEWER_URL=http://127.0.0.1:5299/ node scripts/shots-sidebar-line2.mjs [out-dir]
//
// A client only, like scripts/sidebar-gate.mjs: it never starts a server, reads a running viewer
// (the shared :5199, or a private one) and never sends a prompt.
import { chromium } from "playwright"
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"

const BASE = process.env.PI_VIEWER_URL || "http://127.0.0.1:5199/"
const out = process.argv[2] || fileURLToPath(new URL("../docs/design/shots/XTRM-1057/", import.meta.url))
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const report = []
try {
  for (const theme of ["dark", "light"]) for (const [w, h] of [[1440, 900], [390, 844]]) {
    const narrow = w < 768
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
    await ctx.addInitScript((t) => {
      if (sessionStorage.getItem("s")) return
      localStorage.setItem("pi-viewer-theme", t)
      localStorage.removeItem("pi-viewer-sidebar")
      sessionStorage.setItem("s", "1")
    }, theme)
    const page = await ctx.newPage()
    page.setDefaultTimeout(60000)
    const errs = []
    page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(m.text().slice(0, 160)) })
    page.on("pageerror", (e) => errs.push("pageerror " + e.message))
    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 })
    await page.waitForSelector('[data-testid="top-bar"]', { timeout: 60000 })
    if (narrow) {
      await page.getByRole("button", { name: "Open sidebar" }).click()
      await page.waitForTimeout(300)
    }
    await page.waitForSelector("[role=treeitem]", { state: "attached", timeout: 90000 })
    await page.waitForSelector("[data-testid=pane-row-line2]", { timeout: 60000 })
    await page.waitForTimeout(1500)
    const m = await page.evaluate(() => {
      const line2 = document.querySelector("[data-testid=pane-row-line2]")
      const row = line2.closest('[role="treeitem"]')
      const cs = (el) => getComputedStyle(el)
      const side = document.querySelector("[data-testid=sidebar]")
      return {
        size: cs(line2).fontSize,
        lineHeight: cs(line2).lineHeight,
        colour: cs(line2).color,
        sidebar: cs(side).backgroundColor,
        paneRow: Math.round(row.getBoundingClientRect().height * 10) / 10,
      }
    })
    const shot = `${out}sidebar-line2-${w}-${theme}.png`
    await page.locator("[data-testid=sidebar]").screenshot({ path: shot })
    report.push({ w, theme, ...m, errors: errs, shot })
    await ctx.close()
  }
} finally {
  await browser.close()
}
let bad = 0
for (const r of report) {
  if (r.size !== "11.52px" || r.lineHeight !== "16px" || r.paneRow !== 48 || r.errors.length) bad++
  console.log(`${r.w} ${r.theme}: line 2 ${r.size}/${r.lineHeight} ${r.colour} on ${r.sidebar}, pane row ${r.paneRow}px, ${r.errors.length} console messages`)
}
console.log(`${report.length - bad}/${report.length} viewports: line 2 11.52px/16px, pane row 48px, no console errors`)
process.exit(bad ? 1 : 0)
