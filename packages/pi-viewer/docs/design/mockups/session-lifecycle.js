// Session lifecycle mockups (XTRM-1078). Static frames; frame ids match
// docs/design/xtrm-1078-session-lifecycle.md. No application code.
const P = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>',
  sidebar: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  branch: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 8v8M18 10c0 4-6 3-10 6"/>',
  enter: '<path d="M20 4v7a4 4 0 0 1-4 4H4"/><path d="m9 10-5 5 5 5"/>',
  split: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  session: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  move: '<path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
}
const i = (n, s = 14) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`

// ---- sidebar -------------------------------------------------------------
const PANES = {
  lead: { name: "thread-lead", role: "Lead", rt: "Claude", repo: "xtrm", st: "run", lead: true },
  w1: { name: "sessiondesign", role: "Worker", rt: "Claude", repo: "xtrm", st: "run" },
  w2: { name: "viewer-gate", role: "Test-runner", rt: "Pi", repo: "xtrm", st: "idle" },
  w3: { name: "board-helper", role: "Board-helper", rt: "Claude", repo: "mercury", st: "idle" },
  mgr: { name: "manager", role: "Manager", rt: "Claude", repo: "mercury", st: "idle", mgr: true },
}
function pane(p, ind, cls = "") {
  const role = p.lead ? `<span class="lead">${p.role}</span>` : p.mgr ? `<span class="b" style="color:var(--x-role-manager-ink)">${p.role}</span>` : `<span class="role">${p.role}</span>`
  return `<div class="row p ${cls}" style="padding-left:${8 + ind * 12}px"><div style="min-width:0;flex:1"><div class="tsm ink">${p.name}</div>
  <div class="l2">${role}<span>${p.rt}</span><span style="display:inline-flex;gap:2px;align-items:center">${i("folder", 10)}${p.repo}</span></div></div><span class="dot ${p.st}"></span></div>`
}
const group = (name, n, ind, session, cls = "") =>
  `<div class="row g ${cls}" style="padding-left:${8 + ind * 12}px"><span class="tsm ${session ? "b ink" : "m muted"}">${name}</span><span class="chev">${i("down", 12)}</span><span class="cnt">${n}</span></div>`
const draftRow = (ind, label) =>
  `<div class="row p draft" style="padding-left:${8 + ind * 12}px"><div style="min-width:0;flex:1"><div class="tsm muted">${label}</div><div class="l2"><span>Draft</span></div></div><span class="dot draft"></span></div>`

function sidebar(o = {}) {
  const c = o.ctx || ""
  return `<aside class="side">
  <div class="hdr"><div class="seg"><span>Work</span><span class="on">Agents</span></div><span class="ib" style="margin-left:auto">${i("sidebar")}</span></div>
  <div class="sh ${c === "hdr" ? "row ctx" : ""}" style="${c === "hdr" ? "margin:0 4px;height:32px;padding-left:8px" : ""}"><h2 class="tsm m ink" style="margin:0">Sessions</h2><span class="txs faint">5</span>
    <span class="ib plus ${o.plus ? "on" : ""}" style="${o.plus ? "" : "opacity:.0"}">${i("plus")}</span></div>
  <div class="tree">
    ${group("xx", 4, 0, true, c === "sess" ? "ctx" : "")}
    ${o.draft === "sess" ? draftRow(1, "New window") : ""}
    ${pane(PANES.lead, 1, o.sel === "lead" ? "sel" : "")}
    ${o.moved ? "" : group("workers", 2, 1, false, c === "win" ? "ctx" : "")}
    ${pane(PANES.w1, o.moved ? 1 : 2, (o.sel === "w1" ? "sel " : "") + (c === "w1" ? "ctx" : "") + (o.flash === "w1" ? " flash" : ""))}
    ${o.moved ? "" : pane(PANES.w2, 2, c === "w2" ? "ctx" : "")}
    ${o.draft === "win" ? draftRow(2, "New thread") : ""}
    ${o.moved ? pane(PANES.w2, 1, "flash") : ""}
    ${group("mercury", 2, 0, true)}
    ${pane(PANES.mgr, 1)}
    ${pane(PANES.w3, 1)}
    ${o.draft === "new" ? group("new session", 0, 0, true) + draftRow(1, "New thread") : ""}
  </div></aside>`
}

// ---- main ----------------------------------------------------------------
function topbar(title, o = {}) {
  return `<div class="top"><span class="tsm b">${title}</span>${o.detail ? `<span class="t2xs faint">${o.detail}</span>` : ""}
  <div class="r"><div class="seg"><span class="on">Channel</span><span>All events</span></div><span class="ib">${i("sun")}</span>
  <span class="newbtn ${o.newOn ? "" : "ghost"}">${i("plus", 13)}New thread<span class="kbd">⇧⌘O</span></span></div></div>`
}
function threadBody() {
  return `<div class="thread"><div class="lane">
  <div class="bubble">Can you check the viewer gate on the private socket?</div>
  <div class="asst"><p>Gate passed at 1440 and 390, both themes. 28px rows, scopes and the URL round-trip are green.</p><p class="muted txs">thread-lead · 2m</p></div>
  </div></div>`
}
function messageComposer() {
  return `<div class="composer"><div class="lane"><div class="box"><div class="ta ph">Message thread-lead…</div><span class="send">${i("enter", 16)}</span></div>
  <div class="who"><span class="prev">@ to mention</span><span class="pick">thread-lead ${i("down", 12)}</span><span class="pick">claude-opus-5-5</span><span>high</span></div></div></div>`
}

const PLACE = {
  pane: ["Split", "xx › workers"],
  window: ["New window in", "xx"],
  session: ["New session", ""],
}
function draftComposer(o) {
  const [pk, pv] = PLACE[o.place]
  const sentence = {
    pane: "Adds a pane to <b>workers</b> in <b>xx</b>.",
    window: "Opens a new window in <b>xx</b>.",
    session: "Starts a new tmux session.",
  }[o.place]
  const argv = o.argv || {
    pane: "xt claude --role worker --issue XTRM-1078 --pane xx:workers --layout tiled --no-attach --json",
    window: "xt claude --role worker --window --session xx --no-attach --json",
    session: "xt claude --role worker --new-session --no-attach --json",
  }[o.place]
  const set = (k) => (o.set || []).includes(k) ? "set" : ""
  const locked = o.issuePrompt
  return {
    hero: `<div class="hero"><h2>New thread</h2><p>${sentence}</p></div>`,
    composer: `<div class="composer"><div class="lane" style="position:relative">
    ${o.pop || ""}
    <div class="where">
      <span class="pick set" data-k="place">${i(o.place === "pane" ? "split" : o.place === "window" ? "window" : "session", 13)}${pk}${pv ? ` <span class="m">${pv}</span>` : ""} ${i("down", 12)}</span>
      <span class="pick ${set("repo")}">${i("folder", 13)}xtrm <span class="mono txs faint">~/dev/xtrm</span> ${i("down", 12)}</span>
      <span class="pick ${set("wt")}">${i("branch", 13)}${o.wt || "New worktree"} <span class="txs faint">from origin/main</span> ${i("down", 12)}</span>
    </div>
    <div class="box"><div class="ta ${o.text ? "" : locked ? "locked" : "ph"}">${o.text || (locked ? "The issue is the prompt: XTRM-1078 renders as the first turn." : "Describe the task, or leave it empty to start idle")}</div>
      <span class="send">${o.busy ? '<span class="spin"></span>' : i("enter", 16)}</span></div>
    <div class="who">
      <span class="prev mono" title="click copies">${i("terminal", 11)}${argv}</span>
      <span class="pick ${set("rt")}">${o.rt || "Claude"} ${i("down", 12)}</span>
      <span class="pick ${set("role")}">${o.role || "worker"} ${i("down", 12)}</span>
      <span class="pick ${set("model")}">${o.model || '<span class="faint">claude-opus-5-5</span>'} ${i("down", 12)}</span>
      <span class="pick ${set("issue")}">${o.issue === false ? '<span class="faint">No issue</span>' : "XTRM-1078"} ${i("down", 12)}</span>
    </div></div></div>`,
  }
}

function desktop({ side, title, detail, body, composer, overlay = "", newOn }) {
  return `<div class="frame desktop">${side}<div class="main">${topbar(title, { detail, newOn })}${body}${composer}${overlay}</div></div>`
}
function draftFrame(o) {
  const d = draftComposer(o)
  return desktop({
    side: sidebar({ draft: o.place === "pane" ? "win" : o.place === "window" ? "sess" : "new", ctx: o.ctx }),
    title: "New thread", detail: o.place === "pane" ? "draft · xx › workers" : o.place === "window" ? "draft · xx" : "draft",
    body: `<div class="thread"><div class="lane">${d.hero}${o.card || ""}</div></div>`,
    composer: d.composer, overlay: o.overlay, newOn: o.newOn,
  })
}

// ---- menus ---------------------------------------------------------------
const mi = (label, o = {}) =>
  `<div class="mi ${o.hi ? "hi" : ""} ${o.dis ? "dis" : ""} ${o.dng ? "dng" : ""} ${o.on ? "on" : ""}">${o.icon ? `<span class="ico">${i(o.icon)}</span>` : ""}${label}${o.det ? `<span class="det">${o.det}</span>` : ""}${o.sub ? `<span class="det">${i("right", 12)}</span>` : ""}${o.ck ? `<span class="ck">${i("check", 13)}</span>` : ""}</div>`
const sep = '<div class="sep"></div>'

const MENU_PANE = (top, left, hiMove) => `<div class="pop" style="top:${top}px;left:${left}px;min-width:224px">
  ${mi("New thread beside", { icon: "split", det: "split workers" })}
  ${mi("Move to", { icon: "move", sub: true, hi: hiMove })}
  ${sep}${mi("Copy", { icon: "copy", sub: true })}
  ${sep}${mi("Close thread…", { icon: "trash", dng: true })}</div>`
const MENU_MOVE = (top, left) => `<div class="pop" style="top:${top}px;left:${left}px;min-width:236px">
  <div class="grp">xx</div>
  ${mi("thread-lead window", { icon: "window", det: "1 pane" })}
  ${mi("workers", { icon: "window", det: "current", dis: true })}
  ${mi("New window in xx", { icon: "plus", hi: true })}
  <div class="grp">mercury</div>
  ${mi("manager", { icon: "window", det: "1 pane" })}
  ${mi("board", { icon: "window", det: "1 pane" })}
  ${mi("New window in mercury", { icon: "plus" })}
  ${sep}${mi("New session", { icon: "session" })}</div>`

// ---- frames ----------------------------------------------------------------
const F = {}

F["F1"] = {
  t: "Pane row menu, Move to submenu", why: "Right-click, Shift+F10 or the ContextMenu key on a pane row. Danger item last, after a separator. Moves need no confirmation (Undo toast, F9).",
  html: () => desktop({ side: sidebar({ ctx: "w1", sel: "lead" }), title: "thread-lead", body: threadBody(), composer: messageComposer(),
    overlay: MENU_PANE(208, -40, true) + MENU_MOVE(208 + 40, 190) }).replace('<div class="main">', '<div class="main" style="overflow:visible">'),
}
F["F2"] = {
  t: "Header menus: Sessions header, session row, window row", why: "Entry points c, b, a. The + on the Sessions header appears on hover and focus. A disabled item keeps its reason.",
  html: () => {
    const sess = `<div class="pop" style="position:relative;display:inline-block;vertical-align:top;margin-right:24px">
      <div class="hd">Sessions</div>${mi("New session", { icon: "session", hi: true })}${sep}${mi("Collapse all")}${mi("Expand all")}</div>`
    const s = `<div class="pop" style="position:relative;display:inline-block;vertical-align:top;margin-right:24px;min-width:232px">
      <div class="hd">Session xx</div>${mi("New thread in new window", { icon: "window", hi: true })}${sep}${mi("Move window here", { icon: "move", sub: true })}${sep}${mi("Copy session name", { icon: "copy" })}</div>`
    const w = `<div class="pop" style="position:relative;display:inline-block;vertical-align:top;margin-right:24px;min-width:232px">
      <div class="hd">Window xx › workers</div>${mi("New thread in this window", { icon: "split", hi: true })}${mi("Move window to", { icon: "move", sub: true })}${sep}${mi("Copy target", { icon: "copy", det: "xx:2" })}</div>`
    const p = `<div class="pop" style="position:relative;display:inline-block;vertical-align:top;min-width:232px">
      <div class="hd">sessiondesign · working</div>${mi("New thread beside", { icon: "split" })}${mi("Move to", { icon: "move", sub: true })}${sep}${mi("Copy", { icon: "copy", sub: true })}${sep}${mi("Close thread…", { icon: "trash", dng: true, dis: true, det: "agent is working" })}</div>`
    return desktop({ side: sidebar({ ctx: "hdr", plus: true }), title: "thread-lead",
      body: `<div class="thread"><div class="lane" style="max-width:1080px;padding-top:40px">${sess}${s}${w}${p}<p class="txs faint" style="margin-top:18px">Four row kinds, one builder (menus.ts). Shown side by side here; in the app one menu opens at the pointer or at the row's bottom-left from the keyboard.</p></div></div>`,
      composer: messageComposer() })
  },
}
F["F3"] = {
  t: "Draft thread from a window row (entry a): placement picker open", why: "One component. Only the prefilled placement differs. Windows without agents are listed too. The command preview shows the exact argv.",
  html: () => draftFrame({ place: "pane", ctx: "", set: ["place"],
    pop: `<div class="pop" style="bottom:122px;left:0;width:300px;max-height:330px;overflow:hidden">
      <div class="search">${i("search", 13)}<span>Filter sessions and windows</span></div>
      ${mi("New session", { icon: "session" })}
      <div class="grp">xx</div>${mi("New window in xx", { icon: "plus" })}${mi("Split thread-lead window", { icon: "split" })}${mi("Split workers", { icon: "split", det: "2 panes", ck: true, hi: true })}${mi("Split scratch", { icon: "split", det: "no agent" })}
      <div class="grp">mercury</div>${mi("New window in mercury", { icon: "plus" })}${mi("Split manager", { icon: "split" })}</div>` }),
}
F["F4"] = {
  t: "Role picker: grouped, searchable, description on line 2", why: "From specialists list --json (36 roles). The model picker's placeholder follows the role's default model.",
  html: () => draftFrame({ place: "window", set: ["role"], role: "debugger", text: "The viewer's sidebar drops windows after a tmux restart; find out why",
    argv: "xt claude --role debugger --issue XTRM-1078 --window --session xx --prompt '…' --no-attach --json",
    pop: `<div class="pop" style="bottom:30px;right:150px;width:340px;max-height:360px;overflow:hidden">
      <div class="search">${i("search", 13)}<span class="q">de</span><span class="caret"></span></div>
      ${mi("No role", { icon: "x" })}
      <div class="grp">debugging</div>
      <div class="mi two hi"><div class="tx"><span class="ink">debugger</span><span class="d2">Causal root-cause investigation for failing code or runtime</span></div><span class="ck">${i("check", 13)}</span></div>
      <div class="grp">ops</div>
      <div class="mi two"><div class="tx"><span>deploy-watcher</span><span class="d2">Read-only watcher for a production window</span></div></div>
      <div class="grp">planning</div>
      <div class="mi two"><div class="tx"><span>product-manager</span><span class="d2">Turns intent into a dispatchable contract</span></div></div></div>` }),
}
F["F5"] = {
  t: "Launch running (entry d, top-bar button)", why: "The fields lock and the send button spins. A launch card with elapsed time; the sidebar shows the draft row at its target.",
  html: () => draftFrame({ place: "session", newOn: true, busy: true, set: ["place", "wt"], issue: false, text: "Audit the jira-cleanup skill against the current board",
    argv: "xt claude --role worker --new-session --prompt '…' --no-attach --json",
    card: `<div class="card"><div class="t">${'<span class="spin"></span>'}<span class="shimmer">Starting claude in a new worktree…</span><span class="txs faint" style="margin-left:auto">4 s</span></div>
      <div class="st"><span>Fetching origin/main, creating xt/&lt;name&gt;, starting the pane</span></div></div>` }),
}
F["F6"] = {
  t: "Launch failed: inputs kept, reason shown, Retry", why: "The card shows reason_code and the summary from xtrm.command-outcome.v1. Nothing typed is lost.",
  html: () => draftFrame({ place: "pane", rt: "Codex", set: ["place", "rt"], text: "Port the board-helper lanes to the new schema",
    argv: "xt codex --pane xx:workers --no-attach --json",
    card: `<div class="card err"><div class="t"><span class="danger">${i("alert", 14)}</span><span>Could not start codex</span><span class="mono txs faint" style="margin-left:auto">placement_unsupported</span></div>
      <div class="st"><span class="ink">xt codex has no --pane option; it can open a new session or a new window.</span></div>
      <div class="act"><span class="btn">Retry as new window</span><span class="btn">${i("copy", 12)}Copy command</span></div></div>` }),
}
const closeDialog = (o) => `<div class="backdrop"></div><div class="dialog">
  <div class="dh"><div class="tt">Close sessiondesign</div><div class="mono txs faint" style="margin-top:2px">xt/sessiondesign · ~/dev/xtrm/.xtrm/worktrees/xtrm-xt-claude-sessiondesign</div></div>
  <div class="sec" style="display:flex;gap:8px;align-items:center"><span class="dot idle" style="margin:0"></span><span class="txs">Agent idle</span></div>
  <div class="sec"><div class="st"><span>Changes</span><span>4 files</span></div>
    <div class="file"><span class="g M">M</span><span class="mono">packages/pi-viewer/docs/design/xtrm-1078-session-lifecycle.md</span></div>
    <div class="file"><span class="g A">A</span><span class="mono">packages/pi-viewer/docs/design/mockups/session-lifecycle.html</span></div>
    <div class="file"><span class="g A">A</span><span class="mono">packages/pi-viewer/docs/design/mockups/session-lifecycle.js</span></div>
    <div class="file"><span class="g U">??</span><span class="mono">packages/pi-viewer/docs/design/shots/scratch.png</span></div>
    ${o.commit ? `<div class="field">XTRM-1078: session lifecycle design note and mockups<span class="caret"></span></div>` : ""}</div>
  <div class="sec"><div class="st"><span>Not pushed</span></div><div class="txs muted">1 commit ahead of origin/xt/sessiondesign</div></div>
  <div class="ft"><span class="btn dghost">Discard changes…</span><span class="sp"></span>
    ${o.commit ? `<span class="btn">Cancel</span><span class="btn pri">Commit and push</span>` : `<span class="btn">Commit and push</span><span class="btn pri dis" title="clean and pushed first">Close thread</span>`}</div></div>`
