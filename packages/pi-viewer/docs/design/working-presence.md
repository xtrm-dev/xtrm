# Working presence in the combined thread

XTRM-1026 · design decision · status: **proposed, awaiting the operator's ruling** · 2026-11-25

Mockups: `docs/design/mockups/working-presence-desktop.html` (1440) and
`docs/design/mockups/working-presence-mobile.html` (390). Both take `?theme=light` or `?theme=dark`;
without the parameter they follow the system scheme. Every state named in this document has a
numbered frame in the mockups; the frame number is given in brackets, for example [D3] or [M2].

## 1. Problem, measured on the live app

Live check on `http://127.0.0.1:5199/?s=xx&w=3`, 2026-11-25 12:1xZ, 1440 dark, four agents running
in window 3 (`working-design`, `xtrm-1020-claude-adapter`, `t3-audit`, `i1wb`):

- Each running agent renders a full `TurnView` at the tail: monogram, name, role chip, status dot,
  clock, and a `Working · 17 tools · 1m 28s · 2 failed` disclosure. Each row is 72px; four rows take
  288px, about a third of the thread viewport. The thread reads as four chats, not one.
- `channelTimeline` sorts pending turns last, by start time (`src/lib/thread.ts` `compareChannelItems`,
  `pendingRank` then `at`). When one agent settles, its row leaves the pending block and is
  re-inserted above it with the final reply; every pending row below it moves down by the height of
  that reply. When the same agent starts its next turn, it re-enters the pending block at the bottom,
  so the pending rows also change order.
- A pending turn whose agent stopped without a final reply (aborted, interrupted, process gone) stays
  pending forever and keeps the last place (XTRM-1019 finding "stale never-settled pending turn").
- The server cannot say that an agent waits for the operator (XTRM-1019 finding "needs attention").
  A Claude agent on a permission prompt reports `working · running tools`, because the transcript's
  last message is an assistant `toolUse` with no result.

## 2. Options

| | A. Slim inline rows | B. Docked presence line + overlay panel | C. Typing line in the thread + inspector |
|---|---|---|---|
| Where the running agents show | One 32px row per running agent at the timeline tail, inside the scroller | One reserved 28px line between the thread and the composer, outside the scroller; an overlay panel lists the agents | One 28px line at the timeline tail, inside the scroller; a right-hand inspector (desktop) or a sheet (mobile) shows one agent |
| Reads as one thread | Partly: N rows still stack (6 agents = 192px) | Yes: one line for any N | Yes: one line for any N |
| Layout jump on settle | Smaller, not zero: the block shrinks by 32px while the reply appears above it | **Zero in the thread**: the reply is appended; the line has a fixed height | Small: the line moves down by the reply height (it is the last item) |
| Layout jump on start | A row appears in the scroller | None: the line already reserves its height | None for N≥1; the line appears at N 0→1 |
| Presence while reading history | Lost when scrolled up | **Always visible** | Lost when scrolled up |
| Access to tools and metadata | Inline expand pushes the thread | Panel → agent detail, overlay, no reflow | Inspector, roomy on desktop; a new layout region the viewer does not have |
| Mobile | Rows cost the most vertical space where it is scarcest | Bottom sheet from the line | Sheet; same as B |
| Cost | Smallest change to `ChannelView` | One new component, one pure view split, reuse of `ActivityRow` | New inspector region plus the line; largest |

**Recommendation: B.** It is the only option that keeps the thread still in both directions (start
and settle), and it keeps presence visible while the operator reads older messages, which is the
Slack "X is typing" behaviour the operator asked for. C gives the same single line but loses it on
scroll and adds a layout region. A keeps the per-agent rows the problem names. Options A and C are
drawn for comparison in [D9] and [D10].

## 3. The recommended design

### 3.1 Where it sits

The presence line is a reserved row directly above the composer, inside the composer's
`max-w-3xl` column, outside `MessageScroller`. Its height is fixed: 28px (`h-7`, sidebar row
density) on desktop, 32px on mobile. It is reserved even when no agent runs, so the viewport of the
thread never changes height because of presence. It is a ghost control (console §2.1 rule 2): no
fill at rest, `bg-hover` on hover and focus, `rounded-md`.

