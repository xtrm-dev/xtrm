# pi viewer — design document

Status: draft for review, 2026-11-25 (XTRM-1049). Every behavioural claim cites a file and line, or a
journal entry. Line numbers are from the tree that carries this document unless a citation says
otherwise. The design language quotes `packages/xtrm-app/docs/design/console-ui-system.md` by section;
that document is the authority for the console, this one is the authority for the viewer.

## 1. What the viewer is

The pi viewer is a small read-only web application that renders the agent work of one tmux session as a
Slack-like channel. One tmux session is one channel; the agents are the `pi` and Claude Code panes inside
it. The server reads the agents' session transcripts from disk, never attaches to a pane and never takes
ownership of an agent process; the only write it can perform is `tmux send-keys` for a message the
operator sends from the composer (`README.md:3-8`, `README.md:109-118`, `server/api.ts:350`). The server
binds to `127.0.0.1` and has no authentication (`README.md:25`).

## 2. Architecture

### 2.1 Server (`packages/pi-viewer/server`)

The server is a Vite plugin that answers `/api/*` requests and nothing else (`server/plugin.ts:24`,
`server/api.ts:289`).

| module | responsibility |
|---|---|
| `server/api.ts` | HTTP routes and payload shaping: `/api/health`, `/api/sessions`, `/api/thread`, `/api/event`, `/api/send` (`server/api.ts:292-350`, dispatcher `handleApi` at `:386`). `/api/send` is the only writer; it runs `tmux send-keys -l` then `Enter`. |
| `server/discover.ts` | `tmux list-panes -a` (`:62`) → each pane's process descendants → the `pi` or `claude` process → its cwd and session file (`:196`) → a `Discovery` of sessions, windows and agents (`:413`). `findAgent` (`:450`) and `defaultSession` (`:455`) serve the request path. |
| `server/session.ts` | incremental JSONL parsing and event normalisation (`parseSessionFile` `:226`, `normalizeEvent` `:361`); the one effect classifier `entryEffect` (`:625`); the status derivation `statusOf` (`:701`) with the 15-minute quiet window (`QUIET_MS` `:574`) and the write clock `lastWriteAt` (`:691`). |
| `server/claude.ts` | Claude Code transcript resolution (registry entry `:105`, else newest-since-start `:228`), pane naming (`:329`), and the conversion of Claude records to the Pi event model (`normalizeClaudeEvent` `:810`). |
| `server/intercom.ts` | agent-message normalisation for the Pi and Claude envelopes (`:291`, `:316`), delivery pairing by tool call id (`:360`) and the pair key used to merge the two sides of one message (`:395`). |
| `server/peers.ts` | resolves a `uds:` socket address to a peer name so a card shows a session name instead of a socket path (`:37`). |
| `server/repo.ts` | the repository name of an agent cwd, from the git common dir (`:34`). |
| `server/thread-cache.ts` | per-agent and per-session caches, the monotonic event cursor, and turn paging (`ThreadQuery` `:272`, `cachedThread` `:280`, `invalidateThread` `:329`). |
| `server/attention.ts` | the only behavioural read of a live pane: `tmux capture-pane -p -J` of the visible screen (`:134`), 5 s after the turn opens and every 2 s after that (`:28-29`), at most 4 reads in flight (`:145`), parsed for a permission prompt (`:123`), applied on top of the state model (`:231`). It never sends a key. |

`server/claude.ts` also carries the rule that a pane's name is the transcript's `custom-title`, else
`agent-name`, else the cwd basename plus the short session id (`README.md:137-138`).

### 2.2 Client (`packages/pi-viewer/src`)

`src/App.tsx` is the shell and the owner of all polling. Its render tree is the console shell
(`ConsoleShell`, `src/App.tsx:415`), the sidebar, the header (`:429`), a scroller provider keyed by the
scope (`:472`), the Channel or All-events view (`:484`, `:510`), the presence line (`:531`) and the
composer (`:547`).

