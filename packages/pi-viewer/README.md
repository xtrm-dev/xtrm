# pi viewer

A small, read-only web viewer for pi agent sessions that run inside tmux.
One tmux session is one channel. Agents are the pi and Claude Code panes in that tmux session.

The viewer reads session JSONL files and injects prompts with `tmux send-keys`.
It never attaches to a pane, never proxies the agent, and never takes process
ownership.

## Run

```bash
npm install
npm run dev        # http://127.0.0.1:5199
```

Production build:

```bash
npm run build
npm run preview    # http://127.0.0.1:5199
```

`npm run preview` is the whole production serve: the `/api` middleware comes from `server/plugin.ts`
(`piViewerApi()` in `vite.config.ts`), so it runs under the dev server and under `vite preview` alike.
There is no separate node entry point today; mounting `handleApi` in your own server is possible but
then that server also has to serve `dist/` (XTRM-1067).

To take cold-load numbers for a serve, point the measurement script at it. It opens an empty cache,
navigates once, and reports the request count, the encoded bytes, and the time to the first message
bubble:

```bash
node scripts/load-check.mjs http://127.0.0.1:5199/ preview
```

Measured on 2026-11-26, 1440x900, real sessions, one cold load each:

| serve | requests | encoded bytes | JS | fonts | first message bubble |
|---|---|---|---|---|---|
| `npm run dev` | 75 | 15,505,647 | unbundled modules | 43,884 | 4,539 ms |
| `npm run preview` | 10 | 669,909 | 188,943 | 43,884 | 2,060 ms |

The remaining bytes in the preview row are the thread JSON (two `/api/thread` calls, 422 kB in that
session). That payload, not the bundle, is now the largest single cost of a cold load.

The build splits into a `react` chunk, a `markdown` chunk and the app chunk, and loads `AllEventsView`
on demand, so no chunk exceeds 500 kB. The shell's resize no longer pulls in motion-panels: it is
`src/shell/resizable.tsx`, 80 lines of pointer and keyboard code with the console's values. Fonts are
the two latin faces only (XTRM-1067).

Requirements: Linux (`/proc`), tmux, and pi sessions under `~/.pi/agent/sessions`.
The server binds to `127.0.0.1` only and has no authentication.

## Sidebar