Pending turns leave the scroller. The thread contains settled turns, operator messages, peer messages
and optimistic messages only.

### 3.2 The collapsed line, by count

Agents are named by their short name (§3.8). Elapsed time is the running turn's age, `tabular-nums`,
updated once a second by a ticking text node, not by a React re-render (the t3code `AgentElapsed`
pattern, audit §3.5). An agent with no known start time shows `Working…` instead of a time. Monograms are the existing `AgentMark` at `size-5`, overlapping by 4px, at
most three, then `+N` as plain text (console §2.3 rule 5: a count, not a pill row).

| running | collapsed line (desktop) | frame |
|---|---|---|
| 0 | the row is empty and inert; the reserved 28px stays; nothing is announced | [D1] |
| 1 | `[mark] working-design is working · Read src/lib/thread.ts · 1m 28s ˄` | [D2] |
| 2 | `[mark][mark] working-design and t3-audit are working · 1m 49s ˄` | [D3] |
| 3 | `[mark][mark][mark] working-design, t3-audit and i1wb are working ˄` | [D4] |
| N ≥ 4 | `[mark][mark][mark] +3  6 agents are working ˄` | [D5] |
| any, one needs attention | `[accent dot] i1wb needs you · 3 others working ˄` (attention first; §3.6) | [D6] |

Rules:

- The current step (`Read src/lib/thread.ts`) shows only at N=1. At N=2 the line shows the longest
  elapsed time; at N≥3 it shows names or a count only. The line never wraps; the name list truncates
  with an ellipsis before the count does.
- The status shape is the existing `StatusDot` `working` (accent, `viewer-pulse`), one per line, before
  the marks. Colour is never the only carrier (console §2.1 rule 5): the words "is working" and
  "needs you" carry the state.
- `prefers-reduced-motion`: the pulse stops (already handled by `.viewer-pulse`).

Mobile (390) uses the same line at 32px with a shorter text: N=1 `working-design · Read thread.ts ·
1m 28s`; N≥2 `[marks] 3 working`; attention `[dot] i1wb needs you · +2`. [M1]–[M3]

### 3.3 The expanded panel: the agent list

Activating the line (click, tap, Enter or Space) opens a panel that floats above the line. It is the
same floating layer the composer already uses for its `@` and `To` menus: `absolute bottom-full`,
`rounded-lg bg-raised p-1 shadow-float`, width of the composer column on desktop. It overlays the
thread; it does not push it. [D7]

- Header: `Working · 4` in `text-2xs text-ink-faint` (section heading ink), and on the right
  `Close` (ghost, `Esc`).
- One row per running agent, 32px (`list` density, console §4.2), in **tree order** (window index,
  pane index), not start order, so rows never reshuffle while the panel is open. Agents that need
  attention sort first.
- Row anatomy: `[status dot] [mark] name · role (plain text) · current step (label + summary,
  truncates) · elapsed · chevron`. One coloured element per row: the status dot (console §2.3 rule 1);
  the role is plain `text-ink-faint` text, not a chip.
- A row whose agent is quiet (§3.6) shows `quiet 16m` in `text-ink-faint` in place of the elapsed
  time and drops the pulse.
- Height: up to six rows, then the list scrolls inside the panel (`max-h` = header + 6 × 32px).
- The panel stays open across polls; a row that settles fades out over 150ms; a row that starts fades
  in at its tree position.

### 3.4 One agent's live tools and metadata

Activating a row (click, Enter, →) replaces the list with that agent's detail inside the same panel,
with a back control. [D8]

- Header: `← back`, mark, name, status dot + status word, and two ghost actions: `Message` (sets the
  composer's `To` target to this agent and focuses the textarea) and `Open pane` (switches the thread
  scope to `?p=%N`).
