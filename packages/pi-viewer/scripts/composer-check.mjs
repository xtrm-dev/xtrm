// Composer browser check (XTRM-1054).
//
// Runs the app in-process with a mocked API (its own port, stopped at the end) and, for 1440 and 390
// wide, dark and light, asserts the Claude-Desktop-shaped composer:
// - an empty composer reserves ONE text row (the input is one line high) and still grows with content;
// - the To selector sits in a row BELOW the box, outside it;
// - the box carries no visible border at rest: a fill one step from the canvas, or at most a
//   barely visible hairline; focus alone draws the ring (>= 0.15 alpha, inset);
// - the under-row shows the target's model and thinking effort, one text step below the prompt
//   (13px against 14px), updates with the target, and omits what the runtime does not report;
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
      // Rev 2: one text row, and the empty box is 40px high (14/20 text, py-2.5).
      assert.ok(Math.abs(empty.box - 40) <= 1, `${label}: the empty box is 40px high (${empty.box}px)`)
      assert.equal(empty.line, 20, `${label}: body text is 14/20 (line ${empty.line}px)`)
      assert.equal(empty.underInsideBox, false, `${label}: the under-row sits outside the box`)
      assert.ok(empty.underTop >= empty.boxBottom, `${label}: the under-row is below the box (${empty.underTop} < ${empty.boxBottom})`)
      await page.locator("[data-composer-input]").fill("one\ntwo\nthree")
      await page.waitForTimeout(150)
      const grown = await read(page)
      assert.ok(grown.box > empty.box + empty.line, `${label}: the box grows with content (${empty.box} -> ${grown.box})`)
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

      // 4. The inner controls row: attach slot empty on the left, send on the right, both inside the box.
      assert.equal(focused.controlsInsideBox, true, `${label}: the controls row sits inside the box`)
      assert.equal(focused.attachEmpty, true, `${label}: the attach slot is present and empty`)
      assert.equal(focused.sendInsideBox, true, `${label}: send sits inside the box's bottom-right`)

      // 5. The under-row: right-aligned, the target, its model, its bare effort at 13px, 12px apart.
      const to = page.locator("[data-composer-under-row] button").first()
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
      assert.equal(pi.selectorSize, "13px", `${label}: the selector reads at the 13px step`)
      assert.equal(pi.modelSize, "13px", `${label}: the model reads at the 13px step`)
      assert.equal(pi.effortSize, "13px", `${label}: the effort reads at the 13px step`)
      assert.equal(pi.promptSize, "14px", `${label}: the prompt stays at 14px`)
      assert.ok(pi.groupRight >= pi.boxRight - 8, `${label}: the row is right-aligned (group right ${pi.groupRight} vs box right ${pi.boxRight})`)
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

      assert.deepEqual(errors, [], `${label}: no console error`)
      shots.push(`${label}: box ${empty.box}px, fill ${rest.fill} on ${rest.canvas}, rest hairline ${restAlpha}, focus ring ${shadowAlpha(focused.shadow)}, row gap ${pi.gap}px`)
      await context.close()
    }
  }
} finally {
  await browser.close()
  await server.close()
}

console.log(`composer-check: ok\n${shots.join("\n")}`)
