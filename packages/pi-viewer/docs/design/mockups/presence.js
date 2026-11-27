// Working presence mockups (XTRM-1026). Static frames built from one data model so the desktop and
// mobile pages draw the same states. No network, no app code.
;(function () {
  const params = new URLSearchParams(location.search)
  const theme = params.get("theme")
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme

  const P = {
    up: '<path d="m18 15-6-6-6 6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    term: '<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2"/>',
    brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>',
    alert: '<circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
    msg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    pane: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  }
  const ic = (name, cls = "") => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name]}</svg>`

  const A = {
    wd: { full: "xtrm-xt-claude-working-design", short: "working-design", mark: "de", role: "worker", step: "Read", what: "src/lib/thread.ts", el: "1m 28s", tools: 17, steps: 21, failed: 2, model: "claude-opus-5-5 · thinking high", place: "xx · window 3 · pane %105", cwd: "~/dev/xtrm/.xtrm/worktrees/xtrm-xt-claude-working-design" },
    au: { full: "xtrm-xt-claude-t3-audit", short: "t3-audit", mark: "au", role: "worker", step: "Searched", what: "--x-accent in styles.css", el: "1m 49s" },
    i1: { full: "xtrm-xt-pi-i1wb", short: "i1wb", mark: "i1", role: "", step: "Ran", what: "npm test -- ordering", el: "1m 32s" },
    ad: { full: "xtrm-xt-claude-xtrm-1020-claude-adapter", short: "xtrm-1020-claude-adapter", mark: "ad", role: "worker", step: "Edited", what: "server/claude.ts", el: "18s" },
    dz: { full: "xtrm-xt-pi-dz18", short: "dz18", mark: "dz", role: "", step: "Thought", what: "about the merge order", el: "42s" },
    hy: { full: "core-xt-pi-9hym", short: "9hym", mark: "9h", role: "worker", step: "Ran", what: "make ci-light", el: "4m 10s" },
    tl: { full: "xtrm-xt-claude-thread-lead", short: "thread-lead", mark: "le", role: "lead" },
  }

  // ---------- timeline pieces ----------
  const turn = (a, time, text, disc, extra = "") => `
    <div class="turn ${extra}">
      <div class="mark">${a.mark}</div>
      <div class="body">
        <div class="meta"><span class="name trunc">${a.full}</span>${a.role ? `<span class="txs faint">${a.role}</span>` : ""}<span class="dot ${extra.includes("stopped") ? "idle" : "ok"}"></span><span class="t2xs faint">${time}</span></div>
        ${text}
        <div class="disc txs">${ic("right")}<span>${disc}</span></div>
      </div>
    </div>`
  const user = (text, to, time) => `
    <div class="user"><div class="bubble">${text}</div><div class="t2xs faint">${time} · to ${to}</div></div>`
  const history = (between = "") =>
    turn(A.dz, "12:31", `<p>Merge order settled: i1wb first, then the adapter branch. No conflicts in <span class="mono txs">server/api.ts</span>.</p>`, "8 steps · 6 tools · 1m 12s") +
    between +
    turn(A.tl, "12:58", `<p>Integration is verified at <span class="mono txs">80aec099</span>. Typecheck 0, tests 87/87, build ok. The single dev server stays on :5199.</p>`, "12 steps · 9 tools · 3m 10s") +
    user("Design the working presence for the combined thread. Report the recommendation to me.", "working-design", "13:00")
  const settledReply = (a, time, text, disc) => turn(a, time, `<p>${text}</p>`, disc)

  // ---------- presence line ----------
  const marks = (list, max = 3) =>
    `<span class="marks">${list.slice(0, max).map((a) => `<span class="mark sm">${a.mark}</span>`).join("")}</span>` +
    (list.length > max ? `<span class="txs faint">+${list.length - max}</span>` : "")
  function lineText(list, mobile, attention) {
    const n = list.length
    if (attention) {
      const rest = n - 1
      return mobile
        ? `<span class="who">${attention.short}</span>&nbsp;needs you${rest ? ` · +${rest}` : ""}`
        : `<span class="who">${attention.short}</span>&nbsp;needs you · permission: Bash${rest ? ` · ${rest} ${rest === 1 ? "other" : "others"} working` : ""}`
    }
    if (n === 1) {
      const a = list[0]
      return mobile
        ? `<span class="who trunc">${a.short}</span><span class="trunc">&nbsp;· ${a.step} ${a.what.split("/").pop()}</span><span class="tab faint">&nbsp;· ${a.el}</span>`
        : `<span class="who">${a.short}</span>&nbsp;is working<span class="trunc">&nbsp;· ${a.step} ${a.what}</span><span class="tab faint">&nbsp;· ${a.el}</span>`
    }
    if (mobile) return `<span>${n} working</span>`
    if (n === 2) return `<span class="who">${list[0].short}</span>&nbsp;and&nbsp;<span class="who">${list[1].short}</span>&nbsp;are working<span class="tab faint">&nbsp;· ${list[1].el}</span>`
    if (n === 3) return `<span class="trunc"><span class="who">${list[0].short}</span>, <span class="who">${list[1].short}</span> and <span class="who">${list[2].short}</span> are working</span>`
    return `<span>${n} agents are working</span>`
  }
  function presence(list, { mobile = false, attention = null, state = "", note = false } = {}) {
    if (!list.length) {
      return `<div class="presence empty ${note ? "reserved" : ""}" aria-hidden="true"></div>`
    }
    const dot = attention ? '<span class="dot attn"></span>' : '<span class="dot work"></span>'
    const who = attention ? [attention, ...list.filter((a) => a !== attention)] : list
    return `<div class="presence live ${state} txs" role="button" aria-expanded="${state === "open"}">${dot}${marks(who)}<span class="row grow">${lineText(who, mobile, attention)}</span><span class="chev">${ic(state === "open" ? "down" : "up")}</span></div>`
  }
  const composer = (to = "working-design", mobile = false) => `
    <div class="composer">
      <div class="ta tsm">Message ${to}…</div>
      <div class="bar t2xs"><span>To</span><span class="dot ok"></span><span class="muted">${to}</span>${ic("down")}
        ${mobile ? "" : '<span style="margin-left:auto">@ to mention · Shift+Enter for a new line</span>'}
        <span class="send" ${mobile ? "" : 'style="margin-left:12px"'}>${ic("send", "md")}</span></div>
    </div>`

  // ---------- panel rows and detail ----------
  function prow(a, { sel = false, attention = false, quiet = false } = {}) {
    const dot = attention ? "attn" : quiet ? "quiet" : "work"
    const step = attention
      ? `<span class="accent">needs you</span><span class="faint">&nbsp;· permission: Bash rm -rf dist</span>`
      : `<span class="muted">${a.step}</span><span class="faint trunc">&nbsp;${a.what}</span>`
    const el = quiet ? `<span class="faint">quiet 16m</span>` : `<span class="faint tab">${a.el}</span>`
    return `<div class="prow txs ${sel ? "sel" : ""}"><span class="dot ${dot}"></span><span class="mark sm">${a.mark}</span><span class="nm trunc ink">${a.short}</span><span class="role faint">${a.role}</span><span class="step row">${step}</span><span class="el">${el}</span><span class="chev">${ic("right")}</span></div>`
  }
  function mrow(a, { attention = false, quiet = false } = {}) {
    const dot = attention ? "attn" : quiet ? "quiet" : "work"
    const line2 = attention ? `<span class="accent">needs you</span> · permission: Bash` : `${a.step} ${a.what}`
    const el = quiet ? "quiet 16m" : a.el
    return `<div class="mrow"><span class="dot ${dot}"></span><span class="mark sm">${a.mark}</span><span class="two"><span class="tsm ink trunc">${a.short}</span><span class="t2xs faint trunc">${a.role ? a.role + " · " : ""}${line2}</span></span><span class="t2xs faint tab">${el}</span><span class="faint">${ic("right")}</span></div>`
  }
  const panelList = (rows, n) => `
    <div class="panel" role="dialog" aria-label="Working agents">
      <div class="ph t2xs"><span>Working · ${n}</span><span class="x"><span class="kbd">↑↓</span><span class="kbd">Enter</span><span class="kbd">Esc</span><span class="ghost txs">Close</span></span></div>
      ${rows.join("")}
    </div>`
  const activity = () => `
    <div class="acts">
      <div class="t2xs faint" style="padding:4px 0">Live activity · newest last</div>
      <div class="act txs"><span class="faint">${ic("brain")}</span><span class="lb muted">Thought</span><span class="faint trunc">Two settles in one poll append in anchor order…</span><span class="chev">${ic("right")}</span></div>
      <div class="act txs"><span class="faint">${ic("wrench")}</span><span class="lb muted">Read</span><span class="faint trunc">src/components/ChannelView.tsx</span><span class="chev">${ic("right")}</span></div>
      <div class="act txs"><span class="danger">${ic("alert")}</span><span class="lb danger">Ran</span><span class="faint trunc">ls ../../node_modules/playwright*</span><span class="chev">${ic("right")}</span></div>
      <div class="act txs"><span class="faint">${ic("term")}</span><span class="lb muted">Ran</span><span class="faint trunc">node shot.cjs 'http://127.0.0.1:5199/?s=xx&amp;w=3'</span><span class="chev" style="transform:rotate(90deg)">${ic("right")}</span></div>
      <div class="io"><div class="code">/…/live-w3-1440.png scroll/client 1440/1440 errors 0</div></div>
      <div class="act run txs"><span class="faint">${ic("wrench")}</span><span class="lb">Read</span><span class="faint trunc">src/lib/thread.ts</span><span class="t2xs fade accent" style="margin-left:6px">running</span><span class="chev">${ic("right")}</span></div>
    </div>`
  function detail(a, mobile) {
    return `
      <div class="dhead">
        <span class="ghost txs">${ic("left")}${mobile ? "" : "Back"}</span>
        <span class="mark sm">${a.mark}</span>
        <span class="tsm ink trunc grow" title="${a.full}">${a.full}</span>
        <span class="dot work"></span><span class="txs muted">working</span>
      </div>
      <div class="row" style="gap:4px;padding:6px 4px 0">
        <span class="ghost txs">${ic("msg")} Message</span><span class="ghost txs">${ic("pane")} Open pane</span>
      </div>
      <div class="grid txs">
        <span class="k">Status</span><span class="muted">working · running tools</span>
        <span class="k">Turn</span><span class="muted tab">started 13:01:22 · ${a.el}</span>
        <span class="k">Steps</span><span class="muted">${a.steps} steps · ${a.tools} tools · <span class="danger">${a.failed} failed</span></span>
        <span class="k">Model</span><span class="muted">${a.model}</span>
        <span class="k">Place</span><span class="muted">${a.place}</span>
        <span class="k">Directory</span><span class="muted mono trunc">…/worktrees/xtrm-xt-claude-working-design</span>
      </div>
      ${activity()}`
  }

  // ---------- frames ----------
  const sidebar = () => `
    <aside class="side txs">
      <div class="h"><span>Sessions</span><span>14</span></div>
      <div class="n">${ic("down")}<span class="ink">xx</span><span class="c">14</span></div>
      <div class="n l2">${ic("right")}<span>xt-reap</span><span class="c">3</span></div>
      <div class="n l2 sel">${ic("down")}<span>thread-lead</span><span class="c">5</span></div>
      ${["thread-lead", "working-design", "t3-audit", "i1wb", "xtrm-1020-claude-adapter"].map((n, i) => `<div class="n l3"><span class="trunc">${n}</span><span class="c"><span class="dot ${i === 0 ? "ok" : "work"}"></span></span></div>`).join("")}
      <div class="n l2">${ic("right")}<span>dz18</span><span class="c">2</span></div>
    </aside>`
  function desktop({ thread, line, panel = "", main = "", notes = "", right = "", title = "thread-lead", detail = "xx · window 3 · 5 agents" }) {
    return `
      <div class="frame desktop">
        ${sidebar()}
        <div class="main">
          <div class="hdr"><span class="title tsm">${title}</span><span class="t2xs faint">${detail}</span><span class="seg txs"><span class="on">Channel</span><span>All events</span></span></div>
          ${main || `<div class="scroll"><div class="col"><div class="thread">${thread}</div></div></div>
          <div class="dock"><div class="col">${panel}${line}${composer()}</div></div>`}
        </div>
        ${right}
        ${notes}
      </div>`
  }
  function mobileFrame({ thread, line, overlay = "", notes = "" }) {
    return `
      <div class="frame mobile">
        <div class="hdr"><span class="faint">${ic("pane", "md")}</span><span class="title tsm">thread-lead</span><span class="t2xs faint">window 3 · 5</span></div>
        <div class="scroll"><div class="col"><div class="thread">${thread}</div></div></div>
        <div class="dock"><div class="col">${line}${composer("working-design", true)}</div></div>
        ${overlay}
        ${notes}
      </div>`
  }
  const note = (top, left, text) => `<div class="note" style="top:${top}px;left:${left}px">${text}</div>`

  const desktopFrames = [
    ["D1", "N = 0", "Nobody is running. The 28px line stays reserved (dashed outline drawn only here), so the thread height never changes at 0 → 1.",
      desktop({ thread: history(), line: presence([], { note: true }), notes: note(470, 1000, "reserved 28px, empty, aria-hidden") })],
    ["D2", "N = 1 (also the pane scope)", "One agent: name, current step and elapsed time on one line. No pending row in the thread.",
      desktop({ thread: history(), line: presence([A.wd]) })],
    ["D3", "N = 2", "Two names joined by “and”, the longest elapsed time. Same height.",
      desktop({ thread: history(), line: presence([A.wd, A.au]) })],
    ["D4", "N = 3", "Three names, no step, no time. Same height.",
      desktop({ thread: history(), line: presence([A.wd, A.au, A.i1]) })],
    ["D5", "N = 6", "Three monograms, +3 as plain text, a count. Same height for any N.",
      desktop({ thread: history(), line: presence([A.wd, A.au, A.i1, A.ad, A.dz, A.hy]) })],
    ["D6", "Needs attention", "An agent on a permission prompt (proposed server signal) sorts first; accent dot without pulse plus the words “needs you”.",
      desktop({ thread: history(), line: presence([A.wd, A.au, A.i1, A.ad], { attention: A.i1 }) })],
    ["D7", "Expanded: agent list", "Click, Enter or Space on the line. Floating panel above the line (the composer menu layer); it overlays the thread and pushes nothing. Tree order, attention first. Row 4 is quiet (no output for 16m).",
      desktop({ thread: history(), line: presence([A.wd, A.au, A.i1, A.ad], { attention: A.i1, state: "open" }),
        panel: panelList([prow(A.i1, { attention: true }), prow(A.wd, { sel: true }), prow(A.au), prow(A.ad, { quiet: true })], 4) })],
    ["D8", "One agent: live tools and metadata", "Enter or → on a row. Metadata grid from data the viewer has today; the live activity list reuses ActivityRow, newest last, rows expand to input and output.",
      desktop({ thread: history(), line: presence([A.wd, A.au, A.i1, A.ad], { attention: A.i1, state: "open" }),
        panel: `<div class="panel" role="dialog" aria-label="working-design">${detail(A.wd, false)}</div>` })],
    ["D9", "Option A (not recommended): slim inline rows", "One 32px row per agent at the timeline tail, inside the scroller. Four agents = 128px; the block still shifts on settle and scrolls away.",
      desktop({ thread: history() + [A.wd, A.au, A.i1, A.ad].map((a) => `<div class="slim txs"><span class="dot work"></span><span class="mark sm">${a.mark}</span><span class="ink">${a.short}</span><span class="muted">${a.step}</span><span class="faint trunc">${a.what}</span><span class="faint tab" style="margin-left:auto">${a.el}</span>${ic("right")}</div>`).join(""),
        line: "" })],
    ["D10", "Option C (not recommended): typing line in the thread + inspector", "The line is the last item in the scroller, so it scrolls away when reading history; one agent opens in a new right-hand inspector.",
      desktop({ thread: history() + `<div class="presence live txs open" style="margin:0"><span class="dot work"></span>${marks([A.wd, A.au, A.i1, A.ad])}<span>4 agents are working</span><span class="chev">${ic("right")}</span></div>`,
        line: "", right: `<aside class="inspector">${detail(A.wd, false)}</aside>` })],
    ["D11", "Settle, before", "t3-audit and working-design are running; the operator is at the end of the thread. The thread holds settled rows only.",
      desktop({ thread: history(), line: presence([A.wd, A.au]), notes: note(500, 1230, "line: 2 names, 28px") })],
    ["D12", "Settle, after", "t3-audit settled: its reply is appended after the newest row (fade-in, opacity only). Rows above keep their order and their offset in the scroll content; the pinned scroller scrolls by the new row's height. The line loses one name and keeps its height.",
      desktop({ thread: history() + settledReply(A.au, "13:03", "Token table committed in t3code-chat-audit.md §1. Its working indicator is a ticking “Working for 1m 03s” row; there is no spinner.", "14 steps · 11 tools · 2m 31s").replace('class="turn "', 'class="turn newturn"'),
        line: presence([A.wd]), notes: note(390, 1230, "appended row (fade-in)") + note(500, 1230, "line: 1 name, 28px") })],
    ["D13", "Stale turn: stopped without a reply", "The agent's status is idle · turn interrupted, but its turn never got a final reply. It leaves presence and becomes a timeline row anchored at its last activity (12:41), so it sorts before the 12:58 and 13:00 rows.",
      desktop({ thread: history(turn(A.dz, "12:41", `<div class="txs faint">Stopped without a reply · turn interrupted</div>`, "9 steps · 7 tools · 6m 02s", "stopped")),
        line: presence([A.wd]) })],
  ]

  const mobileFrames = [
    ["M1", "N = 1, 390", "32px line above the composer. Short name, step, time.",
      mobileFrame({ thread: history(), line: presence([A.wd], { mobile: true }) })],
    ["M2", "N = 3, 390", "Monograms plus a count. Same 32px.",
      mobileFrame({ thread: history(), line: presence([A.wd, A.au, A.i1], { mobile: true }) })],
    ["M3", "Needs attention, 390", "Attention first, “needs you · +N”.",
      mobileFrame({ thread: history(), line: presence([A.wd, A.au, A.i1], { mobile: true, attention: A.i1 }) })],
    ["M4", "Sheet: agent list, 390", "Tap opens a bottom sheet over a scrim; 44px rows, second line at 2xs. Closed by scrim, Escape, back gesture or Close.",
      mobileFrame({ thread: history(), line: presence([A.wd, A.au, A.i1, A.ad], { mobile: true, attention: A.i1, state: "open" }),
        overlay: `<div class="scrim"></div><div class="sheet"><div class="grab"></div><div class="ph t2xs row" style="padding:0 10px 6px;color:var(--x-ink-faint)"><span>Working · 4</span><span class="ghost txs" style="margin-left:auto">Close</span></div>${mrow(A.i1, { attention: true })}${mrow(A.wd)}${mrow(A.au)}${mrow(A.ad, { quiet: true })}</div>` })],
    ["M5", "Sheet: one agent, 390", "Tap a row: detail replaces the list in the sheet, with a back control.",
      mobileFrame({ thread: history(), line: presence([A.wd, A.au, A.i1, A.ad], { mobile: true, attention: A.i1, state: "open" }),
        overlay: `<div class="scrim"></div><div class="sheet" style="max-height:82%;overflow:hidden"><div class="grab"></div>${detail(A.wd, true)}</div>` })],
    ["M6", "N = 0, 390", "Reserved, empty line (dashed outline drawn only here).",
      mobileFrame({ thread: history(), line: presence([], { note: true, mobile: true }) })],
  ]

  function render(kind) {
    const root = document.getElementById("frames")
    const frames = kind === "desktop" ? desktopFrames : mobileFrames
    root.innerHTML = frames
      .map(([id, name, why, html]) => `<section id="${id}"><div class="cap txs"><span class="id">${id}</span><b>${name}</b><span class="why">${why}</span></div>${html}</section>`)
      .join("")
    const t = document.documentElement.dataset.theme || "system"
    document.querySelectorAll("[data-theme-link]").forEach((link) => {
      if (link.dataset.themeLink === t) link.setAttribute("aria-current", "page")
    })
  }
  window.renderPresence = render
})()
