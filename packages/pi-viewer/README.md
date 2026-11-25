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

Requirements: Linux (`/proc`), tmux, and pi sessions under `~/.pi/agent/sessions`.
The server binds to `127.0.0.1` only and has no authentication.

## Sidebar

The left sidebar is a tree of tmux session > window > pane. Only panes that hold a pi or claude agent are
listed; windows and sessions without an agent are omitted. Session and window rows are one line with an
agent count and expand/collapse. A pane row has two lines: the agent name, then `role · state`, with one
status dot (idle, running, needs attention, error). Clicking a pane loads that agent's thread. The sidebar
collapses to an icon rail of status dots; on a narrow screen it starts as the rail and opens over the thread.

It is built from the console's primitives, not ReUI or shadcn Sidebar. The values (28px row, 264px plane,
`INDENT_REM` 1.25, type ladder, `--x-hover` selected fill with the 2px accent marker, hairline rails) are
copied from `packages/xtrm-app` (`docs/design/console-ui-system.md` §3, §4.2, §4.3, §6, §11 and
`src/agent/AgentSidebar.tsx`, `src/ui/sidebar.tsx`, `src/ui/nav-rail.tsx`); `src/components/sidebar/geometry.ts`
names the source of each. The tree is keyboard operable (`role="tree"`, `aria-expanded`, roving focus; arrows,
Home, End, Enter, Space).

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
characters) and rendered as Markdown; the viewer does not cut it into a
tool summary.

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
6. The browser polls a version endpoint every 1.5 s and refetches only when a
   file's size or mtime changes. All-event detail is loaded on demand.

Parsed files are cached by path, mtime, and size so polling does not re-parse
unchanged sessions.

## Layout

```
server/
  api.ts        HTTP routes, payload shaping, send-keys
  discover.ts   tmux panes -> pi processes -> session files
  intercom.ts   agent-message normalisation (Pi and Claude envelopes)
  peers.ts      Claude/Pi socket address resolution
  session.ts    incremental JSONL parsing and event normalisation
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
```

`npm test` covers the ordering invariant (settle anchors, pending last, stable
ties) and intercom pairing.

Live API checks:

```bash
curl -s http://127.0.0.1:5199/api/sessions
curl -s 'http://127.0.0.1:5199/api/thread?session=xx&meta=1'
curl -s 'http://127.0.0.1:5199/api/thread?session=xx'
```