The left sidebar is a tree of tmux session > window > pane. Only panes that hold a pi or claude agent are
listed; windows and sessions without an agent are omitted. Session and window rows are one 28px line: the name, a small chevron right after it, and the agent count.
A window that holds a single pane has no row of its own: its pane sits directly under the session, and the
window name is in the pane's tooltip. A pane row is two lines (48px): the agent name, then the role, the runtime (`Claude` or `Pi`) and the repo. The role is plain text at the line's size; only Lead and Manager are bold and coloured (the thread view's role colours), with one
small static status dot on the right (idle, running, error; the server's `waiting` is a finished turn, so it
reads as idle, and no state is proven to "need attention"). The dark sidebar plane is `#181818`, a quiet step from the `#0d0d0d` viewport. Every level is a selectable scope (see Scope and URL below). The sidebar sits in the console's shell
(XTRM-1044, `src/shell`, `docs/design/console-shell-spike.md`): the Work / Agent switcher and the collapse button in a 44px header,
a drag-resizable plane (264px, 220 to 360, saved in localStorage `xtrm.console.layout.v1`), collapse to width 0 with the reopen
button in the top bar, and Ctrl/Cmd+B. On a narrow screen the sidebar is an overlay, closed by default, that closes on Escape,
on a click outside, or when a row is chosen; only the desktop open/width choice is persisted.

It is built from the console's primitives, not ReUI or shadcn Sidebar. The values (28px row, type ladder,
`--x-hover` selected fill, no accent marker) are
copied from `packages/xtrm-app` (`docs/design/console-ui-system.md` §3, §4.2, §4.3, §6, §11 and
`src/agent/AgentSidebar.tsx`, `src/ui/sidebar.tsx`, `src/ui/nav-rail.tsx`), except one deliberate narrowing: the
indent step is 0.75rem (the console's `INDENT_REM` is 1.25). `src/components/sidebar/geometry.ts`
names the source of each. The tree is keyboard operable (`role="tree"`, `aria-expanded`, roving focus; arrows,
Home, End, Enter, Space).

### Browser gate

`scripts/sidebar-gate.mjs` checks the sidebar against a running viewer at 1440 and 390 wide, dark and light
(28px rows, no rails, scopes, URL, reload, keyboard, the console shell's width, drag limits, persistence and collapse, mobile overlay, no console errors or
warnings). It only clicks the UI. Usage: `PI_VIEWER_URL=http://127.0.0.1:5199/ node scripts/sidebar-gate.mjs [screenshot-dir]`;
set `PLAYWRIGHT_MODULE` and `CHROMIUM_PATH` if playwright or its browser are not installed here.

## Scope and URL

Each sidebar level is a scope, and the thread, All events, composer and @-mention list all follow it:

| click | scope | thread |
|---|---|---|
| a session row | session | the combined Channel of every agent in that tmux session (the default on a fresh page: `xx`, else the first session with agents) |
| a window row | window | only that window's agents, on the same settle-time timeline |
| a pane row | pane | one agent; the composer is addressed to it |

A row selects its scope; the chevron (or ArrowRight / ArrowLeft) expands and collapses. Enter and Space select the focused row.
The composer's **To** picker and the @-mention list show the agents of the scope (a window lists that window's
agents; a pane lists itself), and the composer addresses the pane itself, else the most recently active agent
of the scope. All events and its agent tabs show only the scope's agents. In a pane scope the pane's own
intercom cards stay, sent and received. The viewer filters the already-fetched session payload; the server
is not asked for a scope.

The scope is in the URL, so a reload, a bookmark and Back/Forward keep it:

```
?s=xx                    session scope
?s=xx&w=%403             window scope (tmux window id @3, percent-encoded)
?s=xx&w=%403&p=%2527     pane scope: pane id %27, last seen in window @3
```

`p` needs a `%`-prefixed pane id and `w` a tmux window id (`@N`); old URLs with a numeric window index still
resolve once and are rewritten to the stable id. A malformed value is ignored and the URL degrades to the nearest
valid scope. A scope whose target has vanished falls back one level: a vanished pane to its window (the stable
window id is why the pane scope carries it), a vanished window to its session, a vanished session to the default.
A click on the sidebar adds a history entry; a fallback replaces the current one. Clicking the pane that is
already selected adds none (a pane is identified by its id; `w` is only where it was last seen), and Back or
Forward to a stale or invalid URL rewrites the address bar to the scope it resolved to.

Polls do not move the scope on a hiccup. The page-open URL is read only until a scope has resolved, so it never
replaces a later selection. A poll that finds no agent at all (an empty or failed discovery) changes nothing. A
scope whose target is absent is kept for two polls and degrades along the chain on the third consecutive absent
poll; if the target is back before that, nothing happened. Any poll counts: the 1.5 s thread poll and the 10 s discovery poll.

## Views

**Channel** is the default. It is a timeline: operator messages appear at their
send time, and each agent turn appears at the event that settles it (the final
assistant reply). A turn that is still running is always last. This keeps
overlapping agents in causal order when one prompt is sent while another agent
is still working. Tool calls, tool results, thinking, and notices are collapsed
under the final reply behind a chevron. The channel follows the active branch of
each session file, so rewound or compacted-away events stay out of the
conversation.

**All events** is a flat chronological inspection list. Each row is one raw
JSONL event with time, agent, kind, and a one-line summary. Select a row to see
the complete tool input, output, and raw JSON. Filter to one agent with the
quiet tabs above the list.

The composer sends to the selected agent pane with:

```bash
tmux send-keys -t <pane-id> -l -- <text>
tmux send-keys -t <pane-id> Enter
```