| part | source |
|---|---|
| shell: resizable sidebar plane, collapse, Ctrl/Cmd+B, narrow overlay | `src/shell/ConsoleShell.tsx:18`, `src/shell/layout.ts:10-93` |
| sidebar tree: tmux session > window > pane, keyboard tree | `src/components/sidebar/Sidebar.tsx:33`, `src/components/sidebar/SessionTree.tsx:104` |
| scope: URL, fallback, poll grace | `src/lib/scope.ts:12-251` |
| thread model: effects, turns, timeline order, intercom pairing | `src/lib/thread.ts:159`, `:587`, `:621`, `:664` |
| turn state machine (status, grouping) | `src/lib/turn-state.ts:66`, `:99` |
| presence model: live entries, stopped rows, split | `src/lib/presence.ts:127`, `:208` |
| read state: last seen, new-since index | `src/lib/readstate.ts:69-103` |
| composer: address picker, reply bar, send | `src/components/Composer.tsx:24`, `src/lib/reply.ts:14-41` |

### 2.3 Data flow, transcript to row

```
tmux panes ──discover.ts──▶ agent + transcript file
       │                          │
       │                    session.ts (parse, effect) / claude.ts (convert)
       │                          ▼
       │                    thread-cache.ts (sorted events, cursor, revision)
       │                          ▼
       └──10 s poll──▶ /api/sessions      /api/thread?since=&revision=   ◀──1.5 s poll──┐
                              │                    │                                    │
                              ▼                    ▼                                    │
                        SessionTree          App.tsx (scope filter, read state)          │
                        (status dot)               │                                    │
                                                   ▼                                    │
                                   thread.ts (turn grouping, settle anchor, order)      │
                                                   ▼                                    │
                                   ChannelView rows ── presence.ts ── PresenceLine ──────┘
                                                   ▼
                                              Composer ──POST /api/send──▶ send-keys
```

The Channel is a settle-time timeline: an operator message sits at its send time, an agent turn sits at
the event that settles it (the final reply), and a running turn is always last (`README.md:95-102`,
`src/lib/thread.ts:587-602`). Ordering among items of different rank is fixed by
`compareChannelItems` (`src/lib/thread.ts:621`): user, inbound, optimistic, turn, sent.

### 2.4 Incremental polling

The browser loads the newest 150 turns, then polls with `since=<cursor>&revision=<id>`; a poll returns
only new or changed events, `before=<cursor>` pages backwards, and the client never starts a poll while
one is in flight (`README.md:192-197`). The thread poll backs off to 5 s above 800 ms and 10 s above 2 s
of response time (`README.md:195-197`, `src/App.tsx:245-248`); discovery runs every 10 s
(`src/App.tsx:186`). The session cache keeps a sorted event list and one monotonic cursor per event, so
an unchanged poll is a few bytes (`README.md:199-208`). A revision change (server restart, file shrink,
agent set change) makes the client reload the window rather than merge across a broken cursor space
(`README.md:201-204`, `server/thread-cache.ts:280`). JSON responses are gzip-compressed when accepted
(`README.md:206`).

## 3. Design language

The viewer wears the console's design language. The authority is
`packages/xtrm-app/docs/design/console-ui-system.md`; the viewer adopts its tokens and ladders and
documents its own scoped departures here.

### 3.1 Tokens and palettes

All colour is a CSS variable on `:root` (`src/styles.css:17-45` light, `:92-119` dark), exposed to
Tailwind v4 through `@theme` (`src/styles.css:157-183`), so no component holds a raw colour. The dark
sidebar plane is `#181818` in Threads (`src/styles.css:97`) and `#232323` in Console
(`src/styles.css:153`); the light sidebar is `#f4f4f5` in both (`src/styles.css:17`).

Five palettes are themes of the same components: **Threads** (default), **Threads · soft text**,
**Console**, **Console · soft text** and **Desktop** (`src/lib/palette.ts:15-17`; the operator kept all
five on 2026-11-26, §6). The header's Colours control sets `data-palette` on `<html>`, the choice
persists in `localStorage` (`pi-viewer-palette`), and a switch rewrites variables only — no component
fork, no reload, no scroll change (`docs/design/palette-console.md:1-6`; console overrides at
`src/styles.css:145-161`). A soft-text version keeps its base's `data-palette` and adds
`data-text="soft"`, a text-only layer, so no surface value is written twice
(`src/lib/palette.ts:24-30`, `src/styles.css:188-205`).

