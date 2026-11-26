// Composer browser check (XTRM-1054, XTRM-1056).
//
// Runs the app in-process with a mocked API (its own port, stopped at the end) and, for 1440 and 390
// wide, dark and light (the theme is set through localStorage, which is what the viewer reads),
// asserts the Claude-Desktop-shaped composer:
// - an empty composer reserves ONE text row: 56px high at 16/24, and still grows with content up to a cap,
//   after which the text scrolls inside its column, clear of the send button and the box's bottom inset;
// - the To selector sits in a row BELOW the box, outside it, right-aligned;
// - the box carries no visible border at rest: a fill one step from the canvas, and no hairline in
//   Threads; focus alone draws the ring (>= 0.15 alpha, inset);
// - send is a 32px hit area around a 16px glyph, centred on the text line and anchored to the last
//   line when the box grows, its right inset equal to the text's left inset;
// - the under-row shows the target's model and bare effort at 14px, 12px apart, its right edge on the
//   send button's right edge, updates with the target, and omits what the runtime does not report;
// - no console error.
import assert from "node:assert/strict"
import { createServer } from "vite"
import { chromium } from "playwright"

const PORT = 5293
const SESSION = "xx"
const T0 = Date.now() - 60 * 60_000

function agent(index, name, provider, model, thinkingLevel) {
  return {
    id: `%${index}`, paneId: `%${index}`, panePid: index, piPid: index, provider,
    tmuxSession: SESSION, windowIndex: 0, windowId: "@0", windowName: "w0", paneIndex: index,
    name, title: "", cwd: `/home/u/${name}`,
    sessionFile: `/tmp/${name}.jsonl`, sessionId: `s${index}`, sessionName: name,
    model, thinkingLevel, role: "worker", modifiedAt: Date.now(),
    lastWriteAt: Date.now(), eventCount: 0, status: "idle", statusNote: null, statusDetail: null,
  }
}

// One Pi target that reports an effort, one Claude target that does not: the row must show both shapes.
const PI = agent(1, "agent-pi", "pi", "anthropic/claude-sonnet-4-5", "high")
const CLAUDE = agent(2, "agent-claude", "claude", "claude-opus-4-5", null)
const agents = [PI, CLAUDE]
const events = [
  { id: "%1:0", agentId: "%1", agentName: PI.name, seq: 0, at: T0, kind: "user", role: "user", summary: "hi", onBranch: true, text: "hi" },
  { id: "%1:1", agentId: "%1", agentName: PI.name, seq: 1, at: T0 + 5_000, kind: "assistant", role: "assistant", summary: "hello", onBranch: true, text: "hello", parts: [{ type: "text", text: "hello" }], stopReason: "stop" },
]

