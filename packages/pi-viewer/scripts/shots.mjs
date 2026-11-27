// Live screenshot check against the shared viewer (XTRM-1034). A client only: it never starts a server.
// Usage: node scripts/shots.mjs <label> [baseUrl=http://127.0.0.1:5199] [session=xx]
// Writes docs/design/shots/XTRM-1034/<label>-<viewport>-<theme>[-folded].png and prints console errors and overflow.
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const [label = "after", base = "http://127.0.0.1:5199", session = "xx"] = process.argv.slice(2)
const out = fileURLToPath(new URL("../docs/design/shots/XTRM-1034/", import.meta.url))
mkdirSync(out, { recursive: true })

const viewports = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
]
const browser = await chromium.launch()
let problems = 0
for (const viewport of viewports) {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
    await context.addInitScript((value) => {
      try {
        localStorage.setItem("pi-viewer-theme", value)
      } catch {}
    }, theme)
    const page = await context.newPage()
    page.setDefaultTimeout(90_000)
    const errors = []
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()))
    page.on("pageerror", (error) => errors.push(String(error)))
    await page.goto(`${base}/?s=${session}`, { waitUntil: "domcontentloaded" })
    await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {})
    await page.waitForTimeout(1_200)
    // The end of the thread: where the newest operator message, its delivery state and the pill live.
    await page.evaluate(() => {
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
      if (viewport) viewport.scrollTop = viewport.scrollHeight
    })
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${out}${label}-${viewport.name}-${theme}-end.png` })
    await page.evaluate(() => {
      const viewport = document.querySelector('[data-slot="message-scroller-viewport"]')
      if (viewport) viewport.scrollTop = 0
    })
    await page.waitForTimeout(400)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    const file = `${out}${label}-${viewport.name}-${theme}.png`
    await page.screenshot({ path: file })
    // Open the first turn fold so the tool rows show.
    const fold = page.locator("button[aria-expanded=false]:has-text('Worked for'), button[aria-expanded=false]:has-text('step')").first()
    if (await fold.count()) {
      // The scroll pill can sit over the row; a dispatched click does not need a clear hit target.
      await fold.dispatchEvent("click", {}, { timeout: 5_000 }).catch(() => {})
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${out}${label}-${viewport.name}-${theme}-folded.png` })
    }
    const bad = errors.length > 0 || overflow > 0
    if (bad) problems += 1
    console.log(`${bad ? "FAIL" : "ok  "} ${viewport.name} ${theme}: console errors ${errors.length}, horizontal overflow ${overflow}px`)
    for (const error of errors) console.log(`   ${error.slice(0, 200)}`)
    await context.close()
  }
}
await browser.close()
process.exit(problems ? 1 : 0)
