import { chromium } from "playwright"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()) })
await page.goto(`${process.env.PI_VIEWER_URL ?? "http://127.0.0.1:5299"}/`, { waitUntil: "networkidle" })
await page.waitForSelector('[data-slot="message-scroller-content"]')
await page.waitForTimeout(2500)

const sessions = (await (await fetch(`${process.env.PI_VIEWER_URL ?? "http://127.0.0.1:5299"}/api/sessions`)).json()).sessions
const session = sessions.find((item) => item.name === "xx") ?? sessions[0]
const agents = session.agents
const heavy = [...agents].sort((a, b) => b.eventCount - a.eventCount)
const target = heavy[0] ?? agents[0]
const next = heavy[1] ?? agents[0]

await page.evaluate((url) => {
  history.pushState(null, "", url)
  dispatchEvent(new PopStateEvent("popstate"))
}, `/?s=${encodeURIComponent(session.name)}&w=${encodeURIComponent(target.windowId)}&p=${encodeURIComponent(target.paneId)}`)
await page.waitForFunction(
  (name) => document.querySelector('[data-testid="scope-title"]')?.textContent === name,
  target.name,
  { timeout: 10_000 },
)
await page.waitForTimeout(900)

const base = await page.evaluate(() => (window).__turnRenders ?? 0)
await page.waitForTimeout(4500)
const idleRenders = await page.evaluate((base) => ((window).__turnRenders ?? 0) - base, base)

await page.evaluate(() => {
  const w = window
  w.__turnRenders = 0
})
const url = `/?s=${encodeURIComponent(session.name)}&w=${encodeURIComponent(next.windowId)}&p=${encodeURIComponent(next.paneId)}`
const started = Date.now()
await page.evaluate((url) => {
  history.pushState(null, "", url)
  dispatchEvent(new PopStateEvent("popstate"))
}, url)
await page.waitForFunction(
  (name) => document.querySelector('[data-testid="scope-title"]')?.textContent === name,
  next.name,
  { timeout: 10_000 },
)
const switchMs = Date.now() - started
await page.waitForTimeout(800)
const switchRenders = await page.evaluate(() => (window).__turnRenders ?? 0)
console.log(JSON.stringify({ session: session.name, target: target.name, next: next.name, turns: agents.length, idleRenders, switchMs, switchRenders, errors }, null, 2))
await browser.close()
