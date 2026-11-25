// Live Reply check against the shared viewer (XTRM-1045). A client only: it never starts a
// server and never sends a prompt (it types a draft, then clears it).
// Usage: node scripts/shots-reply.mjs [baseUrl=http://127.0.0.1:5199] [session=xx]
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const [base = "http://127.0.0.1:5199", session = "xx"] = process.argv.slice(2)
const out = fileURLToPath(new URL("../docs/design/shots/XTRM-1045/", import.meta.url))
mkdirSync(out, { recursive: true })

const browser = await chromium.launch()
let problems = 0
const results = []
for (const [name, width, height] of [["1440", 1440, 900], ["390", 390, 844]]) {
  for (const theme of ["dark", "light"]) {
    const context = await browser.newContext({ viewport: { width, height } })
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
    page.on("request", (request) => {
      if (request.method() === "POST") errors.push(`unexpected POST ${request.url()}`)
    })
    await page.goto(`${base}/?s=${session}`, { waitUntil: "domcontentloaded" })
    await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "attached" })
    await page.waitForTimeout(2_000)

    const reply = page.locator('button[aria-label^="Reply to"]').last()
    await reply.waitFor({ state: "attached" })
    await reply.scrollIntoViewIfNeeded()
    const label = await reply.getAttribute("aria-label")
    const agent = label.replace("Reply to ", "")
    const placement = await reply.evaluate((node) => {
      const copy = node.nextElementSibling
      return {
        copyLabel: copy?.getAttribute("aria-label") ?? null,
        left: node.getBoundingClientRect().right <= (copy?.getBoundingClientRect().left ?? 0) + 0.5,
        title: node.getAttribute("title"),
      }
    })
    const input = page.locator("[data-composer-input]")
    await input.fill("")
    await input.fill("draft kept")
    await reply.click({ force: true })
    await page.waitForTimeout(300)
    const after = await page.evaluate(() => ({
      focused: document.activeElement?.hasAttribute("data-composer-input") ?? false,
      draft: document.querySelector("[data-composer-input]").value,
      bar: document.querySelector("[data-reply-bar]")?.textContent ?? null,
      to: document.querySelector("[data-composer-under-row] button")?.textContent ?? null,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
    }))
    await page.screenshot({ path: `${out}live-${name}-${theme}.png` })
    await page.locator('button[aria-label="Cancel reply"]').click()
    const cleared = (await page.locator("[data-reply-bar]").count()) === 0
    await input.fill("")
    const row = {
      viewport: name,
      theme,
      agent,
      placement,
      ...after,
      cleared,
      errors,
    }
    const ok =
      placement.copyLabel === "Copy reply" &&
      placement.left &&
      after.focused &&
      after.draft === "draft kept" &&
      after.bar?.includes(agent) &&
      after.to?.includes(agent) &&
      after.overflow <= 0 &&
      cleared &&
      errors.length === 0
    if (!ok) problems += 1
    results.push({ ok, ...row })
    await context.close()
  }
}
console.log(JSON.stringify(results, null, 1))
await browser.close()
process.exit(problems ? 1 : 0)