The difference is which plane each region wears, not which colours exist: every `--x-*` text, border,
accent and danger token is identical in Threads and Console (`docs/design/palette-console.md:69-70`);
Desktop replaces the planes and the text roles with the operator's Claude Desktop values
(`src/styles.css:163-187`), and a soft-text version takes Desktop's text colours over its base's
surfaces (`src/styles.css:188-205`). The region assignment (`docs/design/palette-console.md:22-33`) and
the token tables for all five palettes (`docs/design/palette-console.md:35-199`) record every value.

Type, glyph and row values follow console-ui-system.md: the four-step type ladder (§3.3), the glyph
ladder with the rule "a glyph never exceeds its row's text" (§3.4), and the three densities (§4.2).
Rows in the viewer are `text-sm` (13px) with the second line at `text-xs` (11.52px)
(`src/components/sidebar/SessionTree.tsx:88`).

### 3.2 Rows and the 24px transcript exception

| surface | height | source |
|---|---|---|
| sidebar session and window rows | 28px | `README.md:29-31`; console `sidebar` density, console-ui-system.md §4.2 |
| sidebar pane row | two lines, 48px (`3rem`: two line heights plus `py-1.5`) | `src/components/sidebar/geometry.ts:33-40`; `README.md:32` |
| presence agent rows | 32px, 44px on a narrow screen | console-ui-system.md §4.2.1; `src/components/presence/PresenceLine.tsx:283` |
| thread tool-call, grouped tool-call and turn-fold lines | 24px (`min-h-6`) | console-ui-system.md §4.2.1; `src/components/ActivityDisclosure.tsx:74`, `:161`, `:240` |

The 24px lines are a documented, height-only exception: they are a log read in sequence, so they need no
28–32px pointer target, their type stays on the ladder, and their text stays `ink-muted`, never
`ink-faint` (console-ui-system.md §4.2.1). Its reasoning follows
`docs/design/t3code-chat-audit.md` §3.3 and §10.

### 3.3 Motion

The viewer follows console-ui-system.md §18: opacity plus a translate of at most 4px, nothing that
changes layout; hover reveal at 200 ms; stream fade at 600 ms `ease-out`; stepped loops that pause
off-screen; no spinner, bouncing dot or pulsing avatar; every animation has a
`prefers-reduced-motion: reduce` branch; smooth scrolling belongs to the scroller and ends when the
reader takes over. The implementation is in `src/styles.css:510-543`: `viewer-pulse` (1.6 s) for a
working agent, `viewer-fade` (1.8 s) for an agent that needs the operator, and one reduced-motion block
that stops both (`src/styles.css:541-543`). The sidebar's status dot uses the same two classes, so a
flashing dot means the same thing in the thread and in the tree (`src/lib/status-dot.ts:13-44`).

### 3.4 Status colour

Status is carried by a dot, never by a word, in the sidebar (`XTRM-1048`; `docs/design/` this file
§4.1). The mapping is one table, `src/lib/status-dot.ts:13-69`: working = accent, flashing; attention =
accent, slower fade; quiet = ink-muted; idle and waiting = ink-muted at 75%; error = danger; unknown = a
hollow ring. Each colour is an existing token, and the sidebar table (`SIDEBAR_DOT`, `:44`) misses the
3:1 non-text minimum of `ink-faint`, which is why it uses `ink-muted` where the thread's shared table
could use `ink-faint` (`npm run test:contrast`; `scripts/contrast-check.mjs`).

## 4. Components

Each entry states its purpose, its states and its source. Shared primitives (`src/components/ui/*`) are
the shadcn AI Elements chat patterns on the console tokens (`README.md:227-229`).

### 4.1 Sidebar and its rows

Purpose: the tree of sessions, windows and panes, and the scope picker. States: expanded or collapsed
plane (persisted width, `src/shell/layout.ts:41-72`), overlay below 768px (`src/shell/layout.ts:74-93`),
focused row, selected scope, and a per-agent status dot. Rows: a session or window row is one 28px line —
name, chevron, agent count; a window with one pane has no row of its own (`README.md:29-32`). A pane row
is two lines: agent name on line 1; role, runtime word and folder-plus-repo on line 2, with the status
dot at the right (`src/components/sidebar/SessionTree.tsx:88`, `src/components/sidebar/SidebarDot.tsx`).
Every role is bold; Lead and Manager also take the thread view's pill colours and every other role stays
in the normal line ink (operator ruling, XTRM-1028; `src/components/sidebar/SessionTree.tsx:31`). The
tree is keyboard operable with roving focus (`README.md:45-46`, `src/components/sidebar/SessionTree.tsx:202`).