const read = (page) =>
  page.evaluate(() => {
    const box = document.querySelector(".xtrm-composer-box")
    const input = document.querySelector("[data-composer-input]")
    const under = document.querySelector("[data-composer-under-row]")
    const group = document.querySelector("[data-composer-target-meta]")
    const model = document.querySelector("[data-composer-target-model]")
    const effort = document.querySelector("[data-composer-target-effort]")
    const selector = group?.querySelector("button")
    const controls = document.querySelector("[data-composer-controls]")
    const attach = document.querySelector("[data-composer-attach-slot]")
    const send = controls?.querySelector("button")
    const canvas = box?.closest(".bg-canvas")
    const rect = (node) => (node ? node.getBoundingClientRect() : null)
    const boxRect = rect(box)
    const underRect = rect(under)
    const groupRect = rect(group)
    const sendRect = rect(send)
    const glyphRect = rect(send?.querySelector("svg"))
    const inputRect = rect(input)
    const style = getComputedStyle(box)
    return {
      box: Math.round(boxRect.height * 10) / 10,
      boxLeft: Math.round(boxRect.left * 10) / 10,
      boxRight: Math.round(boxRect.right * 10) / 10,
      boxBottom: Math.round(boxRect.bottom * 10) / 10,
      input: Math.round(input.getBoundingClientRect().height * 10) / 10,
      line: parseFloat(getComputedStyle(input).lineHeight),
      underTop: Math.round(underRect.top * 10) / 10,
      underInsideBox: box.contains(under),
      groupRight: groupRect ? Math.round(groupRect.right * 10) / 10 : null,
      groupLeft: groupRect ? Math.round(groupRect.left * 10) / 10 : null,
      selectorText: selector?.innerText.replace(/\s+/g, " ").trim() ?? null,
      selectorSize: selector ? getComputedStyle(selector).fontSize : null,
      promptSize: getComputedStyle(input).fontSize,
      model: model?.innerText.trim() ?? null,
      modelSize: model ? getComputedStyle(model).fontSize : null,
      effort: effort?.innerText.trim() ?? null,
      effortSize: effort ? getComputedStyle(effort).fontSize : null,
      gap: model && effort ? Math.round((effort.getBoundingClientRect().left - model.getBoundingClientRect().right) * 10) / 10 : null,
      controlsInsideBox: controls ? box.contains(controls) : false,
      attachEmpty: attach ? attach.children.length === 0 && !attach.textContent.trim() : false,
      sendInsideBox: sendRect ? sendRect.bottom <= boxRect.bottom + 0.5 && sendRect.right <= boxRect.right + 0.5 : false,
      sendW: Math.round(sendRect.width * 10) / 10,
      sendH: Math.round(sendRect.height * 10) / 10,
      glyph: glyphRect ? Math.round(glyphRect.width * 10) / 10 : null,
      sendRightInset: Math.round((boxRect.right - sendRect.right) * 10) / 10,
      // The textarea spans the box and owns its own padding, so the text starts at its paddingLeft.
      textLeftInset: Math.round((inputRect.left - boxRect.left + parseFloat(getComputedStyle(input).paddingLeft)) * 10) / 10,
      sendCentre: Math.round((sendRect.top + sendRect.height / 2 - boxRect.top) * 10) / 10,
      // The textarea owns the box padding, so the first text line starts paddingTop below its top.
      lineCentre: Math.round((inputRect.top + parseFloat(getComputedStyle(input).paddingTop) + parseFloat(getComputedStyle(input).lineHeight) / 2 - boxRect.top) * 10) / 10,
      sendBottomGap: Math.round((boxRect.bottom - sendRect.bottom) * 10) / 10,
      inputBottomGap: Math.round((boxRect.bottom - inputRect.bottom) * 10) / 10,
      inputToSend: Math.round((sendRect.left - inputRect.right) * 10) / 10,
      inputScrolls: input.scrollHeight > input.clientHeight + 1,
      underRight: groupRect ? Math.round(groupRect.right * 10) / 10 : null,
      fill: style.backgroundColor,
      canvas: canvas ? getComputedStyle(canvas).backgroundColor : null,
      shadow: style.boxShadow,
      focused: document.activeElement?.hasAttribute("data-composer-input") ?? false,
    }
  })

/** The largest alpha in a computed box-shadow, or 0 when there is none. */
function shadowAlpha(shadow) {
  const alphas = [...shadow.matchAll(/rgba?\(([^)]+)\)/g)].map((match) => {
    const parts = match[1].split(/[\s,/]+/).filter(Boolean)
    return parts.length >= 4 ? Number(parts[3]) : 1
  })
  return alphas.length ? Math.max(...alphas) : 0
}

const server = await createServer({ root: process.cwd(), logLevel: "error", server: { host: "127.0.0.1", port: PORT, strictPort: true } })
await server.listen()
const base = `http://127.0.0.1:${PORT}`
const browser = await chromium.launch({ headless: true })
const shots = []

