// Cold-load measurement (XTRM-1067): requests, encoded bytes and time to the first thread paint.
//
// It measures whatever server it is given, so the same numbers can be taken from the dev server and
// from a production `vite preview`:
//   node scripts/load-check.mjs http://127.0.0.1:5296
// A cold load is a fresh browser context with an empty cache, one navigation, no reload.
import { chromium } from "playwright"

const url = process.argv[2] ?? "http://127.0.0.1:5199"
const label = process.argv[3] ?? url

const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const client = await context.newCDPSession(page)
  await client.send("Network.enable")

  const requests = new Map()
  let bytes = 0
  client.on("Network.requestWillBeSent", (event) => requests.set(event.requestId, event.request.url))
  client.on("Network.loadingFinished", (event) => {
    bytes += event.encodedDataLength
  })

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 })
  await page.waitForSelector('[role=treeitem]', { state: "attached", timeout: 90_000 })
  // The first thread paint is a rendered message in the channel, not the sidebar skeleton.
  await page.waitForSelector('[data-action-row], [data-fold-host]', { state: "attached", timeout: 90_000 })
  const paintMs = await page.evaluate(() => performance.now())
  // Let the quiet tail of the load settle so the byte count is not read mid-flight.
  await page.waitForTimeout(1500)

  const resources = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.startsWith(location.origin))
      .map((entry) => ({ name: entry.name.replace(location.origin, ""), transfer: entry.transferSize ?? 0, type: entry.initiatorType })),
  )
  const js = resources.filter((entry) => entry.name.endsWith(".js"))
  const fonts = resources.filter((entry) => /\.(woff2?|ttf)$/.test(entry.name))
  const sum = (list) => list.reduce((total, entry) => total + entry.transfer, 0)

  console.log(`# ${label}`)
  console.log(`requests        ${resources.length}`)
  console.log(`bytes (encoded) ${bytes} (CDP) / ${sum(resources)} (resource timing)`)
  console.log(`js              ${js.length} requests, ${sum(js)} bytes`)
  console.log(`fonts           ${fonts.length} requests, ${sum(fonts)} bytes`)
  console.log(`first paint     ${Math.round(paintMs)} ms to the first message bubble`)
} finally {
  await browser.close()
}