- Metadata grid (label column, console §7), each value from data the viewer already has:
  - Status: `working · running tools` (`ViewerAgent.status`, `statusNote`)
  - Turn: `started 13:01:22 · 1m 49s` (`Turn.start`, ticking)
  - Steps: `21 steps · 17 tools · 2 failed` (`stepCount`, `toolCount`, failed items)
  - Model: `claude-opus-5-5 · thinking high` (`model`, `thinkingLevel`)
  - Place: `xx · window 3 · pane %105` (`tmuxSession`, `windowIndex`, `paneId`)
  - Directory: the `cwd`, mono, truncated from the left
- Live activity: the existing `ActivityRow` list for the running turn, newest last, the list kept
  scrolled to the newest item unless the operator scrolled it. The newest tool call without a result
  carries the `viewer-fade` "running" word. Each row expands to its input and output exactly as today
  (`useDetail` fetch on expand).
- The panel body scrolls; its maximum height is 60% of the viewport on desktop.
- If the agent settles while its detail is open, the detail stays, its status becomes `settled · 1m
  52s`, and a link `Show reply` scrolls the thread to the new turn and closes the panel.

### 3.5 From working to the settled timeline, without layout jump

1. A poll (every 1.5s) brings the final assistant reply. `Turn.pending` becomes false. Nothing else in
   `thread.ts` changes: the turn anchors at its settling event, as today.
2. The view split (§4.1) moves the turn from the presence set to the timeline set. Its anchor is the
   reply time, which is the newest anchor in the thread, so the row is **appended** at the end.
3. The presence line changes its text and its marks; its height does not change. If the panel is
   open, the row fades out inside the overlay; the thread does not reflow.
4. The scroller is pinned to the end when the operator is at the end (`autoScroll`), so the new reply
   scrolls into view. When the operator has scrolled up, the content above the fold does not move,
   because the append is below it; the existing jump-to-end button shows `1 new reply`.
5. Motion: the new turn row fades in over 150ms with opacity only (no height animation). Reduced
   motion: no fade.

Before and after frames: [D11] and [D12].

Residual case, unchanged by this design: a reply whose settling time is older than an item already in
the timeline (for example an operator message sent to another agent between the reply and the next
1.5s poll) is inserted one row above the tail. This is the settle-time anchoring contract, kept as is.

### 3.6 Stale turns and needs attention (XTRM-1019 findings)

The presence set is driven by the **agent's status**, not by `Turn.pending` alone:

| agent status (server) | its open turn | shown as | frame |
|---|---|---|---|
| `working` | pending | a presence entry (line + panel row) | [D2]–[D5] |
| `working`, last write older than 15 min (proposed `quiet`, §4.2) | pending | a presence entry, no pulse, `quiet 16m` | [D7] row 4 |
| `attention` (proposed, §4.2) | pending | a presence entry, sorted first, accent dot, `needs you` + the reason (`permission: Bash`, `question`) | [D6] |
| `idle` (`turn aborted`, `turn interrupted`), `error`, `unknown`, pane gone | pending | **not** a presence entry: a settled-looking row in the timeline, anchored at the turn's last activity (`Turn.end`), text `Stopped without a reply · turn interrupted`, with the activity disclosure | [D13] |
| `waiting` | none (the turn has a final reply) | nothing in presence | — |

`waiting` never means "needs attention" (thread-lead ruling, XTRM-1019 seq 8): a waiting agent has
answered and waits for a new prompt, which is normal idle.

A stopped turn that later receives activity (the agent resumes) moves back to presence. This can only
happen after a server status flip, so it is rare and is acceptable.

### 3.7 Scope

The presence set is the agents of the current scope, the same set `agentsInScope` already returns.

- **Session**: every running agent in the tmux session. The line says `4 agents are working`.
- **Window**: the running agents of that window.
- **Pane**: the one agent. The line becomes the single-agent form [D2]; the detail view is one
  activation away. The pending turn also leaves the scroller in pane scope, so there is one rule for
  every scope. Running agents outside the scope are not counted; the sidebar dots already show them.

### 3.8 Short names

The line and the panel use a short display name: the agent name with a leading
`<repo>-xt-<runtime>-` launcher prefix removed (`xtrm-xt-claude-working-design` → `working-design`,
`xtrm-xt-pi-i1wb` → `i1wb`). Pattern: `^[a-z0-9.]+-xt-(?:pi|claude|codex)-`. A name that does not
match is shown unchanged. The full name stays in the detail header and in `title`/`aria-label`.