### 4.2 Shell, switcher and header controls

Purpose: the console frame around the viewer, and the controls that change how the thread is read.
`ConsoleShell` owns the 44px header, the drag-resizable sidebar plane (264px default, 220–360, saved in
`xtrm.console.layout.v1`), the collapse-to-zero state and the reopen button
(`src/shell/ConsoleShell.tsx:18`, `src/shell/layout.ts:10-16`, `README.md:34-38`). `HalfSwitch` is the
Work / Agent switcher (`src/shell/HalfSwitch.tsx:20`); its selected colours follow the top-right view
control per palette (operator ruling, XTRM-1024 seq13, seq14; `src/shell/HalfSwitch.tsx:35`).
`ViewerHeader` holds the view tablist (Channel, All events; `:30`), the chat-width control (`:73`) and
the Colours control (`:194`). States: current view, current palette, width preset or custom, and a
suppressed shortcut while a text field has focus (`src/shell/layout.ts:27`).

### 4.3 Thread rows and the tool fold

Purpose: one scannable line per event in the channel. States: at rest, hover (time and actions revealed,
console-ui-system.md §18 rule 2), expanded, and the failed-delivery mark. A user row never takes two
lines: the fold control sits left, the meta actions (time, recipient, delivery, Reply, Copy) sit right;
labels shorten first, then truncate, and icons and the time never shrink
(`docs/design/palette-console.md:98-103`). Behind a settled turn the tool calls, tool results, thinking
and notices collapse: `ActivityRow` (`src/components/ActivityDisclosure.tsx:39`) is one tool call,
`GroupRow` groups repeats, and the fold row reads "Worked for 1m 12s" (`:184`, `:240`); all three are
24px (console-ui-system.md §4.2.1). The activity signature that decides whether a row re-animates is
`activitySignature` (`src/lib/thread.ts:744`).

### 4.4 Intercom cards

Purpose: peer traffic shown as a card, not folded into tool noise (`README.md:149-173`). States:
collapsed to three rendered lines with `Show more` (`src/components/IntercomCard.tsx:10`, `:49-54`),
expanded (full body, up to 40,000 characters), and four delivery marks — sent, received, delivered,
failed (`:80-97`; words in `src/lib/delivery.ts:11`). A failed send keeps its place in the thread with a
red mark and the reason (`README.md:162-166`). The card shows `Sent` or `Received` on the left and the
peer on the right (`src/components/IntercomCard.tsx:96-108`). When both sides of one message are present,
one card is shown: the send keeps its timestamp and position, the receiver supplies the message id
(`src/lib/thread.ts:444`, `README.md:168-173`).

### 4.5 Presence line and panel

Purpose: what is running right now, above the composer, without a spinner in the thread
(`docs/design/working-presence.md:48-133`). The collapsed line states `Working · N` with the agent
monograms and their status dots (`src/components/presence/PresenceLine.tsx:251-254`, `:378`), and expands
into a listbox of agent rows (`:283`); the panel is the expanded form
(`src/components/presence/PresenceDetail.tsx:36`). States: empty (line hidden), one agent, several
agents, attention (the dot flashes), quiet (static muted), narrow screen (44px rows). The line's text is
derived by `presenceLine` (`src/lib/presence.ts:208`) and announced politely with
`presenceAnnouncement` (`:247`). The monogram pills wear a 2px `ring-canvas`, so they read as cut-outs
against each palette's canvas (`docs/design/palette-console.md:81-96`).

### 4.6 Composer, reply bar and chat width

Purpose: send one operator message to one agent, and answer a specific agent without retyping.
States: empty with placeholder, draft, addressed (`To` picker), replying (the "Replying to" bar with the
agent's monogram, `src/components/Composer.tsx:177-196`), sending, and gone (the target pane left;
`src/lib/reply.ts:14-27`). The composer addresses the pane itself, else the most recently active agent of
the scope (`README.md:66-68`); `@` opens the agent list (`README.md:116`); Escape clears the reply bar
before it clears the draft (`src/lib/reply.ts:41`, `src/components/Composer.tsx:243`). Newlines flatten
to spaces for this version (`README.md:116`). The optimistic user row disappears when the matching user
event appears in the transcript (`README.md:117-118`). Chat width is a preset (comfortable 46rem, wide
72rem) or a custom rem value from 36rem up, persisted in `pi-viewer-chat-width`
(`src/lib/chat-width.ts:6-19`, `:88`).

