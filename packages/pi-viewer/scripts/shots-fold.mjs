// Minimal live fold check against the shared viewer (XTRM-1055). A client only: it never starts a server and
// sends nothing. Usage: node scripts/shots-fold.mjs [baseUrl=http://127.0.0.1:5199] [session=xx] [pane=%14]
// PANE scope keeps the thread small. Two combinations, one browser, a hard 90-second limit each:
//   Threads dark at 1440, and Console light at 390.
// Per combination: the first folded user bubble and the first folded intercom card each carry their fold control
// inside the box ("Show more"), the fade is a mask that ends fully transparent, no intercom card shows a message
// id or a runtime word outside its body, 0 console errors, 0px overflow. One screenshot of a folded user bubble
// and one of a folded intercom card per combination: docs/design/shots/XTRM-1055/live-*.png.
import { mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const [base = "http://127.0.0.1:5199", session = "xx", pane = "%14"] = process.argv.slice(2)
const out = fileURLToPath(new URL("../docs/design/shots/XTRM-1055/", import.meta.url))
mkdirSync(out, { recursive: true })

const COMBOS = [
  { label: "1440-dark-threads", width: 1440, height: 900, theme: "dark", palette: "threads" },
  { label: "390-light-console", width: 390, height: 844, theme: "light", palette: "console" },
]

const inspect = (page) =>
  page.evaluate(() => {
    const kinds = {}
    for (const host of document.querySelectorAll("[data-fold-host]")) {
      const fold = host.querySelector("[data-fold]")
      if (!fold) continue
      const box = host.getBoundingClientRect()
      const f = fold.getBoundingClientRect()
      const pad = getComputedStyle(host)
      const kind = host.dataset.foldHost
      if (kinds[kind]) { kinds[kind].count += 1; continue }
      const faded = host.querySelector(".xtrm-fold-fade")
      const mask = faded ? getComputedStyle(faded).maskImage || getComputedStyle(faded).webkitMaskImage : null
      kinds[kind] = {
        count: 1,
        word: fold.textContent.trim(),
        inside: f.left >= box.left + parseFloat(pad.paddingLeft) - 0.5 && f.right <= box.right - parseFloat(pad.paddingRight) + 0.5 && f.top >= box.top && f.bottom <= box.bottom - parseFloat(pad.paddingBottom) + 0.5,
        fadeMask: Boolean(mask && mask !== "none"),
        fadeEndsTransparent: Boolean(mask && /rgba\(0, 0, 0, 0\)\s*(100%)?\)?$|transparent\s*\)?$/.test(mask.trim().replace(/\s+/g, " "))) || Boolean(mask && /rgba\(0, 0, 0, 0\)/.test(mask)),
      }
    }
    // Outside a card's message body, no leaf reads as a message id (8 or more hex characters) or a runtime word.
    const cards = [...document.querySelectorAll("[data-slot=intercom-card]")]
    let bad = 0
    for (const card of cards) {
      for (const node of card.querySelectorAll("*")) {
        if (node.closest("[data-slot=intercom-body]") || node.children.length) continue
        const text = node.textContent.trim()
        if (/^[0-9a-f]{8,}$/i.test(text) || /^(pi|claude)$/i.test(text)) bad += 1
      }
    }
    return { kinds, cards: cards.length, keyOrRuntime: bad, overflow: document.documentElement.scrollWidth - window.innerWidth }
  })

const browser = await chromium.launch()
const results = []
let problems = 0
async function bail(reason) {
  console.error(`shots-fold: ${reason}`)
  await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 5_000))])
  process.exit(2)
}
try {
  for (const combo of COMBOS) {
    const timer = setTimeout(() => void bail(`TIMEOUT after 90s in ${combo.label}; stopping, no retry`), 90_000)
    const context = await browser.newContext({ viewport: { width: combo.width, height: combo.height } })
    await context.addInitScript(({ theme, palette }) => {
      try {
        localStorage.setItem("pi-viewer-theme", theme)
        localStorage.setItem("pi-viewer-palette", palette)
      } catch {}
    }, combo)
    const page = await context.newPage()
    page.setDefaultTimeout(60_000)
    const errors = []
    page.on("console", (message) => message.type() === "error" && errors.push(message.text()))
    page.on("pageerror", (error) => errors.push(String(error)))
    page.on("request", (request) => request.method() === "POST" && errors.push(`unexpected POST ${request.url()}`))
    await page.goto(`${base}/?s=${session}&p=${encodeURIComponent(pane)}`, { waitUntil: "domcontentloaded" })
    await page.locator('[data-slot="message-scroller-item"]').first().waitFor({ state: "attached" })
    await page.waitForTimeout(1_500)
    const viewport = page.locator('[data-slot="message-scroller-viewport"]')

    // Walk the (pane) thread once so folded rows are laid out.
    const total = await viewport.evaluate((node) => node.scrollHeight)
    for (let y = 0; y <= total; y += Math.max(400, combo.height - 100)) {
      await viewport.evaluate((node, top) => (node.scrollTop = top), y)
      await page.waitForTimeout(80)
    }
    const seen = await inspect(page)
    const checks = {}
    for (const kind of ["user", "intercom"]) {
      const entry = seen.kinds[kind]
      checks[`${kind}FoldPresent`] = Boolean(entry)
      if (!entry) continue
      checks[`${kind}FoldInside`] = entry.inside
      checks[`${kind}Wording`] = entry.word === "Show more"
      checks[`${kind}FadeMask`] = entry.fadeMask && entry.fadeEndsTransparent
      const host = page.locator(`[data-fold-host=${kind}]:has([data-fold])`).first()
      await host.evaluate((node) => node.scrollIntoView({ block: "center" }))
      await page.waitForTimeout(250)
      await page.screenshot({ path: `${out}live-${combo.label}-${kind}.png` })
    }
    checks.noKeyOrRuntimeInCards = seen.keyOrRuntime === 0
    checks.noOverflow = seen.overflow <= 0
    checks.noErrors = errors.length === 0
    if (Object.values(checks).some((value) => value === false)) problems += 1
    results.push({ combo: combo.label, cards: seen.cards, folds: Object.fromEntries(Object.entries(seen.kinds).map(([k, v]) => [k, v.count])), checks, errors })
    await context.close()
    clearTimeout(timer)
  }
} finally {
  await browser.close()
}
console.log(JSON.stringify(results, null, 1))
console.log(problems ? `shots-fold: ${problems} problem(s)` : "shots-fold: ok")
process.exit(problems ? 1 : 0)