Newlines are flattened to spaces for this version. `@` opens an agent list.
The user message is appended optimistically and disappears when the matching
user event appears in the session file.

## Claude Code agents

A tmux pane that runs `claude` appears beside the pi panes with `provider: "claude"`.
The viewer reads the transcript under `<config>/projects/<cwd, non-alphanumerics as "-">/<session-id>.jsonl`
(`CLAUDE_CONFIG_DIR` of the claude process, else `~/.claude`). It never attaches.

Pane to transcript matching, in order:

1. **registry**: `<config>/sessions/<pid>.json` names the session id of that claude pid. The entry counts
   only when its `procStart` equals the process start time in `/proc/<pid>/stat`.
2. **newest-since-start**: otherwise the newest transcript in the cwd's project directory that was written
   after the process started and that no other pane or live claude process owns.

Transcript records are converted to the Pi event model in `server/claude.ts`: one assistant message spread
over several records becomes one event; each `tool_use` gets its own event and its `tool_result` pairs by
`tool_use_id`; `isSidechain` records are off-branch (All events only); hook and `<system-reminder>` user
records are meta; the `<cross-session-message>` envelope goes through `server/intercom.ts`; wire telemetry
(`api-request*`, `data-flow-*`, `mode`, …) is dropped. The pane name is the transcript's `custom-title`,
else `agent-name`, else the cwd basename plus the short session id.

A prompt typed into a busy pane is queued by Claude. `queue-operation` enqueue with content becomes a
queued operator row; `remove` plus a `queued_command` attachment of mode `prompt` updates that row in place
at the attachment time; `dequeue` plus a normal user record shows only the normal turn. A queued row carries
the `Queued` delivery mark, and its key does not change on delivery, so the bubble is never remounted.

Pi keeps steering and follow-up prompts in memory until it delivers them. Its transcript has no queue
record, so a prompt typed into a busy pi pane appears only on delivery, as a normal operator message.
The composer's optimistic row covers sends made from the viewer.

## Roles

The launcher records a role in the pane option `@agent_role`. The viewer reads it
with the pane list and shows a chip beside the agent name: **Manager** blue,
**Lead** green, **Worker** gray, each solid with white text. `coordinator` uses
the manager tone. Any other role (`debugger`, `executor`, `reviewer`, …) gets a
dimmed neutral chip; a pane with no role gets no chip. Nothing is inferred from
the session file, so a changed role appears on the next sessions poll.

## Agent messages

Peer traffic is not folded into tool activity. Pi's `SendMessage` tool, the
older `intercom` tool, and the legacy `intercom_sent` / `intercom_received`
custom entries become `intercom` events.

Incoming messages are recognised in both formats: the current
`<cross-session-message>` envelope used by Pi and Claude sessions, and the
older `**From <name>**` header. The full body is kept (up to 40,000
characters) and rendered as Markdown. The Channel card shows three rendered
lines with a `Show more` control; the full body remains available in the
expanded card and in All events.

A send's tool result is attached back to its card by tool call id. A failed
send stays in the thread: the card gets a red delivery mark and an inline
failure reason, instead of disappearing into the meta stream. Each card keeps
its own delivery state, including when one entry issued several messages. Successful delivery
gets a green check; a send without a result yet gets a muted check.

A sent message appears under the sender's reply. A received message appears
before the turn it triggered. When both sides of the same message are in the
channel, one card is shown: the send keeps its timestamp and position, and the
receiver supplies the message id. Matching uses the message id, or the agent
pair plus the normalised body within a 30-minute window (receivers can hold a
message while they finish a turn).

`uds:/run/user/1000/cc-socks/<pid>.sock` targets resolve to a name through
`~/.claude/sessions/<pid>.json`, so Pi-to-Claude traffic shows the Claude
session name instead of a socket path.

This version discovers pi panes only. Intercom messages that arrive in a pi
session are shown; a full Claude Code transcript channel is not included.

## Data model