F["F7"] = {
  t: "Close dialog: git state, Commit and push", why: "Read with git status (never release --dry-run, which nudges the agent). Close is enabled only when the tree is clean and pushed.",
  html: () => desktop({ side: sidebar({ ctx: "w1" }), title: "sessiondesign", body: threadBody(), composer: messageComposer(), overlay: closeDialog({ commit: true }) }),
}
F["F8"] = {
  t: "Discard confirmation lists every file", why: "One explicit confirmation, as the contract asks. Commits are kept; release keeps the branch.",
  html: () => desktop({ side: sidebar({ ctx: "w1" }), title: "sessiondesign", body: threadBody(), composer: messageComposer(),
    overlay: closeDialog({}) + `<div class="backdrop" style="z-index:32"></div><div class="dialog" style="top:170px;width:440px;z-index:33">
      <div class="dh"><div class="tt">Discard 4 changes in sessiondesign?</div><div class="txs muted" style="margin-top:4px">These files go back to the last commit; the untracked one is deleted. This cannot be undone. Commits are kept.</div></div>
      <div class="sec"><div class="file"><span class="g M">M</span><span class="mono">…/xtrm-1078-session-lifecycle.md</span></div><div class="file"><span class="g A">A</span><span class="mono">…/mockups/session-lifecycle.html</span></div><div class="file"><span class="g A">A</span><span class="mono">…/mockups/session-lifecycle.js</span></div><div class="file"><span class="g U">??</span><span class="mono">…/shots/scratch.png</span></div></div>
      <div class="ft"><span class="sp"></span><span class="btn">Cancel</span><span class="btn red">Discard 4 files</span></div></div>`.replace('class="dialog"', 'class="dialog" ') }),
}
F["F9"] = {
  t: "After a move: selection follows, row flashes once, Undo toast", why: "viewer-gate moved from workers to a new window in xx (break-pane). workers now holds one pane, so its row folds away as the tree already does. 5 s Undo, ⌘Z while shown.",
  html: () => desktop({ side: sidebar({ moved: true }), title: "viewer-gate", detail: "xx › viewer-gate", body: threadBody(), composer: messageComposer(),
    overlay: `<div class="toast">${i("check", 13)}Moved viewer-gate to a new window in xx<span class="u">Undo</span><span class="kbd">⌘Z</span></div>` }),
}

