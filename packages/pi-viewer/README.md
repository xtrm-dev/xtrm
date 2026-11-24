# pi viewer

A small, read-only web viewer for pi agent sessions that run inside tmux.
One tmux session is one channel. Agents are the pi panes in that tmux session.

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

## Views

**Channel** is the default. It shows user messages and the final reply of each
agent turn. Tool calls, tool results, thinking, and notices are collapsed under
the final reply behind a chevron. A turn with no final reply is shown as
working. The channel follows the active branch of each session file, so
rewound or compacted-away events stay out of the conversation.

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
npm run typecheck
npm run build
```

Live API checks:

```bash
curl -s http://127.0.0.1:5199/api/sessions
curl -s 'http://127.0.0.1:5199/api/thread?session=xx&meta=1'
curl -s 'http://127.0.0.1:5199/api/thread?session=xx'
```
