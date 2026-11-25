// Live check of XTRM-1047 against the shared viewer. A client only: it never starts a server and sends
// nothing. Usage: node scripts/shots-rows.mjs [baseUrl=http://127.0.0.1:5199] [session=xx]
// For 1440 and 390 wide, dark and light, in Threads and in Console: every action row (user, agent, code
// frame header) is one line (row height = tallest child, no text leaf over 1.6 lines, no overflow); a
// long user message, when the thread has one, shows the fold control left of the meta actions on one
// line and stays one line expanded; the presence pill's edge equals the palette's canvas (when a pill
// shows); 0 console errors; 0px overflow. Writes docs/design/shots/XTRM-1047/live-*.png.
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const [base = "http://127.0.0.1:5199", session = "xx"] = process.argv.slice(2)
const out = fileURLToPath(new URL("../docs/design/shots/XTRM-1047/", import.meta.url))
mkdirSync(out, { recursive: true })

const CANVAS = {
  "threads dark": "rgb(13, 13, 13)", "console dark": "rgb(21, 21, 21)",
  "threads light": "rgb(244, 244, 245)", "console light": "rgb(255, 255, 255)",
}

const measure = (page) =>
  page.evaluate(() => {
    const out = []
    for (const row of document.querySelectorAll("[data-action-row]")) {
      const rect = row.getBoundingClientRect()
      if (!rect.height) continue
      const box = getComputedStyle(row)
      const content = rect.height - parseFloat(box.paddingTop) - parseFloat(box.paddingBottom)
      const kids = Array.from(row.children).map((node) => node.getBoundingClientRect()).filter((r) => r.height > 0)
      const tallest = Math.max(0, ...kids.map((r) => r.height))
      const centres = kids.map((r) => r.top + r.height / 2)
      const tallLeaf = Array.from(row.querySelectorAll("*"))
        .filter((node) => !node.children.length && node.textContent.trim() && node.getBoundingClientRect().height > 0)
        .filter((node) => {
          const style = getComputedStyle(node)
          const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5
          return node.getBoundingClientRect().height / line >= 1.6
        })
        .map((node) => node.textContent.trim().slice(0, 30))
      out.push({
        kind: row.dataset.actionRow,
        oneLine: content <= tallest + 1.5 && (centres.length ? Math.max(...centres) - Math.min(...centres) : 0) <= 3 && !tallLeaf.length && row.scrollWidth - row.clientWidth <= 1,
        tallLeaf,
      })
    }
    return out
  })

const pill = (page) =>
  page.evaluate(() => {
    const mark = document.querySelector("[data-presence-line] span[aria-hidden]")
    return mark ? getComputedStyle(mark).boxShadow : null
  })

async function choose(page, name) {
  await page.getByRole("button", { name: /^Colours:/ }).click()
  await page.getByRole("radiogroup", { name: "Colours" }).getByRole("radio", { name }).click()
  await page.keyboard.press("Escape")
}

const browser = await chromium.launch()
const rows = []
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
      page.on("crash", () => console.error("PAGE CRASH"))
      page.on("close", () => console.error("PAGE CLOSED"))
      page.on("pageerror", (error) => errors.push(String(error)))
      page.on("request", (request) => request.method() === "POST" && errors.push(`unexpected POST ${request.url()}`))
      await page.goto(`${base}/?s=${session}`, { waitUntil: "domcontentloaded" })
      await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "attached" })
      await page.waitForTimeout(2_000)
      const viewport = page.locator('[data-slot="message-scroller-viewport"]')

      const row = { viewport: label, theme, checks: {}, counts: {} }
      for (const palette of ["threads", "console"]) {
        if (palette === "console") await choose(page, "Console")
        // Walk the thread so every virtualised row is laid out, measuring on the way.
        const total = await viewport.evaluate((node) => node.scrollHeight)
        console.error(`${label} ${theme} ${palette} scrollHeight ${total}`)
        const all = []
        for (let y = 0; y <= total; y += Math.max(300, height - 100)) {
          await viewport.evaluate((node, top) => (node.scrollTop = top), y)
          await page.waitForTimeout(120)
          all.push(...(await measure(page)))
        }
        row.counts[palette] = (await measure(page)).length // rows in the page; the walk measures it at each step
        row.checks[`${palette}Rows`] = all.length > 0 && all.every((item) => item.oneLine)
        const bad = all.filter((item) => !item.oneLine)
        if (bad.length) row.bad = bad.slice(0, 3)

        // Fold control: left of the meta actions on one line; one line expanded.
        const fold = page.locator("[data-action-row=user] button[aria-expanded]").first()
        if (await fold.count()) {
          await fold.scrollIntoViewIfNeeded()
          const geo = await page.evaluate(() => {
            const rowEl = document.querySelector("[data-action-row=user]:has(button[aria-expanded])")
            const f = rowEl.querySelector("button[aria-expanded]").getBoundingClientRect()
            const m = rowEl.querySelector(".xtrm-meta").getBoundingClientRect()
            return { left: f.right <= m.left + 0.5, line: Math.abs(f.top - m.top) < 8 }
          })
          row.checks[`${palette}FoldLeftOneLine`] = geo.left && geo.line
          await fold.click()
          await page.waitForTimeout(200)
          row.checks[`${palette}ExpandedOneLine`] = (await measure(page)).every((item) => item.oneLine)
          // Show the row itself: the action row sits at the foot of the expanded message.
          await page.addStyleTag({ content: ".xtrm-meta{opacity:1!important}" })
          await page.evaluate(() => document.querySelector("[data-action-row=user]:has(button[aria-expanded])")?.scrollIntoView({ block: "end" }))
          await page.waitForTimeout(250)
          await page.screenshot({ path: `${out}live-${label}-${theme}-${palette}-expanded.png` })
          await page.locator("[data-action-row=user] button[aria-expanded]").first().click()
          await page.waitForTimeout(150)
        } else {
          row.checks[`${palette}Fold`] = "no long user message in this thread"
        }
        // Reveal the quiet meta rows for the shot (layout is identical either way).
        await page.addStyleTag({ content: ".xtrm-meta{opacity:1!important}" })
        const userRow = page.locator("[data-action-row=user]").first()
        if (await userRow.count()) await userRow.scrollIntoViewIfNeeded()
        await page.waitForTimeout(150)
        await page.screenshot({ path: `${out}live-${label}-${theme}-${palette}.png` })

        const shadow = await pill(page)
        row.checks[`${palette}Pill`] = shadow === null ? "no pill showing" : shadow.includes(`${CANVAS[`${palette} ${theme}`]} 0px 0px 0px 2px`)
      }
      row.checks.noOverflow = (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) === 0
      row.checks.noErrors = errors.length === 0
      if (errors.length) row.errors = errors.slice(0, 3)
      for (const value of Object.values(row.checks)) if (value === false) problems += 1
      rows.push(row)
      await context.close()
    }
  }
} finally {
  await browser.close()
}
console.log(JSON.stringify(rows, null, 2))
console.log(problems ? `shots-rows: ${problems} problem(s)` : "shots-rows: ok")
process.exit(problems ? 1 : 0)