### 4.7 Scroll pill and the new-since divider

Purpose: keep a reader's place and show what arrived while they were away. The pill appears only when
the reader is not at the end; it reads "Scroll to end", adds "· N new", and never steals the composer's
focus (`src/components/ui/message-scroller.tsx:476-511`). The follow policy is in `src/lib/stick.ts:8`:
smooth only while at the end and content is arriving, never for a reader who scrolled up, and the
reader's own input ends it. The new-since divider is a single line, `New · N`, placed at the first item
after the scope's last-read time; the baseline is frozen for the visit, so the divider does not walk away
while the reader reads (`src/components/ChannelView.tsx:265`, `:337-340`, `src/lib/readstate.ts:69-103`).

## 5. Turn state model

Summary of `docs/design/working-presence.md` §8 (authority: XTRM-1043). Three review rounds failed
heuristic classification (XTRM-1037, 1040, 1041), so one explicit state machine replaced them
(`docs/design/working-presence.md:314-324`; code `src/lib/turn-state.ts`).

- **One effect per record.** The server classifies every transcript record as `open`, `step`, `reply`,
  `abort`, `fail`, `compact` or `none`, and carries it on the event (`entryEffect`,
  `server/session.ts:625`; `ViewerEvent.effect`). The table of which records produce which effect, and
  the three cases the record alone does not settle (Claude slash commands, Pi `custom_message` wake-up
  types, Claude `stop_sequence`), is `docs/design/working-presence.md:326-356`.
- **States.** `phase` is `none`, `open`, `settled`, `aborted` or `failed`; an open turn also records
  `loop`, and a failed one whether the error was a context overflow
  (`src/lib/turn-state.ts:42-54`). Transitions are `nextTurnState` (`:66`); `none` never changes the
  state (`docs/design/working-presence.md:357-379`).
- **Status.** The status word and its note derive from the phase and the silence: `attention` on an open
  question or plan approval, else `quiet` after 15 minutes without a turn-moving write, else `working`;
  `waiting` when settled, `error` when failed, `idle` otherwise; permission prompts from the pane capture
  are applied last (`docs/design/working-presence.md:380-404`; `server/attention.ts:231`).
- **Time.** No timer enters the machine. The clock is `ViewerAgent.lastWriteAt`, the write time of the
  newest turn-moving record, a running maximum, clamped to the file time
  (`docs/design/working-presence.md:392-404`; `server/session.ts:691`).
- **Grouping.** The browser folds the same effects with the same machine (`groupAgent`,
  `src/lib/thread.ts:227`, folded into channel turns at `:656`; `splitPresence`,
  `src/lib/presence.ts:127`), so the status line and the thread
  cannot disagree about a turn. Meta events that carry an effect reach the browser; rendering still skips
  meta (`docs/design/working-presence.md:432-434`).
- **Proof.** The replay harness writes a transcript one record at a time and checks, after each record,
  that a fresh parse equals the incremental one, that no stopped row disappears, and that an open turn
  exists exactly while the status is live (`docs/design/working-presence.md:448-479`;
  `test/replay/harness.ts`). The server reads only trailing records (`resolveTurnState`,
  `src/lib/turn-state.ts:99-118`), which equals a fold from the start.
- **Known limits** are listed at `docs/design/working-presence.md:481-497`; the model does not guess a
  retry before it is written, and an overflow reads as `error` until its compaction arrives.

## 6. Decisions log

Operator rulings that shape the app, with the durable record. "seq" is a journal entry of that issue.