1. `tmux list-panes -a` finds panes.
2. Each pane's process descendants are checked for a `pi` process.
3. The pi process cwd is encoded to the session directory format
   (`--home-user-dev-project--`) under `~/.pi/agent/sessions`.
4. The newest session file is used, or the file whose `session_info.name`
   matches the pane title.
5. Session JSONL is parsed incrementally. The active branch is the parentId
   chain from the last entry.
6. The browser reads the newest 150 turns first, then polls sequentially with
   `since=<cursor>&revision=<id>`; a poll returns only new or changed events.
   `limit` bounds a window and `before=<cursor>` loads the previous page. The
   client never starts a poll while one is in flight and backs off after a slow
   response (5 s over 800 ms, 10 s over 2 s). All-event detail is loaded on
   demand.

Each agent transcript is normalized once and then updated entry-by-entry
(Claude's in-place entry mutation is tracked by entry revision). The session
cache keeps a sorted event list and one monotonic cursor per event, so an
unchanged poll is a few bytes. A revision change (server restart, file shrink,
agent set change) makes the client reload the window instead of merging across
a broken cursor space. The Channel payload omits meta events; the inspection
payload carries summaries only (and a 160-character intercom prefix for pairing).
JSON responses are gzip-compressed when the client accepts it. Event detail uses
an append-only normalized cache: the first expand of a revision normalizes the
new entries, later expands resolve by `seq` in constant time.

## Layout

```
server/
  api.ts        HTTP routes, payload shaping, send-keys
  discover.ts   tmux panes -> pi processes -> session files
  intercom.ts   agent-message normalisation (Pi and Claude envelopes)
  peers.ts      Claude/Pi socket address resolution
  session.ts    incremental JSONL parsing and event normalisation
  thread-cache.ts  agent/session caches, cursors and turn paging
  plugin.ts     Vite dev/preview middleware
src/
  components/   channel, all-events, composer, activity disclosure, primitives
  lib/          api client, turn grouping, formatting, details
  shared/       wire types
```

UI primitives follow the shadcn AI Elements chat patterns (`Message`,
`MessageScroller`, `Bubble`, `Collapsible`) and use the `--x-*` console tokens
from `packages/xtrm-app/src/styles.css`.

## Checks

```bash
npm test
npm run typecheck
npm run build
npm run test:anchor
npm run test:follow
npm run test:flicker   # send → echo must reuse one bubble
npm run test:queue     # queued prompt → delivered keeps one row
npm run test:stop      # Stop while working sends one /api/stop, Esc on an empty box does the same
npm run measure:load http://127.0.0.1:5199/   # cold-load numbers, see Run
```

`npm test` covers the ordering invariant (settle anchors, pending last, stable
ties), intercom pairing, and the incremental/earlier page merge. `npm run test:anchor` starts an isolated Vite
instance on port 5198 with a deterministic fixture and drives headless Chromium
to prove that a poll growing or appending content above the viewport does not
move the reader's anchor, and that the bottom stays pinned. `npm run test:flicker`
sends into a mocked thread and fails if the optimistic bubble is removed and
re-added when the transcript echo arrives. `npm run test:queue` drives a mocked
Claude queue: a queued row must show the Queued mark, keep the same DOM node when
the attachment arrives, and show once. `npm run test:stop` mocks the send path and
proves the stop ruling (XTRM-1088): a working target offers Stop, one click and one
Esc on the empty box each send exactly one `/api/stop` for the target's own pane, and
an idle target offers none; the server-side mapping (`send-keys … Escape`, listed
panes only) is unit-tested in `test/stop.test.ts`, so no check here can reach a pane. Both need the Playwright Chromium download
(`npx playwright install chromium`).

Live API checks:

```bash
curl -s http://127.0.0.1:5199/api/sessions
curl -s 'http://127.0.0.1:5199/api/thread?session=xx&meta=1'
curl -s 'http://127.0.0.1:5199/api/thread?session=xx&limit=5'
curl -s 'http://127.0.0.1:5199/api/thread?session=xx&since=<cursor>&revision=<id>'
```
