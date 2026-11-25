// Live width check against the shared viewer (XTRM-1042). A client only: it never starts a server.
// Usage: node scripts/shots-width.mjs [baseUrl=http://127.0.0.1:5199] [session=xx]
// For 1440, 1920 and 390 wide, dark and light, each preset and one custom value: measures the thread
// text column, the composer and the presence line, counts console errors and horizontal overflow,
// and writes docs/design/shots/XTRM-1042/<viewport>-<theme>-<preset>.png.
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const [base = "http://127.0.0.1:5199", session = "xx"] = process.argv.slice(2)
const out = fileURLToPath(new URL("../docs/design/shots/XTRM-1042/", import.meta.url))
mkdirSync(out, { recursive: true })

const viewports = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1920", width: 1920, height: 1000 },
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
    await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "attached" })
    await page.waitForTimeout(1_500)

    const measure = () =>
      page.evaluate(() => {
        const content = document.querySelector('[data-slot="message-scroller-content"]')
        const padding = parseFloat(getComputedStyle(content).paddingLeft) * 2
        const composer = document.querySelector("textarea").closest(".xtrm-lane")
        const presence = document.querySelector('[role="listbox"], [data-presence]')?.closest(".xtrm-lane")
        const control = document.querySelector('button[aria-label^="Chat width"]')
        return {
          lane: getComputedStyle(document.documentElement).getPropertyValue("--chat-lane").trim(),
          thread: Math.round(content.getBoundingClientRect().width - padding),
          composer: Math.round(composer.getBoundingClientRect().width),
          presence: presence ? Math.round(presence.getBoundingClientRect().width) : null,
          controlVisible: control ? getComputedStyle(control).display !== "none" : false,
          overflow: document.documentElement.scrollWidth - window.innerWidth,
        }
      })

    const steps = viewport.width >= 640 ? ["Comfortable", "Wide", "Full", "custom"] : ["Comfortable"]
    for (const step of steps) {
      if (viewport.width >= 640) {
        await page.getByRole("button", { name: /Chat width/ }).click()
        if (step === "custom") {
          const slider = page.getByRole("slider", { name: /Custom chat width/ })
          await slider.focus()
          await slider.press("ArrowRight")
          await slider.press("ArrowRight")
          await slider.press("ArrowRight")
        } else {
          await page.getByRole("radio", { name: new RegExp(step) }).click()
        }
        await page.waitForTimeout(500)
      }
      const shot = `${out}${viewport.name}-${theme}-${step.toLowerCase()}`
      await page.screenshot({ path: `${shot}.png` })
      const m = await measure()
      if (viewport.width >= 640) await page.keyboard.press("Escape")
      const hiddenOk = viewport.width >= 640 ? m.controlVisible : !m.controlVisible
      const alignOk = Math.abs(m.thread - m.composer) <= 16 && (m.presence === null || Math.abs(m.presence - m.composer) <= 1)
      const bad = errors.length > 0 || m.overflow > 0 || !hiddenOk || !alignOk
      if (bad) problems += 1
      console.log(`${bad ? "FAIL" : "ok  "} ${viewport.name} ${theme} ${step.padEnd(11)} lane=${m.lane} thread=${m.thread} composer=${m.composer} presence=${m.presence} control=${m.controlVisible} overflow=${m.overflow} errors=${errors.length}`)
    }
    for (const error of errors) console.log(`   ${error.slice(0, 200)}`)
    await context.close()
  }
}
await browser.close()
process.exit(problems ? 1 : 0)