| date | ruling | record |
|---|---|---|
| 2026-11-18 | Restraint: no new colour, no new tint; the console's six principles govern every component | console-ui-system.md §2.3, §2.1 |
| 2026-11-23 | The XTRM-853 design page is superseded by console-ui-system.md | console-ui-system.md §16 (supersession note) |
| 2026-11-25 | Working presence: build option B, the agent list above the composer | XTRM-1024 seq3; docs/design/working-presence.md:48 |
| 2026-11-25 | A read-only `tmux capture-pane` may detect permission prompts; nothing may send keys for them | XTRM-1024 seq3; server/attention.ts:123-141 |
| 2026-11-25 | Interrupt and approve/deny are shown, never clicked: a send-keys that changes agent state is out | XTRM-1024 seq3 |
| 2026-11-25 | Restyle = the t3code audit's top ten plus our ideas (delivery state, new-since divider, quiet hint, failure roll-up); the contrast fix is ink-faint → ink-muted for text | XTRM-1024 seq3; docs/design/t3code-chat-audit.md:482 |
| 2026-11-25 | The user bubble and the composer radius is 10px, not t3code's 16px | XTRM-1024 seq2 |
| 2026-11-25 | 24px tool rows are a documented transcript exception to the console rows | XTRM-1024 seq2; console-ui-system.md §4.2.1 |
| 2026-11-25 | The viewer sits in the console shell, built from console primitives, with the console's values | XTRM-1044; docs/design/console-shell-spike.md |
| 2026-11-25 | Palettes stay as themes and switch at the top for now; the operator decides which one stays | XTRM-1024 seq13; docs/design/palette-console.md:3-6 |
| 2026-11-25 | Presence pill border matches the background; message action rows never wrap | XTRM-1024 seq13; docs/design/palette-console.md:81-103 |
| 2026-11-25 | All roles remain; role text is bold for every role | XTRM-1024 seq13; src/components/sidebar/SessionTree.tsx:31 |
| 2026-11-25 | Sidebar pane metadata shows the repository, not the cwd | XTRM-1024 seq13; server/repo.ts:34 |
| 2026-11-25 | Console palette restores the original switcher selected state; Threads gets stronger contrast on both switch controls; a folder glyph precedes the repo name | XTRM-1024 seq14; 67a9d596 |
| 2026-11-25 | Push only, no PR | XTRM-1024 seq13 |
| 2026-11-25 | One explicit state model replaces incremental heuristics, proven by a real-transcript replay harness | XTRM-1024 seq12; XTRM-1043; docs/design/working-presence.md §8 |
| 2026-11-25 | The pane row's line 2 carries no state word; the dot carries the state, as in the thread | XTRM-1048; src/lib/status-dot.ts:44 |
| 2026-11-26 | All five palettes stay — Threads, Threads soft text, Console, Console soft text, Desktop — as the base for theming in the app and later the console; the default remains Threads | XTRM-1024 seq17; src/lib/palette.ts:15-17 |

## 7. Open questions

1. **Dead sidebar state code.** `stateOf` and `STATE_LABEL` in `src/lib/tree.ts` are unused by production
   code since the dot carries the state; `test/sidebar-tree.test.ts` still asserts the three-state
   mapping. Removal is a code change and belongs to a separate issue (follow-up candidate from
   XTRM-1048); this document does not delete them.
2. **The README describes the old pane row.** `README.md:32-34` still says line 2 shows the state and that
   "no state is proven to need attention", which XTRM-1043 (attention) and XTRM-1048 (no state word)
   changed; `README.md:44` gives the indent step as 0.75rem, while `src/components/sidebar/geometry.ts:13`
   has `INDENT_REM = 0.5`. The README needs its own revision; it is out of this issue's scope.
3. **Which palette stays — resolved 2026-11-26.** All five stay and become the base for theming in the
   app; the default remains Threads (§6, XTRM-1024 seq17). The Colours switch moves into a settings page
   when one exists; until then it stays in the header (`XTRM-1024` seq17).
4. **Presence panel shortcut.** No global shortcut opens the presence panel; the proposal is none in v1
   (`docs/design/working-presence.md:310`).
5. **Agents outside the scope.** The presence line counts only the scope; the proposal, not yet ruled, is
   to keep it that way and let the sidebar show the rest
   (`docs/design/working-presence.md:311-312`).
6. **Interrupt and approve.** Rows for an interrupt and a pending approval are designed but not built,
   because the operator ruled that nothing may change agent state (`XTRM-1024` seq3). Building them needs
   a new ruling.