### 3.9 Keyboard and screen readers

- Tab order: thread → presence line → composer textarea → `To` → `Send`. The line is one `button`
  with `aria-expanded` and `aria-controls`; at N=0 it is `aria-disabled` and skipped.
- Panel open: focus moves to the first row. ↑/↓ move between rows (roving `tabindex`), Home/End jump,
  Enter or → opens the detail, Escape closes the panel and returns focus to the line.
- Detail: ← or Backspace or the back control returns to the list with focus on the same row; Escape
  closes the panel. Tab cycles the detail's actions and activity rows.
- `aria-live="polite"` on a visually hidden summary that changes only when the membership changes
  ("i1wb started", "t3-audit replied", "i1wb needs you"), never on the ticking elapsed time.
- No new global shortcut in this design (open question §7.2).

### 3.10 Mobile (390)

- The line is 32px, full width of the composer column, above the composer. [M1]–[M3]; reserved and
  empty at N=0. [M6]
- A tap opens a **bottom sheet** instead of a floating panel: full width, `rounded-t-lg bg-raised
  shadow-float`, a scrim on `bg-deep/60`, maximum height 75dvh, closed by the scrim, by Escape, by the
  system back gesture (a history entry is pushed while open) or by the `Close` control. [M4]
- Rows are 44px (touch target); the role text and the current step move to a second line at
  `text-2xs`, as the console's two-line row does. [M4]
- The detail replaces the list in the sheet with a back control, as on desktop. [M5]

## 4. What changes in code (for the follow-up implementation issue)

### 4.1 Client

- `src/lib/thread.ts`: `channelTimeline` and its ordering invariant stay as they are. The 18 original
  Pi tests (`test/ordering.test.ts` 13, `test/intercom.test.ts` 11 at today's count; the 18 named in
  XTRM-1019 are a subset) keep passing without edits.
- New pure function (in `thread.ts` or a new `src/lib/presence.ts`):
  `splitPresence(items, agents) → { timeline: ChannelItem[]; presence: PresenceEntry[] }`.
  It moves each `turn` item whose turn is pending **and** whose agent is `working` or `attention`
  into `presence`. A pending turn whose agent is in any other state stays in `timeline`, re-anchored
  at `Turn.end` and marked `stopped`, and the timeline is re-sorted with the existing comparator.
  Running agents in scope without a pending turn in the loaded events get an entry with no turn
  ("Working…"). Presence entries are ordered attention first, then tree order.
- `ChannelView` renders `timeline`; a new `PresenceLine` (with `PresencePanel`, `PresenceDetail`)
  renders `presence` above the `Composer`. `ActivityRow` is exported from `ActivityDisclosure.tsx`
  and reused unchanged.
- `TurnView` gains the `stopped` variant text. `StatusDot` gains `attention` (accent, no pulse) and
  `quiet` (faint, no pulse) once the server sends them.

### 4.2 Server signals

**Does today's data suffice?** For the main design, yes; for two states, no.

| need | today | enough? |
|---|---|---|
| who is running in scope | `/api/sessions` `status === "working"` (polled every 10s) and the thread payload's `agents` (every 1.5s) | yes |
| current tool, tool list, step counts, elapsed | thread payload events → `Turn.activity`, `Turn.start` | yes |
| metadata (model, thinking, place, cwd) | `ViewerAgent` | yes |
| a pending turn that will never settle | `status` `idle` with `statusNote` `turn aborted` / `turn interrupted`, or `error` | yes for aborted, interrupted and failed turns |
| a long tool call versus a dead agent | `statusOf` returns `idle · quiet for 15m` for both | **no** |
| the agent waits for the operator | nothing; a permission prompt reads as `working · running tools` | **no** |

Proposed additions, in order of value:

1. **`attention` status from the transcript (no new read path).** In `statusOf` / `claudeStatusOf`:
   when the newest main-line message is an assistant `toolUse` whose pending tool call is
   `AskUserQuestion` or `ExitPlanMode` (Claude) and it has no result, return
   `{ status: "attention", note: "question" }`. This is provable from the file the server already
   reads.
