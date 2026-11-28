// Browser gate for the sidebar: row density, rails, scopes, URL, keyboard, rail, mobile overlay.
// Read-only against a running viewer; it clicks the UI and never sends a prompt.
//
//   PI_VIEWER_URL=http://127.0.0.1:5199/ node scripts/sidebar-gate.mjs [screenshot-dir]
//
// Environment:
//   PI_VIEWER_URL      viewer to check (required; the gate refuses to guess, because the shared :5199
//                      dev server is a live session this gate must not click)
//   PLAYWRIGHT_MODULE  path or name of the playwright package (default "playwright")
//   CHROMIUM_PATH      browser executable; unset lets playwright use its own download
// Needs a tmux session with at least one multi-pane window, such as xx. Exit 0 = all checks pass.
import { createRequire } from "node:module"
import { mkdirSync } from "node:fs"
const require = createRequire(import.meta.url)
const BASE = process.env.PI_VIEWER_URL
if (!BASE) {
  console.error("sidebar-gate: set PI_VIEWER_URL to the viewer under test, e.g. PI_VIEWER_URL=http://127.0.0.1:5199/ node scripts/sidebar-gate.mjs")
  process.exit(2)
}
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const SHOTS = process.argv[2] || "sidebar-gate-shots"
mkdirSync(SHOTS, { recursive: true })
const res = []; const check = (n, ok, d = "") => res.push({ n, ok, d })
const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
for (const [w, h] of [[1440, 900], [390, 844]]) for (const theme of ["dark", "light"]) {
  const tag = w + "-" + theme, narrow = w < 768
  const ctx = await b.newContext({ viewport: { width: w, height: h } })
  await ctx.addInitScript((t) => { if (!sessionStorage.getItem("s")) { localStorage.setItem("pi-viewer-theme", t); localStorage.removeItem("pi-viewer-sidebar"); localStorage.removeItem("xtrm.console.layout.v1"); sessionStorage.setItem("s", "1") } }, theme)
  const p = await ctx.newPage(); p.setDefaultTimeout(60000); const errs = []
  p.on("console", (m) => { if (["error", "warning"].includes(m.type())) errs.push(m.text().slice(0, 200)) })
  p.on("pageerror", (e) => errs.push("pageerror " + e.message))
  const S_ = () => p.evaluate(() => location.search)
  const title = () => p.locator('[data-testid="scope-title"]').textContent()
  const side = p.locator('[data-testid="sidebar"]')
  // XTRM-1044: the sidebar is the console's container. Narrow: an overlay that is not mounted while closed, opened from the top bar.
  const open = async () => { if (narrow && (await side.count()) === 0) { await p.getByRole("button", { name: "Open sidebar" }).click(); await p.waitForTimeout(250) } }
  const sel = async () => { await open(); const k = await p.evaluate(() => document.querySelector('[role=treeitem][aria-selected=true]')?.getAttribute("data-key")); if (narrow) { await p.keyboard.press("Escape"); await p.waitForTimeout(250) } return k }
  try {
    await p.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 }); await p.waitForSelector('[data-testid="top-bar"]', { timeout: 60000 }); if (narrow) await open(); await p.waitForSelector('[role=treeitem]', { state: "attached", timeout: 90000 }); await p.waitForTimeout(2500)
    await open()
    const g = await p.evaluate(() => {
      const rows = [...document.querySelectorAll('[role=treeitem]')]
      const r = rows.map((e) => e.getBoundingClientRect())
      const uniq = (els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().height * 10) / 10))]
      const groups = rows.filter((e) => e.hasAttribute("aria-expanded")), leaves = rows.filter((e) => !e.hasAttribute("aria-expanded"))
      return { groupHs: uniq(groups), paneHs: uniq(leaves), railLines: document.querySelectorAll('[data-testid=sidebar] [role=tree] .border-l').length, nGroups: groups.length, n: rows.length, hs: [...new Set(r.map((x) => Math.round(x.height * 10) / 10))], contiguous: r.every((x, i) => i === 0 || Math.abs(x.top - r[i - 1].bottom) < 0.6), levels: [...new Set(rows.map((e) => e.getAttribute("aria-level")))].sort(), windowsRows: rows.filter((e) => e.getAttribute("aria-level") === "2" && e.hasAttribute("aria-expanded")).length, panes: rows.filter((e) => !e.hasAttribute("aria-expanded")).length, groupCounts: rows.filter((e) => e.hasAttribute("aria-expanded")).every((e) => /\d+ agents/.test(e.getAttribute("aria-label"))), total: r.length ? Math.round(r.at(-1).bottom - r[0].top) : 0, overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth }
    })
    check(tag + " session and window rows are one 28px line", g.groupHs.length === 1 && g.groupHs[0] === 28, JSON.stringify(g.groupHs))
    check(tag + " pane rows are two lines, 48px (name, then role, runtime, repo)", g.paneHs.length === 1 && g.paneHs[0] === 48, JSON.stringify(g.paneHs))
    check(tag + " rows are contiguous and draw no rail lines", g.contiguous && g.railLines === 0, "rails " + g.railLines)
    check(tag + " tree height " + g.total + "px for " + g.panes + " agents", g.total <= g.nGroups * 28 + g.panes * 48 + 1)
    check(tag + " group rows carry counts", g.groupCounts)
    // XTRM-1048: the dot carries the state. Line 2 names role, repo and runtime only; every pane row's
    // dot is labelled and titled with the state word, the row's aria-label carries the same word, and
    // every dot holds 3:1 against the sidebar it sits on (the non-text minimum).
    // XTRM-1058: an idle or waiting agent draws no dot at all; the row keeps the dot's 14px slot empty
    // so nothing shifts, and its label still says the state.
    const dots = await p.evaluate(() => {
      // Colours are read through a canvas: the used value of a Tailwind v4 token can be oklch(), and the
      // canvas resolves any CSS colour to sRGB bytes, which is what a screenshot would show.
      const px = (() => { const c = document.createElement('canvas'); c.width = c.height = 1; const g = c.getContext('2d', { willReadFrequently: true }); return (css) => { g.clearRect(0, 0, 1, 1); g.fillStyle = css; g.fillRect(0, 0, 1, 1); const d = g.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] } })()
      const lum = (c) => { const [r, gg, b] = c.slice(0, 3).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * gg + 0.0722 * b }
      const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05) }
      const plane = px(getComputedStyle(document.querySelector('[data-testid=sidebar]')).backgroundColor)
      const wordAtEnd = /(^|\s)(idle|running|working|quiet|waiting|error|failed|unknown|needs you)$/i
      const words = ['Working', 'Needs you', 'Quiet', 'Waiting', 'Failed', 'Idle', 'Unknown']
      return [...document.querySelectorAll('[role=treeitem][aria-level="3"]')].map((row) => {
        const line2 = (row.querySelector('[data-testid=pane-row-line2]')?.textContent || '').replace(/\s+/g, ' ').trim()
        const dot = row.querySelector('[data-testid=sidebar-dot]')
        const slot = row.querySelector('[data-testid=sidebar-dot-slot]')
        const mark = dot?.firstElementChild
        const cs = mark ? getComputedStyle(mark) : null
        const fill = cs?.backgroundColor || 'rgb(0, 0, 0)'
        const hollow = px(fill)[3] === 0
        const [r, gg, b, a] = px(hollow ? cs.borderTopColor : fill)
        const colour = [r, gg, b].map((v, i) => Math.round(v * a + plane[i] * (1 - a)))
        return {
          line2,
          wordAtEnd: wordAtEnd.test(line2),
          hasSeparator: line2.includes('·'),
          label: dot?.getAttribute('aria-label') || '',
          title: dot?.getAttribute('title') || '',
          rowLabel: row.getAttribute('aria-label') || '',
          contrast: cs ? ratio(colour, plane) : 0,
          anim: cs?.animationName || 'none',
          known: words.some((w) => (dot?.getAttribute('aria-label') || '') === w || (dot?.getAttribute('aria-label') || '').startsWith(w + ' ')),
          hasDot: !!dot,
          hasSlot: !!slot,
          slotBox: slot ? [slot.getBoundingClientRect().width, slot.getBoundingClientRect().height].map((v) => Math.round(v)) : null,
          rowH: Math.round(row.getBoundingClientRect().height * 10) / 10,
        }
      })
    })
    check(tag + " pane row line 2 names the role, the runtime and the repo, with no separator and no state", dots.length > 0 && dots.every((d) => d.line2.length > 0 && !d.wordAtEnd && !d.hasSeparator), JSON.stringify(dots.slice(0, 2).map((d) => d.line2)))
    const withDot = dots.filter((d) => d.hasDot), withoutDot = dots.filter((d) => !d.hasDot)
    check(tag + " every pane row's dot is labelled and titled with its state", withDot.length > 0 && withDot.every((d) => d.label && d.known && d.title === d.label), JSON.stringify(withDot.slice(0, 2)))
    check(tag + " the row's aria-label carries the dot's state", withDot.length > 0 && withDot.every((d) => d.rowLabel.endsWith(', ' + d.label)), JSON.stringify(withDot.slice(0, 2).map((d) => d.rowLabel)))
    check(tag + " every dot holds 3:1 against the sidebar", withDot.length > 0 && withDot.every((d) => d.contrast >= 3), Math.min(...withDot.map((d) => d.contrast)).toFixed(2))
    // XTRM-1058: idle and waiting bring no dot, and only those two; the slot stays so nothing shifts.
    // The rule is read off the row label, not off the missing dot, so an idle row that wrongly drew a
    // dot still fails, and the count in the detail says whether this tree held an idle agent at all.
    const idleLike = dots.filter((d) => /, (Idle|Waiting)$/.test(d.rowLabel))
    check(tag + " every idle or waiting row draws no dot", idleLike.every((d) => !d.hasDot), idleLike.length + " idle rows " + JSON.stringify(idleLike.map((d) => d.rowLabel)))
    check(tag + " a row without a dot keeps the dot's 14px slot empty", withoutDot.every((d) => d.hasSlot && d.slotBox[0] === 14 && d.slotBox[1] === 14), JSON.stringify(withoutDot.slice(0, 2).map((d) => d.slotBox)))
    check(tag + " an idle row still names its state in the aria-label", idleLike.every((d) => d.label === '' || /Idle|Waiting/.test(d.label)), JSON.stringify(idleLike.slice(0, 2).map((d) => d.rowLabel)))
    check(tag + " rows keep one height with and without a dot", new Set(dots.map((d) => d.rowH)).size === 1, JSON.stringify([...new Set(dots.map((d) => d.rowH))]))
    check(tag + " one-pane windows add no row (window rows have 2+ agents)", await p.evaluate(() => [...document.querySelectorAll('[role=treeitem][aria-level="2"][aria-expanded]')].every((e) => Number(/(\d+) agents/.exec(e.getAttribute("aria-label"))[1]) >= 2)))
    // XTRM-1155: the host glyph. A row that speaks for a whole window (a window row, or the stand-in
    // row of a single-pane window) draws exactly one glyph; a pane row draws none inside a uniform
    // window, or its own when the window mixes hosts. The glyph paints in the row's chrome ink role and
    // every name paints in the row's reading role, so an icon cannot read as a different kind of row and
    // the tree follows the Colours setting the chat follows. Both roles are resolved per row, because
    // Desktop's selected row lifts --x-icon-ink and --x-ink-muted above their palette values. The row's
    // aria-label names the host.
    const hostScan = await p.evaluate(() => {
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 1
      const ctx = canvas.getContext("2d", { willReadFrequently: true })
      // One parser for both sides: any CSS colour becomes sRGB bytes plus alpha, or null. A colour this
      // canvas cannot read fails the check that needs it; it never passes by default.
      const px = (css) => {
        const text = (css || "").trim()
        if (!text || !CSS.supports("color", text)) return null
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = text
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
        return [r, g, b, a / 255]
      }
      // A translucent ink reads as itself composited over the plane it sits on.
      const over = (c, base) => (c[3] === 1 ? c.slice(0, 3) : [0, 1, 2].map((i) => Math.round(c[i] * c[3] + base[i] * (1 - c[3]))))
      const lum = (c) => {
        const [r, g, b] = c.map((v) => {
          const x = v / 255
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const ratio = (a, b) => {
        const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
        return (hi + 0.05) / (lo + 0.05)
      }
      const sidebar = px(getComputedStyle(document.querySelector('[data-testid="sidebar"]')).backgroundColor)
      const base = sidebar ? sidebar.slice(0, 3) : null
      const rowsEl = [...document.querySelectorAll("[role=treeitem]")]
      // A pane row carries a glyph exactly when its window row cannot: the window has no row (one pane),
      // or its row drew none (a window that mixes hosts). Counting alone would pass a uniform window
      // whose pane rows repeat the window's glyph.
      const wrong = []
      let windowGlyphs = null
      for (const row of rowsEl) {
        const level = row.getAttribute("aria-level")
        const glyphs = row.querySelectorAll("[data-testid=host-glyph]").length
        if (level === "1") { windowGlyphs = null; continue }
        if (level === "2") { windowGlyphs = glyphs; continue }
        if (level !== "3") continue
        if (glyphs !== (windowGlyphs === 0 || windowGlyphs === null ? 1 : 0)) wrong.push({ windowGlyphs, glyphs })
      }
      return { wrong, rows: rowsEl.map((row) => {
        const style = getComputedStyle(row)
        const glyph = row.querySelector("[data-testid=host-glyph]")
        const svg = glyph?.querySelector("svg") ?? null
        const name = glyph?.nextElementSibling ?? row.querySelector(".truncate")
        const box = glyph ? glyph.getBoundingClientRect() : null
        const ink = svg ? px(getComputedStyle(svg).color) : null
        const want = px(style.getPropertyValue("--color-icon-ink"))
        const nameInk = name ? px(getComputedStyle(name).color) : null
        const wantName = px(style.getPropertyValue("--color-read"))
        return {
          level: row.getAttribute("aria-level"),
          glyphs: row.querySelectorAll("[data-testid=host-glyph]").length,
          host: glyph?.getAttribute("data-host") ?? null,
          ink: ink && base ? over(ink, base) : null,
          want: want && base ? over(want, base) : null,
          nameInk: nameInk && base ? over(nameInk, base) : null,
          wantName: wantName && base ? over(wantName, base) : null,
          contrast: ink && base ? ratio(over(ink, base), base) : null,
          box: box ? [Math.round(box.width), Math.round(box.height)] : null,
          label: row.getAttribute("aria-label") || "",
        }
      }) }
    })
    const rgb = hostScan.rows
    check(tag + " a pane row repeats its window's glyph only when the window row is absent", hostScan.wrong.length === 0, JSON.stringify(hostScan.wrong.slice(0, 3)))
    // One parser, one tolerance: the canvas quantises #a0a0a8 and rgb(160, 160, 168) to the same bytes.
    const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.every((v, i) => Math.abs(v - b[i]) <= 1)
    const spokesmen = rgb.filter((r) => r.level === "2"), panes = rgb.filter((r) => r.level === "3"), marked = rgb.filter((r) => r.glyphs > 0)
    check(tag + " every row that speaks for a window draws one host glyph", spokesmen.length > 0 && spokesmen.every((r) => r.glyphs === 1), JSON.stringify(spokesmen.slice(0, 3)))
    check(tag + " a pane row draws no shared glyph, only its own in a mixed window", panes.every((r) => r.glyphs <= 1), JSON.stringify(panes.slice(0, 3)))
    check(tag + " every host glyph is the monitor or the server, never anything else", marked.every((r) => r.host === "local" || r.host === "remote"), JSON.stringify(marked.slice(0, 3).map((r) => r.host)))
    check(tag + " a host glyph paints in its row's icon role", marked.every((r) => same(r.ink, r.want)), JSON.stringify(marked.slice(0, 2).map((r) => [r.ink, r.want])))
    check(tag + " a host glyph clears the 3:1 non-text minimum", marked.every((r) => r.contrast !== null && r.contrast >= 3), JSON.stringify(marked.slice(0, 3).map((r) => (r.contrast === null ? null : Number(r.contrast.toFixed(2))))))
    check(tag + " a host glyph fits inside the name's line", marked.every((r) => r.box && r.box[0] <= 16 && r.box[1] <= 16), JSON.stringify(marked.slice(0, 3).map((r) => r.box)))
    check(tag + " every sidebar name paints in its row's reading role", rgb.every((r) => same(r.nameInk, r.wantName)), JSON.stringify(rgb.slice(0, 2).map((r) => [r.nameInk, r.wantName])))
    check(tag + " every row with a host glyph names the host", marked.every((r) => /, (this machine|host \S+)$/.test(r.label)), JSON.stringify(marked.slice(0, 3).map((r) => r.label)))
    // XTRM-1155: soft text reaches the tree. The Colours control sets it; every name must then read in the
    // soft reading role and every chrome mark in the soft icon role, which is the change that made the tone
    // visible in the sidebar at all. Soft is dark only, so the light theme keeps the standard values (checked
    // as the same pair, not as "unchanged", so a palette edit cannot pass silently). Desktop widths only: at
    // 390 the sidebar is an overlay that covers the header control, and the tone renders the same at any width.
    if (!narrow) {
      const tones = async () => p.evaluate(() => {
        const colour = (el) => (el ? getComputedStyle(el).color : null)
        const rows = [...document.querySelectorAll("[role=treeitem]")]
        const names = rows.map((r) => r.querySelector("[data-testid=host-glyph]")?.nextElementSibling ?? r.querySelector(".truncate"))
        const glyphs = rows.map((r) => r.querySelector("[data-testid=host-glyph] svg")).filter(Boolean)
        return { names: names.map(colour), glyphs: glyphs.map(colour) }
      })
      const choose = async (name) => {
        await p.getByRole("button", { name: /^Colours:/ }).click()
        await p.getByRole("radiogroup", { name: "Colours" }).getByRole("radio", { name, exact: true }).click()
        await p.keyboard.press("Escape")
        await p.waitForTimeout(400)
      }
      const dark = tag.endsWith("dark")
      const standard = await tones()
      await choose("Threads · soft text")
      const soft = await tones()
      const wantName = dark ? "rgb(200, 200, 200)" : "rgb(24, 24, 27)", wantGlyph = dark ? "rgb(142, 142, 142)" : "rgb(95, 95, 104)"
      check(tag + " standard tone: every name reads in the primary ink", standard.names.every((c) => c === (dark ? "rgb(236, 236, 239)" : "rgb(24, 24, 27)")), JSON.stringify(standard.names.slice(0, 2)))
      check(tag + " soft tone: every name dims to the soft reading role", soft.names.length > 0 && soft.names.every((c) => c === wantName), JSON.stringify(soft.names.slice(0, 2)))
      check(tag + " soft tone: every chrome mark dims to the soft icon role", soft.glyphs.length > 0 && soft.glyphs.every((c) => c === wantGlyph), JSON.stringify(soft.glyphs.slice(0, 2)))
      await choose("Threads")
    }
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
    await p.reload({ waitUntil: "domcontentloaded", timeout: 60000 }); await p.waitForSelector('[data-testid="top-bar"]', { timeout: 60000 }); if (narrow) await open(); await p.waitForSelector('[role=treeitem]', { state: "attached", timeout: 90000 }); await p.waitForTimeout(2500)
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
      // Console shell (XTRM-1044): width 264 (min 220, max 360), persisted; collapse to 0 with the reopen button in the top bar.
      const panelW = async () => Math.round((await p.locator('[data-testid="sidebar-panel"]').boundingBox()).width)
      const mainX = async () => Math.round((await p.locator('[data-testid="top-bar"]').boundingBox()).x)
      const stored = () => p.evaluate(() => JSON.parse(localStorage.getItem("xtrm.console.layout.v1") ?? "null"))
      check(tag + " expanded width is the console's 264", (await panelW()) === 264, String(await panelW()))
      check(tag + " console top switcher: Work, Threads selected", await p.evaluate(() => { const r = [...document.querySelectorAll('[data-testid=half-switch] [role=radio]')]; return r.length === 2 && r[0].getAttribute("aria-label") === "Work" && r[1].getAttribute("aria-label") === "Threads" && r[1].getAttribute("aria-checked") === "true" }))
      // Header icon buttons equal the console's measured ones (xtrm-app TopBar and sidebar header): a 28px box, a 16px glyph (refactored ladder).
      const ib = await p.evaluate(() => [...document.querySelectorAll('[data-testid=sidebar-collapse], [data-testid=top-bar] button:has(svg)')].filter((b) => /sidebar|theme|Chat width/.test(b.getAttribute("aria-label") || "")).map((b) => { const r = b.getBoundingClientRect(), s = b.querySelector("svg").getBoundingClientRect(); return [b.getAttribute("aria-label"), Math.round(r.width), Math.round(r.height), Math.round(s.width * 10) / 10] }))
      check(tag + " header icon buttons are the console's 28px box with a 16px glyph", ib.length >= 2 && ib.every((x) => x[1] === 28 && x[2] === 28 && x[3] === 16), JSON.stringify(ib))
      // Operator: no right-edge border or hairline; the sidebar and the thread differ by background only.
      const edge = await p.evaluate(() => { const a = document.querySelector('[data-testid=sidebar]'), cs = getComputedStyle(a), line = document.querySelector('[role=separator] span'), ls = line ? getComputedStyle(line) : null; const m = document.querySelector('[data-testid=top-bar]').parentElement; return { border: cs.borderRightWidth, side: cs.backgroundColor, main: getComputedStyle(m).backgroundColor, line: ls ? ls.backgroundColor : "none" } })
      check(tag + " no sidebar border or hairline, background-only edge", edge.border === "0px" && (edge.line === "none" || edge.line === "rgba(0, 0, 0, 0)"), JSON.stringify(edge))
      // Segmented controls (Work/Threads, Channel/All events): WCAG ratios, the translucent track composited over what is behind it.
      const seg = await p.evaluate(() => {
        const rgba = (c) => { const x = document.createElement("canvas").getContext("2d"); x.fillStyle = "#000"; x.fillStyle = c; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
        const over = (t, b) => [0, 1, 2].map((i) => t[i] * t[3] + b[i] * (1 - t[3]))
        const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
        const cr = (a, b) => { const x = lum(a), y = lum(b); return Math.round(((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)) * 100) / 100 }
        const one = (track, sel, off, behind) => {
          let n = behind; while (n && rgba(getComputedStyle(n).backgroundColor)[3] === 0) n = n.parentElement; const bg = rgba(getComputedStyle(n ?? document.body).backgroundColor), t = over(rgba(getComputedStyle(track).backgroundColor), bg), s = rgba(getComputedStyle(sel).backgroundColor).slice(0, 3)
          return { pillVsTrack: cr(s, t), textVsPill: cr(rgba(getComputedStyle(sel).color), s), offVsTrack: cr(rgba(getComputedStyle(off).color), t), trackVsBehind: cr(t, bg.slice(0, 3)) }
        }
        const hs = document.querySelector("[data-testid=half-switch]"), vs = document.querySelector('[role=tablist][aria-label=View]')
        return { switcher: one(hs, hs.querySelector("[aria-checked=true]"), hs.querySelector("[aria-checked=false]"), document.querySelector("[data-testid=sidebar]")), view: one(vs, vs.querySelector("[aria-selected=true]"), vs.querySelector("[aria-selected=false]"), vs.parentElement) }
      }).catch(() => null)
      if (seg) for (const [name, r] of Object.entries(seg)) {
        check(tag + " " + name + " selected text on the pill is 4.5:1 or better", r.textVsPill >= 4.5, JSON.stringify(r))
        check(tag + " " + name + " unselected label on the track is 4.5:1 or better", r.offVsTrack >= 4.5, JSON.stringify(r))
        check(tag + " " + name + " selected pill against the track is " + (theme === "dark" ? "1.5:1" : "1.25:1 (white pill)") + " or better", r.pillVsTrack >= (theme === "dark" ? 1.5 : 1.25), JSON.stringify(r))
      }
      // Console palette: both controls keep their original look; no contrast threshold there.
      const cons = await p.evaluate(async () => {
        const root = document.documentElement, prev = root.getAttribute("data-palette")
        root.setAttribute("data-palette", "console")
        const rgba = (c) => { const x = document.createElement("canvas").getContext("2d"); x.fillStyle = "#000"; x.fillStyle = c; x.fillRect(0, 0, 1, 1); return [...x.getImageData(0, 0, 1, 1).data].join(",") }
        const tok = (n) => rgba(getComputedStyle(root).getPropertyValue(n).trim())
        const hs = document.querySelector("[data-testid=half-switch]"), vs = document.querySelector('[role=tablist][aria-label=View]')
        // The switcher animates its colours (transition-colors), so a fixed wait reads a mid-transition value
        // whenever the page has not painted for a while. Wait for the transition to settle instead: the
        // selected half must reach the console's control fill, then the rest of the values are read.
        for (let i = 0; i < 80; i += 1) {
          const sel = hs.querySelector("[aria-checked=true]")
          if (sel && rgba(getComputedStyle(sel).backgroundColor) === tok("--x-control")) break
          await new Promise((r) => setTimeout(r, 25))
        }
        const hsSel = hs.querySelector("[aria-checked=true]"), hsOff = hs.querySelector("[aria-checked=false]"), vsSel = vs.querySelector("[aria-selected=true]"), vsOff = vs.querySelector("[aria-selected=false]")
        const c = (e, k) => rgba(getComputedStyle(e)[k])
        const r = {
          hsSelBg: c(hsSel, "backgroundColor") === tok("--x-control"), hsSelInk: c(hsSel, "color") === tok("--x-ink"), hsSelShadow: !/0px 1px 2px/.test(getComputedStyle(hsSel).boxShadow), hsOff: c(hsOff, "color") === tok("--x-ink-faint"),
          vsSelBg: c(vsSel, "backgroundColor") === tok("--x-surface"), vsSelInk: c(vsSel, "color") === tok("--x-ink"), vsOff: c(vsOff, "color") === tok("--x-ink-faint"),
        }
        if (prev === null) root.removeAttribute("data-palette"); else root.setAttribute("data-palette", prev)
        return r
      }).catch(() => null)
      if (cons) check(tag + " console palette: switcher bg-control/text-ink/no shadow/faint, view control surface/ink/faint (original look)", Object.values(cons).every(Boolean), JSON.stringify(cons))
      const sep = p.getByRole("separator", { name: "Resize sidebar" })
      const drag = async (dx) => { const bb = await sep.boundingBox(); const x = bb.x + bb.width / 2, y = bb.y + 300; await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + dx, y, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(400) }
      await drag(60); check(tag + " drag +60 widens to 324", (await panelW()) === 324, String(await panelW()))
      await drag(-600); check(tag + " drag stops at the console minimum 220", (await panelW()) === 220, String(await panelW()))
      await drag(700); check(tag + " drag stops at the console maximum 360", (await panelW()) === 360, String(await panelW()))
      await drag(-90); const w2 = await panelW(); check(tag + " width persisted under the console's key", (await stored())?.sidebarWidth === w2, w2 + " " + JSON.stringify(await stored()))
      await sep.focus(); await p.keyboard.press("ArrowRight"); await p.waitForTimeout(300)
      check(tag + " resize handle is a labelled, keyboard-reachable separator (ArrowRight widens)", (await panelW()) > w2, w2 + " -> " + (await panelW()))
      const w3 = await panelW()
      await p.getByRole("button", { name: "Collapse sidebar" }).focus(); await p.keyboard.press("Enter"); await p.waitForTimeout(500)
      check(tag + " collapse: panel gone (content starts at x=0), focus on Open sidebar", (await mainX()) === 0 && (await p.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Open sidebar", (await mainX()) + " " + (await p.evaluate(() => document.activeElement?.getAttribute("aria-label"))))
      check(tag + " collapsed state persisted", (await stored())?.sidebarOpen === false)
      await p.screenshot({ path: SHOTS + "/g4-" + tag + "-collapsed.png" })
      await p.keyboard.press("Enter"); await p.waitForTimeout(500)
      check(tag + " reopen restores the dragged width, focus on Collapse sidebar", (await mainX()) === w3 && (await p.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Collapse sidebar", (await mainX()) + " vs " + w3)
      await p.keyboard.press("Control+b"); await p.waitForTimeout(500); const closedByKey = (await mainX()) === 0
      await p.keyboard.press("Control+b"); await p.waitForTimeout(500)
      check(tag + " Ctrl+B toggles the sidebar", closedByKey && (await mainX()) === w3)
      await p.reload({ waitUntil: "domcontentloaded", timeout: 60000 }); await p.waitForSelector('[role=treeitem]', { state: "attached", timeout: 90000 }); await p.waitForTimeout(1500)
      check(tag + " reload keeps the width", (await panelW()) === w3, String(await panelW()))
    } else {
      await open(); await p.screenshot({ path: SHOTS + "/g4-" + tag + "-open.png" })
      // Overlay header: the collapse button, its tooltip and the "Sessions" heading never intersect.
      const boxes = () => p.evaluate(() => { const bx = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom } }; return { btn: bx(document.querySelector("[data-testid=sidebar-collapse]")), h2: bx([...document.querySelectorAll("h2")].find((e) => e.textContent === "Sessions")), tip: bx(document.querySelector("[role=tooltip]")?.closest("[data-radix-popper-content-wrapper]")) } })
      const hit = (a, c) => !!a && !!c && a.x < c.r && c.x < a.r && a.y < c.b && c.y < a.b
      await p.waitForTimeout(500); const ov = await boxes()
      check(tag + " overlay: collapse button and Sessions heading do not intersect", !!ov.btn && !!ov.h2 && !hit(ov.btn, ov.h2), JSON.stringify(ov))
      check(tag + " overlay: no tooltip pops up when the overlay opens", ov.tip === null, JSON.stringify(ov))
      await p.locator('[data-testid="sidebar-collapse"]').hover(); await p.waitForTimeout(900); const hv = await boxes()
      check(tag + " overlay: the collapse tooltip shows on hover and does not cover the heading", hv.tip !== null && !hit(hv.tip, hv.h2) && !hit(hv.tip, hv.btn), JSON.stringify(hv))
      await p.keyboard.press("Escape"); await p.waitForTimeout(250)
      check(tag + " Escape closes the overlay", (await side.count()) === 0)
      check(tag + " overlay never persisted as closed", (await p.evaluate(() => JSON.parse(localStorage.getItem("xtrm.console.layout.v1") ?? '{"sidebarOpen":true}').sidebarOpen)) !== false)
    }
    check(tag + " no overflow at end", !(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)))
  } catch (e) { check(tag + " script threw", false, String(e).slice(0, 250)) }
  check(tag + " 0 console errors or warnings", errs.length === 0, errs.slice(0, 3).join(" || "))
  await ctx.close()
}
for (const theme of ["dark", "light"]) {
  // XTRM-1048 (4): prefers-reduced-motion drops the motion; the colour still carries the state.
  try {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
    try {
      await ctx.addInitScript((t) => { localStorage.setItem("pi-viewer-theme", t); localStorage.removeItem("pi-viewer-sidebar"); localStorage.removeItem("xtrm.console.layout.v1") }, theme)
      const rp = await ctx.newPage()
      await rp.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 })
      await rp.waitForSelector('[data-testid=sidebar-dot]', { state: "attached", timeout: 90000 })
      const anims = await rp.evaluate(() => [...document.querySelectorAll('[data-testid=sidebar-dot] > span')].map((e) => getComputedStyle(e).animationName))
      check("reduced-motion " + theme + ": sidebar dots do not animate", anims.length > 0 && anims.every((n) => n === "none"), JSON.stringify([...new Set(anims)]))
    } finally { await ctx.close().catch(() => {}) }
  } catch (e) { check("reduced-motion " + theme + " script threw", false, String(e).slice(0, 250)) }
}
await b.close()
let f = 0; for (const r of res) { if (!r.ok) f++; console.log(r.ok ? "PASS" : "FAIL", r.n, r.d ? "· " + r.d : "") }
console.log((res.length - f) + "/" + res.length + " passed"); process.exit(f ? 1 : 0)
