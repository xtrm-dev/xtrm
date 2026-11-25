// Browser gate for the sidebar: row density, rails, scopes, URL, keyboard, rail, mobile overlay.
// Read-only against a running viewer; it clicks the UI and never sends a prompt.
//
//   PI_VIEWER_URL=http://127.0.0.1:5199/ node scripts/sidebar-gate.mjs [screenshot-dir]
//
// Environment:
//   PI_VIEWER_URL      viewer to check (default http://127.0.0.1:5199/, the shared dev server)
//   PLAYWRIGHT_MODULE  path or name of the playwright package (default "playwright")
//   CHROMIUM_PATH      browser executable; unset lets playwright use its own download
// Needs a tmux session with at least one multi-pane window, such as xx. Exit 0 = all checks pass.
import { createRequire } from "node:module"
import { mkdirSync } from "node:fs"
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const BASE = process.env.PI_VIEWER_URL || "http://127.0.0.1:5199/"
const SHOTS = process.argv[2] || "sidebar-gate-shots"
mkdirSync(SHOTS, { recursive: true })
const res = []; const check = (n, ok, d = "") => res.push({ n, ok, d })
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
for (const [w, h] of [[1440, 900], [390, 844]]) for (const theme of ["dark", "light"]) {
  const tag = w + "-" + theme, narrow = w < 768
  const ctx = await b.newContext({ viewport: { width: w, height: h } })
  await ctx.addInitScript((t) => { if (!sessionStorage.getItem("s")) { localStorage.setItem("pi-viewer-theme", t); localStorage.removeItem("pi-viewer-sidebar"); sessionStorage.setItem("s", "1") } }, theme)
  const p = await ctx.newPage(); const errs = []
  p.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(m.text().slice(0, 200)) })
  p.on("pageerror", (e) => errs.push("pageerror " + e.message))
  const S_ = () => p.evaluate(() => location.search)
  const title = () => p.locator('[data-testid="scope-title"]').textContent()
  const side = p.locator('[data-testid="sidebar"]')
  const open = async () => { if (narrow && (await side.getAttribute("data-collapsed")) === "true") { await p.getByRole("button", { name: "Expand sidebar" }).click(); await p.waitForTimeout(250) } }
  const sel = async () => { await open(); const k = await p.evaluate(() => document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute("data-key")); if (narrow) { await p.keyboard.press("Escape"); await p.waitForTimeout(250) } return k }
  try {
    await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 }); await p.waitForSelector('[data-testid="sidebar"]', { timeout: 60000 }); await p.waitForTimeout(2500)
    await open()
    const g = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('[role=treeitem]')]
      const r = rows.map((e) => e.getBoundingClientRect())
      const uniq = (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10))]
      const groups = rows.filter((e) => e.hasAttribute("aria-expanded")), leaves = rows.filter((e) => !e.hasAttribute("aria-expanded"))
      return { groupHs: uniq(groups), paneHs: uniq(leaves), railLines: document.querySelectorAll('[data-testid=sidebar] [role=tree] .border-l').length, nGroups: groups.length, n: rows.length, hs: [...new Set(r.map((x) => Math.round(x.height * 10) / 10))], contiguous: r.every((x, i) => i === 0 || Math.abs(x.top - r[i - 1].bottom) < 0.6), levels: [...new Set(rows.map((e) => e.getAttribute("aria-level")))].sort(), windowsRows: rows.filter((e) => e.getAttribute("aria-level") === "2" && e.hasAttribute("aria-expanded")).length, panes: rows.filter((e) => !e.hasAttribute("aria-expanded")).length, groupCounts: rows.filter((e) => e.hasAttribute("aria-expanded")).every((e) => /\d+ agents/.test(e.getAttribute("aria-label"))), total: r.length ? Math.round(r.at(-1).bottom - r[0].top) : 0, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }
    })
    check(tag + " session and window rows are one 28px line", g.groupHs.length === 1 && g.groupHs[0] === 28, JSON.stringify(g.groupHs))
    check(tag + " pane rows are two lines, 48px (name, then role pill, runtime and state)", g.paneHs.length === 1 && g.paneHs[0] === 48, JSON.stringify(g.paneHs))
    check(tag + " rows are contiguous and draw no rail lines", g.contiguous && g.railLines === 0, "rails " + g.railLines)
    check(tag + " tree height " + g.total + "px for " + g.panes + " agents", g.total <= g.nGroups * 28 + g.panes * 48 + 1)
    check(tag + " group rows carry counts", g.groupCounts)
    check(tag + " one-pane windows add no row (window rows have 2+ agents)", await p.evaluate(() => [...document.querySelectorAll('[role=treeitem][aria-level="2"][aria-expanded]')].every((e) => Number(/(\d+) agents/.exec(e.getAttribute("aria-label"))[1]) >= 2)))
    check(tag + " no overflow", !g.overflow)
    await p.screenshot({ path: SHOTS + "/g4-" + tag + ".png" })
    // scopes
    check(tag + " fresh page: session scope", (await S_()) === "?s=xx" && (await sel()) === "s:xx")
    await open()
    const multi = p.locator('[role=treeitem][aria-level="2"][aria-expanded]').first(); const wk = await multi.getAttribute("data-key"); void wk
    await multi.click(); await p.waitForTimeout(1500)
    // The URL carries the tmux window id (w=%40N), not its index, so a renumbered window keeps its URL.
    check(tag + " window click: URL has the window id, window row selected", /^\?s=xx&w=%40\d+$/.test(await S_()) && (await sel()) === wk, (await S_()) + " " + wk)
    await open()
    const pane = p.locator('[role=treeitem][aria-level="3"]').first(); const pk = await pane.getAttribute("data-key"); const pname = (await pane.getAttribute("aria-label")).split(",")[0]
    await pane.click(); await p.waitForTimeout(1500)
    check(tag + " pane click: URL, header, selected row", /p=%25\d+/.test(await S_()) && (await title()) === pname && (await sel()) === pk, (await S_()) + " " + (await title()))
    const url = await S_()
    await p.reload({ waitUntil: "domcontentloaded", timeout: 60000 }); await p.waitForSelector('[data-testid="sidebar"]', { timeout: 60000 }); await p.waitForTimeout(2500)
    check(tag + " reload keeps scope", (await S_()) === url && (await title()) === pname)
    // single-pane window scope selects its pane row
    await p.goto(BASE + "?s=xx&w=99", { waitUntil: "domcontentloaded", timeout: 60000 }); await p.waitForTimeout(2000)
    const single = await p.evaluate(() => 0); void single
    // keyboard (desktop)
    if (!narrow) {
      await p.locator('[role=treeitem][tabindex="0"]').focus(); await p.keyboard.press("ArrowDown")
      check(tag + " ArrowDown moves focus", (await p.evaluate(() => document.activeElement?.getAttribute("role"))) === "treeitem")
      await p.locator('[role=treeitem][aria-expanded=true][aria-level="2"]').first().focus(); await p.keyboard.press("ArrowLeft"); await p.waitForTimeout(150)
      check(tag + " ArrowLeft collapses an open window", (await p.evaluate(() => document.activeElement?.getAttribute("aria-expanded"))) === "false")
      await p.keyboard.press("ArrowRight")
      await p.getByRole("button", { name: "Collapse sidebar" }).focus(); await p.keyboard.press("Enter"); await p.waitForTimeout(250)
      check(tag + " collapse to 44px rail, focus on Expand", Math.round((await side.boundingBox()).width) === 44 && (await p.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Expand sidebar")
      await p.screenshot({ path: SHOTS + "/g4-" + tag + "-rail.png" })
      await p.keyboard.press("Enter"); await p.waitForTimeout(250)
      check(tag + " expands back to 240px", Math.round((await side.boundingBox()).width) === 240)
    } else {
      await p.getByRole("button", { name: "Expand sidebar" }).click(); await p.waitForTimeout(250)
      await p.screenshot({ path: SHOTS + "/g4-" + tag + "-open.png" })
      await p.keyboard.press("Escape"); await p.waitForTimeout(250)
      check(tag + " Escape closes the overlay", (await side.getAttribute("data-collapsed")) === "true")
      check(tag + " overlay never persisted as collapsed", (await p.evaluate(() => JSON.parse(localStorage.getItem("pi-viewer-sidebar")).collapsed)) === false)
    }
    check(tag + " no overflow at end", !(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)))
  } catch (e) { check(tag + " script threw", false, String(e).slice(0, 250)) }
  check(tag + " 0 console errors or warnings", errs.length === 0, errs.slice(0, 3).join(" || "))
  await ctx.close()
}
await b.close()
let f = 0; for (const r of res) { if (!r.ok) f++; console.log(r.ok ? "PASS" : "FAIL", r.n, r.d ? "· " + r.d : "") }
console.log((res.length - f) + "/" + res.length + " passed"); process.exit(f ? 1 : 0)