2. **`attention` from the pane, read-only.** For permission prompts, which never reach the
   transcript, the server reads the visible pane with `tmux capture-pane -p -t %N` (a read, never an
   attach) only for agents whose status is `working` and whose last write is older than 5s, and
   matches the runtime's known prompt markers. Note: `attention · permission`. This is a new read path
   against agent panes; the operator rules on it separately (§7.1).
3. **`quiet` instead of `idle` for a long tool.** When the last message is an assistant `toolUse` and
   the file is older than 15 min, return `{ status: "quiet", note: "no output for 16m" }` while the
   agent process (`piPid`) is alive, and `idle · agent exited` when it is not. A quiet agent stays in
   presence; an exited one is a stopped turn.
4. **`turnStartedAt` and `lastEventAt`** on `ViewerAgent`, so the presence line can show an elapsed
   time for an agent whose open turn starts before the loaded events (a large session).

`AgentStatus` becomes `working | attention | quiet | waiting | idle | error | unknown`. The sidebar
dot set gains `attention` only when the server can prove it (XTRM-1019 seq 8).

## 5. Acceptance for the follow-up implementation

- With 1, 2, 3 and 6 running agents the presence line is one 28px row (32px at 390) and its text
  matches §3.2.
- When a running agent settles, every row that was in the timeline before the poll keeps its order
  and its `offsetTop` inside the scroll content (a browser test reads both before and after the
  poll). A scroller pinned to the end scrolls by the new row's height; that is a scroll, not a
  reflow.
- When an agent starts a turn, the scroller's `clientHeight` does not change.
- A pending turn whose agent is `idle · turn interrupted` renders in the timeline as `Stopped without a
  reply`, not in presence.
- Keyboard path of §3.9 works without a pointer; Escape returns focus to the line.
- The 18 original Pi tests pass unchanged; `channelTimeline` output for any input is unchanged.

## 6. Visual language

Tokens are the console tokens as `packages/pi-viewer/src/styles.css` defines them (the pi-viewer copy
of `packages/xtrm-app/docs/design/console-ui-system.md` §3): surface ladder `deep → surface → raised
→ control`, `ink / ink-muted / ink-faint`, `accent` for the working dot and attention, `danger` for
failed steps, `border-muted` hairlines, `shadow-float` for the panel and sheet, `rounded-md` rows,
`rounded-lg` floating layers, type steps `2xs / xs / sm`. No new colour or tint.

Checked against the t3code audit (XTRM-1025, `docs/design/t3code-chat-audit.md` at `7cbf7297` on
branch `xt/t3-audit`, §1, §3.5 and §10):

- **Adopted:** the timer as a ticking `tabular-nums` text node, `Working…` without a start time, and
  no spinner. The live tool line is the busy cue inside the detail view (§3.4), as in t3code.
- **Kept from the viewer, differs from t3code:** the pulsing accent `StatusDot` on the presence line.
  t3code has no pulsing mark; the viewer already uses this dot for `working` in the sidebar and the
  composer's `To` menu, and console §2.1 rule 5 wants one shape per state across a surface. The
  running tool row uses `viewer-fade`; a stepped 2.2s sweep (t3code §1.5) can replace it under the
  restyle issue, with its reduced-motion branch (audit conflict 17).
- **Kept from the console:** 28px line height, not t3code's 24px (audit conflict 16 is a separate
  lead ruling); 13px glyphs, not 16px (conflict 3); `rounded-lg` 10px for the panel and sheet, no
  larger radius (conflict 4); `shadow-float` only on the floating layer, no blur (conflicts 6, 7).

## 7. Open questions for the operator

1. May the server read agent panes with `tmux capture-pane` (read-only) to detect permission prompts
   (§4.2 item 2)? Without it, `attention` covers only `AskUserQuestion` and `ExitPlanMode`.
2. A global shortcut to open the presence panel (proposal: none in v1).
3. Should the presence line also count running agents outside the scope (`· 2 more elsewhere`)?
   Recommendation: no; the sidebar already shows them.