try {
  for (const width of [1440, 390]) {
    for (const theme of ["dark", "light"]) {
      const label = `${width} ${theme}`
      const context = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 900 } })
      // The viewer's theme comes from localStorage, not from prefers-color-scheme: colorScheme alone
      // left every "light" pass rendering the dark Threads values.
      await context.addInitScript((value) => localStorage.setItem("pi-viewer-theme", value), theme)
      const page = await context.newPage()
      const errors = []
      page.on("console", (message) => message.type() === "error" && errors.push(message.text()))
      page.on("pageerror", (error) => errors.push(String(error)))
      await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url())
        const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
        if (url.pathname === "/api/sessions") return json({ sessions: [{ name: SESSION, agents, capturedAt: Date.now() }], capturedAt: Date.now() })
        if (url.pathname !== "/api/thread") return route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
        const meta = { session: SESSION, version: "v1", agents, capturedAt: Date.now() }
        if (url.searchParams.get("meta") === "1") return json(meta)
        return json({ ...meta, events, cursor: events.length, revision: "r1", hasEarlier: false, earlier: null, earlierTurns: 0 })
      })
      await page.goto(`${base}/?s=${SESSION}`, { waitUntil: "domcontentloaded" })
      await page.locator("[data-composer-input]").waitFor({ state: "visible" })
      await page.waitForTimeout(300)

      // 1. One empty row, and the box still grows with content.
      const empty = await read(page)
      // Operator, 2026-11-26: one text row, 56px high: 16/24 text in a 4px-padded column, 12px row inset.
      assert.ok(Math.abs(empty.box - 56) <= 1, `${label}: the empty box is 56px high (${empty.box}px)`)
      assert.equal(empty.line, 24, `${label}: the prompt line is 24px high (line ${empty.line}px)`)
      assert.equal(empty.promptSize, "16px", `${label}: the prompt text is 16px (${empty.promptSize})`)
      assert.ok(Math.abs(empty.sendBottomGap - 12) <= 1, `${label}: one line: send sits 12px above the box's bottom (gap ${empty.sendBottomGap}px)`)
      assert.equal(empty.underInsideBox, false, `${label}: the under-row sits outside the box`)
      assert.ok(empty.underTop >= empty.boxBottom, `${label}: the under-row is below the box (${empty.underTop} < ${empty.boxBottom})`)
      await page.locator("[data-composer-input]").fill("one\ntwo\nthree")
      await page.waitForTimeout(150)
      const grown = await read(page)
      assert.ok(grown.box > empty.box + empty.line, `${label}: the box grows with content (${empty.box} -> ${grown.box})`)
      // Anchored to the last line when it grows: the same 12px gap below the button in both states.
      assert.ok(Math.abs(grown.sendBottomGap - 12) <= 1, `${label}: send stays anchored to the last line as the box grows (gap ${grown.sendBottomGap}px)`)
      // Past the height cap the text scrolls inside its own column: it never reaches the box's bottom inset or
      // runs under the send button (operator, 2026-11-26).
      await page.locator("[data-composer-input]").fill(Array.from({ length: 30 }, (_, i) => `line ${i + 1} with enough words to read as a real message`).join("\n"))
      await page.waitForTimeout(150)
      const full = await read(page)
      assert.equal(full.inputScrolls, true, `${label}: a long message scrolls inside the text column`)
      assert.ok(full.inputBottomGap >= 11.5, `${label}: the text column ends at the 12px bottom inset (gap ${full.inputBottomGap}px)`)
      assert.ok(full.inputToSend >= 7.5, `${label}: the text column ends 8px before the send button (${full.inputToSend}px)`)
      assert.ok(Math.abs(full.sendBottomGap - 12) <= 1, `${label}: send keeps its 12px gap at the height cap (gap ${full.sendBottomGap}px)`)
      assert.ok(full.box <= 13 * 16 + 24 + 1, `${label}: the box stops growing at the cap (${full.box}px)`)
      await page.locator("[data-composer-input]").fill("")
      await page.waitForTimeout(150)

      // 2. No visible border at rest: a fill step, or a hairline at most barely visible. Nothing may
      //    hold focus here, or the reading is the focus ring (that was the "hairline 0.18" false alarm).
      await page.evaluate(() => document.querySelector("[data-composer-input]")?.blur())
      await page.waitForTimeout(200)
      const rest = await read(page)
      const restAlpha = shadowAlpha(rest.shadow)
      const step = rest.fill !== rest.canvas
      const want = theme === "dark"
        ? { canvas: "rgb(13, 13, 13)", fill: "rgb(21, 21, 21)" }
        : { canvas: "rgb(244, 244, 245)", fill: "rgb(255, 255, 255)" }
      assert.equal(rest.canvas, want.canvas, `${label}: the ${theme} Threads canvas is applied (${rest.canvas})`)
      assert.equal(rest.fill, want.fill, `${label}: the ${theme} composer fill is applied (${rest.fill})`)
      assert.equal(step, true, `${label}: the fill is a step up from the canvas`)
      assert.ok(restAlpha <= 0.09, `${label}: the rest state carries no visible hairline (alpha ${restAlpha})`)

      // 3. Focus draws the ring, and the ring is the only border the box ever shows.
      await page.locator("[data-composer-input]").click()
      await page.waitForTimeout(300)
      const focused = await read(page)
      assert.equal(focused.focused, true, `${label}: the input takes focus`)
      assert.ok(shadowAlpha(focused.shadow) >= 0.15, `${label}: focus draws its ring (alpha ${shadowAlpha(focused.shadow)})`)

      // 4. Send sits in the text row, inside the box.
      assert.equal(focused.controlsInsideBox, true, `${label}: the controls sit inside the box`)
      assert.equal(focused.sendInsideBox, true, `${label}: send sits inside the box's bottom-right`)

      // 4b. Send geometry (XTRM-1056): a 32px hit area around a 16px glyph, centred on the text line,
      //     with its right inset equal to the text's left inset.
      assert.equal(focused.sendW, 32, `${label}: the send hit area is 32px wide (${focused.sendW})`)
      assert.equal(focused.sendH, 32, `${label}: the send hit area is 32px high (${focused.sendH})`)
      assert.equal(focused.glyph, 16, `${label}: the send glyph is 16px (${focused.glyph})`)
      assert.ok(Math.abs(focused.sendCentre - focused.lineCentre) <= 1, `${label}: send is centred on the text line (${focused.sendCentre} vs ${focused.lineCentre})`)
      assert.ok(Math.abs(focused.sendRightInset - focused.textLeftInset) <= 1, `${label}: send's right inset equals the text's left inset (${focused.sendRightInset} vs ${focused.textLeftInset})`)

      // 5. The under-row: right-aligned, the target, its model, its bare effort at 13px, 12px apart.
      // The selector is the only under-row button with aria-expanded: when the menu is open its rows
      // also live inside [data-composer-target-meta] and come first in the DOM (XTRM-1056 follow-up).
      const to = page.locator("[data-composer-under-row] button[aria-expanded]")
      const pick = async (name) => {
        await to.click()
        await page.locator("[data-composer-menu] button", { hasText: name }).click()
        await page.waitForTimeout(150)
      }
      await pick(PI.name)
      const pi = await read(page)
      assert.ok(pi.selectorText?.includes(PI.name), `${label}: the selector names the target (${pi.selectorText})`)
      assert.equal(pi.model, "anthropic/claude-sonnet-4-5", `${label}: the model shows`)
      assert.equal(pi.effort, "high", `${label}: the effort shows as the bare level`)
      assert.equal(pi.selectorSize, "14px", `${label}: the selector reads at 14px`)
      assert.equal(pi.modelSize, "14px", `${label}: the model reads at 14px`)
      assert.equal(pi.effortSize, "14px", `${label}: the effort reads at 14px`)
      // 6. The under-row's right edge meets the send button's right edge, not the box's outer edge.
      assert.ok(Math.abs(pi.underRight - (pi.boxRight - pi.sendRightInset)) <= 1, `${label}: the under-row ends at the send's right edge (${pi.underRight} vs ${Math.round((pi.boxRight - pi.sendRightInset) * 10) / 10})`)
      // On a narrow viewport the row's own width nearly fills the lane, so the right edge is the test.
      if (width >= 700) {
        assert.ok(pi.groupLeft > pi.boxLeft + (pi.boxRight - pi.boxLeft) / 2, `${label}: the row starts in the right half (${pi.groupLeft})`)
      }
      assert.ok(pi.gap !== null && pi.gap >= 11 && pi.gap <= 13, `${label}: items sit 12px apart (${pi.gap}px)`)

      await pick(CLAUDE.name)
      const claude = await read(page)
      assert.equal(claude.model, "claude-opus-4-5", `${label}: a Claude target shows its model`)
      assert.equal(claude.effort, null, `${label}: a target without an effort in the transcript shows the model alone`)
      await pick(PI.name)

      // 7. The @-menu keeps the arrow-key highlight: keyup re-reads the mention and must not reset it
      // to the first row (operator, 2026-11-26).
      const input = page.locator("[data-composer-input]")
      await input.fill("")
      await input.pressSequentially("@")
      const active = () =>
        page.evaluate(() => [...document.querySelectorAll("[data-composer-menu] button")].findIndex((row) => row.classList.contains("bg-pressed")))
      assert.equal(await active(), 0, `${label}: @ opens the menu on the first agent`)
      await input.press("ArrowDown")
      assert.equal(await active(), 1, `${label}: ArrowDown moves to the second agent and stays there`)
      await input.press("ArrowUp")
      assert.equal(await active(), 0, `${label}: ArrowUp moves back to the first agent`)
      await input.press("ArrowUp")
      assert.equal(await active(), agents.length - 1, `${label}: ArrowUp on the first agent wraps to the last`)
      await input.press("Escape")
      await input.fill("")

      assert.deepEqual(errors, [], `${label}: no console error`)
      shots.push(`${label}: box ${empty.box}px, prompt ${pi.promptSize}, send ${pi.sendW}x${pi.sendH} glyph ${pi.glyph}, send centre ${pi.sendCentre} vs line ${pi.lineCentre}, under-row right ${pi.underRight} vs send right ${Math.round((pi.boxRight - pi.sendRightInset) * 10) / 10}, fill ${rest.fill} on ${rest.canvas}, rest hairline ${restAlpha}, focus ring ${shadowAlpha(focused.shadow)}`)
      await context.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}

console.log(`composer-check: ok\n${shots.join("\n")}`)