// ---- phone ------------------------------------------------------------------
function mobile(inner, overlay = "") {
  return `<div class="frame mobile"><div class="mtop"><span class="ib">${i("menu")}</span><span class="tsm b">${inner.title}</span>
  <div class="r"><span class="ib on">${i("plus")}</span></div></div>${inner.body}${inner.composer || ""}${overlay}</div>`
}
const M = {}
M["M1"] = {
  t: "Phone: long press on a pane row opens a bottom sheet", why: "Same items as F1, 44px rows.",
  html: () => `<div class="frame mobile" style="flex-direction:row">${sidebar({ ctx: "w1" }).replace('class="side"', 'class="side" style="width:100%"')}
  <div class="backdrop"></div><div class="sheet"><div class="grab"></div><div class="hd txs faint" style="padding:0 8px 6px">sessiondesign</div>
  ${mi("New thread beside", { icon: "split" })}${mi("Move to", { icon: "move", sub: true })}${sep}${mi("Copy", { icon: "copy", sub: true })}${sep}${mi("Close thread…", { icon: "trash", dng: true })}</div></div>`,
}
M["M2"] = {
  t: "Phone: draft thread", why: "The pickers wrap; the command preview is hidden on phone.",
  html: () => { const d = draftComposer({ place: "pane", set: ["place"] }); return mobile({ title: "New thread", body: `<div class="thread">${d.hero}</div>`, composer: d.composer }) },
}
M["M3"] = {
  t: "Phone: close dialog", why: "Full-width dialog, same content as F7.",
  html: () => mobile({ title: "sessiondesign", body: threadBody(), composer: messageComposer() }, closeDialog({})),
}

function render(mode) {
  const q = new URLSearchParams(location.search)
  const th = q.get("theme")
  if (th) document.documentElement.dataset.theme = th
  else document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  const only = q.get("frame")
  const phone = q.get("w") === "390" || mode === "mobile"
  const set = phone ? M : F
  const out = []
  for (const [id, f] of Object.entries(set)) {
    if (only && only !== id) continue
    out.push(`<section data-frame="${id}"><div class="cap"><span class="id">${id}</span><b>${f.t}</b><span class="why">${f.why}</span></div><div class="wrap">${f.html()}</div></section>`)
  }
  const main = document.getElementById("frames")
  main.className = phone ? "mgrid" : ""
  main.innerHTML = out.join("")
}
