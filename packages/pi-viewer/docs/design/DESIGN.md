# pi viewer — design document

Version 2, 2026-11-26 (XTRM-1068). Supersedes the draft of 2026-11-25 (XTRM-1049).

This document records what the viewer is and how it is built. Every behavioural claim cites a file and
line, or a Substrate journal entry. Line numbers refer to the tree that carries this document. Where a
value lives in CSS, the citation is `src/styles.css`; where it lives in a component, the citation is that
component. Nothing here is a proposal: proposals and unresolved gaps are in §11.

The design language is the console's. `packages/xtrm-app/docs/design/console-ui-system.md` is the
authority for the language; this document is the authority for the viewer's use of it.

## 1. Purpose and scope

The viewer is a local web application that renders the work of one tmux session as a channel. One tmux
session is one channel; the agents are the `pi` and Claude Code panes inside it. The server reads the
agents' transcripts from disk, never attaches to a pane and never owns an agent process
(`README.md:6`). The only write it can perform is `tmux send-keys` for a message the operator sends from
the composer (`README.md:140-141`). It binds to `127.0.0.1` and has no authentication
(`README.md:53`).

In scope: the reading experience of one operator watching several agents, and answering them.

Out of scope, by decision: starting, steering or approving an agent. Stopping is in scope since
2026-11-26: Escape to the agent's own pane, from the composer, while it works (XTRM-1088). Rows for an interrupt and
a pending approval are designed but not built, because nothing may change agent state (XTRM-1024 seq3,
§11).

The document covers the browser client, the shape of the server it depends on, the design system it
wears, and the evidence behind each. Sibling documents go deeper in one area each:
`docs/design/working-presence.md` (turn state model), `docs/design/palette-console.md` (region and
contrast audit), `docs/design/t3code-chat-audit.md` (the restyle audit), `docs/design/console-shell-spike.md`
(the shell), `docs/design/spacing-reference.md` (a density guide, not a source of truth).

## 2. Principles

1. **Restraint.** No new colour and no new tint outside the console's token set. Every surface either
   wears an existing token or explains its scoped departure here (console-ui-system.md §2.3).
2. **One shape per state.** A state looks the same on every surface that shows it. The status dot is the
   one place this is enforced in code: a single table serves the thread, the presence line and the
   sidebar (`src/lib/status-dot.ts:13`, `:44`).
3. **The transcript is the source of truth.** The interface derives rows from records and never guesses
   an outcome. A prompt is `Sent` when the keys reached the pane, `Seen` when the record exists,
   `Replied` only when a later turn settled (`src/lib/delivery.ts:13-49`).
4. **The reader's place is not disturbed.** No layout animation, no row that changes height when it
   enters the viewport, no scroll that fights the reader's own gesture
   (`src/styles.css:579-581`, `src/lib/stick.ts:8`).
5. **Motion carries meaning or it does not happen.** Opacity and a translate of at most 4px, nothing
   that changes layout, and every animation has a `prefers-reduced-motion` branch
   (console-ui-system.md §18; `src/styles.css:583-617`, `:738-748`).
6. **A word can leave the screen, never the accessibility tree.** The sidebar dropped the state word in
   favour of the dot; the word stayed as the dot's `aria-label`, its tooltip and part of the row's label
   (XTRM-1048; `src/lib/status-dot.ts:71-90`).
7. **Every value is a token.** No component holds a raw colour; the `@theme` block is the only bridge
   from `--x-*` to utility classes (`src/styles.css:227-311`).
8. **Quiet by default.** Chrome does not shout: metadata reveals on hover except where the operator
   ruled that it reads at rest, and the transcript itself is the only loud element.

## 3. Architecture

### 3.1 Server (`packages/pi-viewer/server`)

The server is a Vite plugin that answers `/api/*` and nothing else (`server/plugin.ts:24`). It runs under
`npm run dev` and under `npm run preview` alike, because the middleware comes from the plugin
(`README.md:24-25`).

| module | responsibility |
|---|---|
| `server/api.ts` | HTTP routes and payload shaping: `/api/health`, `/api/sessions`, `/api/thread`, `/api/event`, `/api/send`; the only writer is `/api/send`, which runs `tmux send-keys -l` then `Enter`. Also the scope parameters, the encoded-frame cache and the discovery snapshot (XTRM-1066). |
| `server/discover.ts` | `tmux list-panes -a` → each pane's process descendants → the `pi` or `claude` process → its cwd, repository and session file. `discoverAsync` runs on a timer off the request path; `discover` stays synchronous for callers that cannot await (XTRM-1066). |
| `server/session.ts` | incremental JSONL parsing and event normalisation; the one effect classifier `entryEffect` (`:625`); the status derivation `statusOf` (`:701`) with the 15-minute quiet window (`QUIET_MS` `:574`) and the write clock `lastWriteAt` (`:691`). |
| `server/claude.ts` | Claude Code transcript resolution, pane naming (`custom-title`, else `agent-name`, else the cwd basename plus short session id), and conversion of Claude records to the Pi event model (`normalizeClaudeEvent` `:810`). |
| `server/intercom.ts` | agent-message normalisation for both envelopes, delivery pairing by tool call id, and the pair key that merges the two sides of one message. |
| `server/peers.ts` | resolves a `uds:` socket address to a peer name, so a card never shows a socket path. |
| `server/repo.ts` | the repository name of an agent cwd, from the git common dir (`:34`). |
| `server/thread-cache.ts` | per-agent and per-session caches, one monotonic event cursor per event, a `ScopeView` per (scope, agent set), and turn paging (`ThreadQuery`, `cachedThread`, `invalidateThread`). |
| `server/stat-pass.ts` | one `statSync` and one `readdirSync` per file or directory per discovery pass, so a poll does not stat the same path again (XTRM-1066). |
| `server/attention.ts` | the only behavioural read of a live pane: `tmux capture-pane -p -J` of the visible screen, 5 s after a turn opens and every 2 s after that, at most 4 reads in flight, parsed for a permission prompt and applied on top of the state model (`:231`). It never sends a key. |

### 3.2 Client (`packages/pi-viewer/src`)

`src/App.tsx` is the shell and the owner of all polling. Its render tree is the console shell
(`src/App.tsx:458`), the header (`:472`), the scroller provider (`:515`), the Channel or All-events view
(`:528`, `:552`), the presence line (`:574`) and the composer (`:590`). The All-events view is a lazy
chunk (`:51`).

| part | source |
|---|---|
| shell: resizable sidebar plane, collapse, Ctrl/Cmd+B, narrow overlay | `src/shell/ConsoleShell.tsx:50-65`, `src/shell/layout.ts:12-93`, `src/shell/resizable.tsx` |
| sidebar tree: tmux session > window > pane, keyboard tree | `src/components/sidebar/Sidebar.tsx:33`, `src/components/sidebar/SessionTree.tsx:202` |
| scope: URL, fallback, poll grace | `src/lib/scope.ts` |
| thread model: effects, turns, timeline order, intercom pairing | `src/lib/thread.ts` |
| turn state machine (status, grouping) | `src/lib/turn-state.ts:66`, `:99` |
| delivery: what the operator can know about a prompt | `src/lib/delivery.ts:13-60` |
| status dot: one table for every surface | `src/lib/status-dot.ts:13-90` |
| presence model: live entries, stopped rows, split | `src/lib/presence.ts` |
| read state: last seen, new-since index | `src/lib/readstate.ts:69-103` |
| chat width: presets, custom, one lane variable | `src/lib/chat-width.ts:12-18`, `src/styles.css:750-771` |
| palette: five palettes, soft-text layer | `src/lib/palette.ts`, `src/styles.css:169-225` |
| composer: target row, agent menu, reply bar, send | `src/components/Composer.tsx`, `src/lib/composer-meta.ts`, `src/lib/reply.ts:14-41` |
| scroll policy: follow, pin on send, anchors | `src/lib/stick.ts:8`, `src/components/ui/message-scroller.tsx` |

### 3.3 Data flow, transcript to row

<!-- diagram: architecture -->

The Channel is a settle-time timeline: an operator message sits at its send time, an agent turn sits at
the event that settles it (the final reply), and a running turn is always last. Ordering among items of
different rank is fixed by `compareChannelItems`: user, inbound, optimistic, turn, sent
(`src/lib/thread.ts`).

### 3.4 Incremental polling and the scope-aware window

The browser loads the newest 150 turns, then polls with `since=<cursor>&revision=<id>`; a poll returns
only new or changed events, `before=<cursor>` pages backwards, and the client never starts a poll while
one is in flight (`README.md`, "Data model"). The thread poll backs off to 5 s above 800 ms and 10 s
above 2 s of response time; discovery runs on the server.

Since XTRM-1066 the request carries the reading scope: `p=<paneId>` or `w=<windowIndex>` narrows the
window server-side, a malformed scope is a 400, and the revision is tagged per scope, so a scope change
is a fresh window rather than a client-side filter over a session-sized payload. Repeat polls at the
same cursor are answered from a cached encoded frame keyed by (query, scope, agent-list hash, cursor,
revision); a changed agent set returns a reset rather than merging across a broken cursor space
(`server/thread-cache.ts`, `server/api.ts`; XTRM-1066 journal).

A scope change inside one session keeps the previous screen until the scoped window arrives, and does
not clear optimistic messages (`src/lib/api.ts`, `src/App.tsx`; XTRM-1066). Rows therefore never flash
empty on a click.

## 4. Design language

### 4.1 Colour: five palettes, one token set

All colour is a CSS variable on `:root` (`src/styles.css:34-116` light, `:118-163` dark), exposed to
Tailwind v4 through `@theme` so no component holds a raw colour (`:227-311`). A palette is a set of
region assignments and, for Desktop, plane values; a theme is light or dark; a soft-text variant is a
text-only layer on top of a base palette.

Five palettes ship: **Threads** (default), **Threads · soft text**, **Console**, **Console · soft text**
and **Desktop** (`src/lib/palette.ts:15-17`; operator ruling 2026-11-26, §10). The header's Colours
control sets `data-palette` on `<html>` and the choice persists in `localStorage`; a theme sets
`data-theme`; a soft-text palette keeps its base's `data-palette` and adds `data-text="soft"`
(`src/lib/palette.ts`, `src/styles.css:210-225`). A switch rewrites variables only: no component fork,
no reload, no scroll change.

#### 4.1.1 Threads — the full token set

Every token below is declared in `src/styles.css:34-116` (light) and `:118-163` (dark).

| token | light | dark | role |
|---|---|---|---|
| `--x-deep` | `#f4f4f5` | `#0d0d0d` | page plane under everything |
| `--x-sidebar` | `#f4f4f5` | `#181818` | the sidebar plane |
| `--x-surface` | `#ffffff` | `#151515` | cards, composer, quiet panels |
| `--x-raised` | `#ffffff` | `#1e1e1e` | popovers, presence panel |
| `--x-control` | `#efeff1` | `#262626` | controls, operator bubble, code chips |
| `--x-segment` | `#ffffff` | `#4d4d4d` | selected segment of a segmented control |
| `--x-hover` | `rgb(15 15 20 / 0.045)` | `rgb(255 255 255 / 0.03)` | hover wash, selected row in list |
| `--x-pressed` | `rgb(15 15 20 / 0.08)` | `rgb(255 255 255 / 0.06)` | pressed state, track |
| `--x-ink` | `#18181b` | `#ececef` | primary text |
| `--x-ink-muted` | `#5f5f68` | `#a0a0a8` | meta, time, resting icons, quiet text |
| `--x-ink-faint` | `#94949c` | `#6a6a72` | third text step; not used for the sidebar dot |
| `--x-border-muted` | `rgb(15 15 20 / 0.07)` | `rgb(255 255 255 / 0.08)` | default hairline |
| `--x-border-subtle` | `rgb(15 15 20 / 0.04)` | `rgb(255 255 255 / 0.06)` | table grid only |
| `--x-border` | `rgb(15 15 20 / 0.11)` | `rgb(255 255 255 / 0.12)` | control border |
| `--x-border-strong` | `rgb(15 15 20 / 0.2)` | `rgb(255 255 255 / 0.18)` | focus ring, soft separator |
| `--x-github` | `#24292f` | `#f0f6fc` | the send glyph, bare since XTRM-1149 |
| `--x-github-hover` | `#32383f` | `#ffffff` | send glyph hover |
| `--x-github-ink` | `#ffffff` | `#24292f` | ink on a filled github button; unused since XTRM-1149 |
| `--x-accent` | `#4f46e5` | `#818cf8` | selection, focus, references, working dot |
| `--x-accent-ink` | `#4338ca` | `#a5b4fc` | accent as text and links |
| `--x-accent-soft` | `rgb(79 70 229 / 0.1)` | `rgb(129 140 248 / 0.12)` | accent tint, selection |
| `--x-danger` | `#c42b2b` | `#f07171` | failure, error dot |
| `--x-success` | `#1b7f46` | `#5ccb8a` | success, waiting dot |
| `--x-success-ink` | `#146839` | `#5ccb8a` | success as text (4.5:1 on its tint) |
| `--x-role-manager` | `#2563eb` | `#2563eb` | Manager chip fill |
| `--x-role-lead` | `#15803d` | `#15803d` | Lead chip fill |
| `--x-role-worker` | `#52525b` | `#52525b` | Worker chip fill |
| `--x-role-manager-ink` | `#2563eb` | `#6b9bff` | Manager label as text |
| `--x-role-lead-ink` | `#15803d` | `#5ccb8a` | Lead label as text |
| `--x-diff-add` / `--x-diff-del` | `#1b7f46` / `#c42b2b` | `#5ccb8a` / `#f07171` | diff counts |
| `--x-shadow-float` | `0 10px 30px -12px rgb(15 15 20 / .22), 0 0 0 1px rgb(15 15 20 / .06)` | `0 18px 44px -12px rgb(0 0 0 / .72), 0 0 0 1px rgb(255 255 255 / .08)` | floating layers |
| `--x-shadow-panel` | `0 10px 30px -12px rgb(15 15 20 / .22)` | `0 18px 44px -12px rgb(0 0 0 / .72)` | panel without a hairline |
| `--x-strip` | `var(--x-raised)` | `#1c1c1c` | foot strip |
| `--x-strip-open` | `var(--x-control)` | `#262626` | foot strip, open |
| `--x-strip-ink` | `var(--x-ink-muted)` | `rgb(255 255 255 / 0.72)` | foot strip text |
| `--x-strip-ink-strong` | `var(--x-ink)` | `#ffffff` | foot strip emphasis |
| `--x-strip-ink-faint` | `var(--x-ink-faint)` | `rgb(255 255 255 / 0.45)` | foot strip meta |
| `--x-strip-rule` | `var(--x-border-muted)` | `rgb(255 255 255 / 0.12)` | foot strip hairline |
| `--x-strip-chip` / `--x-strip-chip-ink` | `var(--x-pressed)` / `var(--x-ink-muted)` | `rgb(255 255 255 / 0.12)` / `rgb(255 255 255 / .78)` | foot strip chips |
| `--x-rail-indent` | `calc(1rem - 1px)` | same | nav rail geometry (`:79`) |
| `--x-rail-gutter` | `1.125rem` | same | nav rail label inset (`:80`) |
| `--x-rail-marker` | `2px` | same | active marker width (`:81`) |
| `--x-rail-pull` | `calc(var(--x-rail-indent) + 1px)` | same | a child row's fill pull (`:85`) |
| `--x-rail-text` | `calc(var(--x-rail-pull) + var(--x-rail-gutter))` | same | aligned label column (`:86`) |

The rail tokens exist for the console's NavRail; the viewer keeps them so a shared token file stays
identical. The viewer draws no rail.

#### 4.1.2 Region roles — which plane each region wears

Region roles are the one indirection that makes a palette a palette (`src/styles.css:101-115`,
`:169-181`). A component asks for a role, never for `--x-surface`.

| role | Threads | Console | Desktop |
|---|---|---|---|
| `--x-canvas` (page, header, thread, presence line, composer margin) | `--x-deep` #f4f4f5 / #0d0d0d | `--x-surface` #ffffff / #151515 | `--x-deep` #1f1f1f |
| `--x-composer-fill` | `--x-surface` #ffffff / #151515 | `--x-raised` #ffffff / #1e1e1e | `--x-surface` #333333 |
| `--x-composer-focus` | `--x-raised` (focus rises a plane; in light, white is the ceiling and the shadow deepens) | `--x-raised` (the fill cannot step: the shadow deepens) | `--x-control` #383838 |
| `--x-composer-shadow` | a light two-part shadow | the same two-part shape at dark alpha | the dark pair |
| `--x-composer-shadow-focus` | the same shape, deeper | the same shape, deeper | the same shape, deeper |

The composer carries no border and no ring in any palette, preset, theme or state (XTRM-1087): the fill
step and the drop shadow are its only separation, and focus either rises a plane or deepens the shadow.

| `--x-inset` (activity detail, intercom card) | `--x-surface` | `--x-control` | `--x-surface` |
| `--x-code` / `--x-code-edge` | `--x-surface` / `--x-border-muted` (light), `transparent` (dark) | `--x-deep` / `--x-border-muted` | `--x-deep` / `--x-border` |
| `--x-read` (thread prose, operator bubble) | `--x-ink` | `--x-ink` | `#c8c8c8` |
| `--x-selected` (selected list row) | `--x-hover` | `--x-hover` | `#454545` |

#### 4.1.3 Console — differences from Threads

The console palette changes assignments and the dark sidebar only; every other token already equals the
console's (`src/styles.css:169-181`). Light: canvas becomes the surface `#ffffff`, the composer steps up
to `#ffffff` with a barely visible hairline (`--x-border-muted`), inset panels become `--x-control`
`#efeff1`, and the code frame becomes the deep plane `#f4f4f5`. Dark: sidebar `#232323`, canvas
`#151515`, composer `#1e1e1e` with no hairline, inset `#262626`, code `#0d0d0d`.

#### 4.1.4 Desktop — the operator's Claude Desktop values

Desktop is dark-only and replaces planes and text roles; region assignments stay the Threads ones
(`src/styles.css:183-208`). In the light theme no block matches, so Desktop in light is the Threads light
set.

| token | value |
|---|---|
| base / canvas (`--x-deep`) | `#1f1f1f` |
| sidebar | `#242424` |
| surface and raised | `#333333` |
| control (input) | `#383838` |
| segment and selected row | `#454545` |
| border | `#383838` |
| ink (names, titles) | `#e4e4e4` |
| read (prose) | `#c8c8c8` |
| ink-muted (meta) | `#a1a1a1` |
| ink-muted inside a selected row | `#c8c8c8` |
| danger | `#f58f8f` |

Not supplied by the operator and therefore inherited from the dark base, marked inferred in
`docs/design/palette-console.md`: `--x-border-muted`, `--x-border-subtle`, `--x-border-strong`,
`--x-ink-faint`, `--x-hover`, `--x-pressed`, `--x-accent`, `--x-danger`. The danger value above is the
one inference that changed: `#f07171` measured 4.1:1 on the focused composer fill `#383838`, so the
palette uses `#f58f8f` at 5.1:1 (`src/styles.css:200`).

#### 4.1.5 Soft text — one text-only layer

A soft-text palette keeps its base's surfaces, borders and accents and overrides four text variables
only (`src/styles.css:210-225`; `test/palette.test.ts` holds the block to that list). Dark only.

| token | value | role |
|---|---|---|
| `--x-ink` | `#e4e4e4` | names, titles, selected rows |
| `--x-read` | `#c8c8c8` | thread prose, operator bubble |
| `--x-ink-muted` | `#a1a1a1` | meta, time, unselected labels, resting icons |
| `--x-ink-muted-selected` | `#c8c8c8` | muted text inside Desktop's `#454545` row |

`#a1a1a1` is one step above the operator's original `#a0a0a0` so muted text reaches 4.5:1 on the
`#383838` input fill (operator ruling 2026-11-26, XTRM-1053).

### 4.2 Type scale

Four steps plus one sub-step, all in `rem` so they follow the operator's root size
(`src/styles.css:302-310`). The console's ladder is console-ui-system.md §3.3; the viewer instantiated
it at these values.

| class | size | line height | px at a 16px root | use in the viewer |
|---|---|---|---|---|
| `text-2xs` | `0.625rem` | `0.875rem` | 10 / 14 | timeline `now` marker, mouse hints, sidebar monograms, intercom floor text |
| `text-xs` | `0.72rem` | `1rem` | 11.52 / 16 | row meta, sidebar line 2, tabs, menu captions |
| `text-sm` | `0.8125rem` | `1.25rem` | 13 / 20 | rows, names, control labels; the body default (`:324-325`) |
| `text-base` | `0.875rem` | `1.375rem` | 14 / 22 | composer target row, chat-width values |
| prose | `0.875rem` / `1.625` | — | 14 / 22.75 | `xtrm-prose` body, operator bubble, intercom body (`:344-352`) |

The composer's prompt is the one step above `text-base`: `0.9375rem` / `1.5rem` (15 / 24), set on the
textarea (`src/components/Composer.tsx:237`). The under-row is one step down at `text-base` (14px), so
the prompt reads as the subject and the target as its caption.

Headings inside rendered markdown: `1.25rem`, `1.125rem`, `1rem`, `0.875rem` with weight 600
(`src/styles.css:367-388`). Code: `0.85em` inline, `0.75rem`/`1.15rem` in a frame (`:418-437`).

### 4.3 Spacing and radii

The spacing scale is the 8px system the operator supplied as a density guide
(`docs/design/spacing-reference.md`): 4, 8, 12, 16, 20, 24, 32, 40, 48; the values in use are 4, 8, 12,
16, 24 and 32. Tailwind's own scale provides them; no spacing token is declared.

| element | value | source |
|---|---|---|
| composer box padding | `12px` all round (`p-3`), right `56px` for the send button | `src/components/Composer.tsx:254` |
| composer text padding | `3.25px` above the line, `4.75px` below (optical centring, XTRM-1087) | `src/components/Composer.tsx:261` |
| composer box, empty | `56px`: `12px` + a `32px` textarea (line `24px` + `8px`) + `12px` | `src/components/Composer.tsx:254` |
| composer send button | `32px` hit area, `16px` bare glyph in the github tone (no fill, no box), `12px` above the box's bottom edge, centred on the text line | `src/components/Composer.tsx:308-319` |
| composer under-row | `6px` below the box, `12px` between items, right edge at the send button's right edge | `src/components/Composer.tsx:267-269` |
| composer stop control | `32px` hit area beside send, a bare `14px` outline square in ink (no fill, no box), drawn only while the target works; Esc in an empty box is the same action | `src/components/Composer.tsx:290-306` |
| sidebar row padding | `8px` horizontally on the tree, `6px` vertically on a pane row | `src/components/sidebar/geometry.ts` |
| thread content padding | `3rem` on a wide screen (`sm:px-12`) | `src/styles.css:757-771` |
| chat lane | `46rem` default, `72rem` wide, custom from `36rem`, Full | `src/lib/chat-width.ts:12-18` |

Radii come from three tokens (`src/styles.css:267-269`): `--radius-sm` 6px, `--radius-md` 8px,
`--radius-lg` 10px. In use: sidebar rows and menu items 8px; the operator bubble, the composer box, the
popover panels and the shell's diagram card 10px; chips, buttons and code chips 6px. The operator ruled
the bubble and composer radius at 10px against t3code's 16px (XTRM-1024 seq2).

### 4.4 Icon ladder

The registry, the sizes and the stroke rule are the console's (`src/shell/icon.tsx:14-64`). A glyph never
exceeds its row's text (console-ui-system.md §3.4).

| step | class | px | use |
|---|---|---|---|
| `micro` | `size-[0.75rem]` | 12 | inline marks inside a label |
| `text` | `size-[0.8125rem]` | 13 | hover actions, delivery marks |
| `xs` | `size-[0.875rem]` | 14 | row chevrons, fold chevron |
| `sm` | `size-4` | 16 | inline chrome, the composer's send glyph |
| `nav` | `size-4` | 16 | nav-level chrome |
| `md` | `size-[1.125rem]` | 18 | panel headers |
| `lg` | `size-5` | 20 | empty states |

Stroke width is 2 at `micro` and `text`, 2.25 above, against lucide's default 2
(`src/shell/icon.tsx:66-67`). The registry carries only the names the viewer uses; a missing name is a
type error, not a runtime fallback.

### 4.5 Motion

Every animation, its reason, and its reduced-motion branch. All of it is in `src/styles.css:583-617` and
`:738-748`; the rules are console-ui-system.md §18.

| name | timing | carries | reduced motion |
|---|---|---|---|
| `viewer-pulse` | `1.6s ease-in-out infinite`, opacity 0.35→1, scale 0.85→1 | a working agent's dot | no animation, opacity 1 |
| `viewer-fade` | `1.8s ease-in-out infinite`, opacity 0.45→1 | a dot that needs the operator; a fold row's `Working` word | no animation, opacity 1 |
| `presence-in` | `150ms ease-out`, opacity 0→1 | a presence row that starts | none |
| `xtrm-shimmer` | `2.2s steps(30) infinite` | a stepped sweep over muted text while a step runs; pauses off-screen via `data-paused` | none |
| `xtrm-fade-in` | `600ms ease-out both` | a block that arrives after first paint; never replays on reopen | none |
| `.xtrm-meta` | `200ms ease-out` opacity | hover reveal of row metadata | no transition |
| composer box | `150ms` background and drop shadow | focus state | none needed (not motion) |
| shell resize | `250ms cubic-bezier(0.32, 0.72, 0, 1)` | the sidebar plane and its collapse, never during a drag | none needed (a user gesture) |
| fold fade | static mask, 4rem eased stops | the cut of a folded message | none needed (not motion) |

The fold fade is a mask, not an overlay colour, so no colour has to match the bubble or card behind it
and the cut has no visible edge (`.xtrm-fold-fade`, `src/styles.css:691-707`). Its stops are eased over
`4rem`: `0.92`, `0.74`, `0.48`, `0.22`, `0.06`, transparent.

### 4.6 Status colour

Status is carried by a dot, never by a word. The mapping is one table per surface, both in
`src/lib/status-dot.ts`.

| state | thread and presence (`STATUS_DOT` `:13`) | sidebar (`SIDEBAR_DOT` `:44`) | word (`:24`, `:71`) |
|---|---|---|---|
| working | `bg-accent viewer-pulse` | `bg-accent viewer-pulse` | Working |
| attention | `bg-accent` | `bg-accent viewer-fade` | Needs you |
| quiet | `bg-ink-faint` | `bg-ink-muted` | Quiet, plus the age from the server's note |
| waiting | `bg-success` | `bg-ink-muted/75`, no dot drawn | Waiting |
| idle | `bg-ink-faint/50` | no dot drawn | Idle |
| error | `bg-danger` | `bg-danger` | Failed |
| unknown | `bg-ink-faint/30` | hollow ring `border-ink-muted/75` | Unknown |

Two differences between the surfaces are deliberate. The sidebar plane is small and every dot must keep
the 3:1 non-text minimum against it, which `ink-faint` misses at 2.74:1 in light and 2.93:1 in the
console dark plane, so the sidebar uses `ink-muted` (`npm run test:contrast`,
`scripts/contrast-check.mjs`). And the sidebar draws nothing for `idle` and `waiting`: the absence of the
dot is the state (operator ruling 2026-11-26, XTRM-1058). The row keeps an empty 14px slot so nothing
shifts when the state changes, and its `aria-label` still carries the word
(`SIDEBAR_DOT_SHOWN` `:60`, `src/components/sidebar/SidebarDot.tsx`).

The dot's label is `Working`, `Needs you`, `Quiet 16m`, `Waiting`, `Failed`, `Idle` or `Unknown`
(`sidebarDotLabel`, `:85-90`). `Quiet` takes its age from the server's note, so the tooltip answers "for
how long" without opening the presence panel.

## 5. Layout

### 5.1 The shell frame

| part | value | source |
|---|---|---|
| header | `44px` (`h-11`), `12px` padding, `16px` from `sm` | `src/components/ViewerHeader.tsx:177` |
| sidebar plane | default `264px`, limits `220`–`360`, persisted as `sidebarWidth` in `xtrm.console.layout.v1` | `src/shell/layout.ts:12-15` |
| resize handle | `8px` hit area, absolutely positioned on the panel's edge and centred, so content starts at the panel's width | `src/shell/resizable.tsx:157-160` |
| resize keyboard | ArrowLeft/Right move `16px`; Home and End go to the limits; the handle is a focusable `separator` with `aria-valuemin/now/max` | `src/shell/resizable.tsx:21`, `:110-160` |
| collapse | the plane animates to `0` width, focus moves to the reopen button, `Ctrl/Cmd+B` toggles | `src/shell/ConsoleShell.tsx`, `src/shell/layout.ts:20-93` |
| narrow screen | below `768px` the sidebar is an overlay that starts closed, is never persisted, and closes with the same key | `src/shell/layout.ts:74-93` |
| shortcuts | suppressed while a text field, dialog, menu or listbox has focus | `src/shell/layout.ts:27-31` |

### 5.2 The reading lane

One variable drives the thread, the composer and the presence line, so they always align
(`src/styles.css:750-771`): `--chat-lane`, set from `src/lib/chat-width.ts`. Thread content carries its
own `3rem` side padding, so its box is the lane plus `6rem` and its text column equals the lane. Below
`640px` the lane is the full column and the setting has no effect. Presets: Comfortable `46rem`
(default), Wide `72rem`, Full, and a custom value from `36rem` up to the Full width
(`src/lib/chat-width.ts:12-18`).

### 5.3 Row densities

| surface | height | source |
|---|---|---|
| sidebar session and window rows | `28px` | console `sidebar` density, console-ui-system.md §4.2 |
| sidebar pane row | two lines, `48px` (`3rem`: two line heights plus `py-1.5`) | `src/components/sidebar/geometry.ts:33-40` |
| presence agent rows | `32px`, `44px` on a narrow screen | console-ui-system.md §4.2.1; `src/components/presence/PresenceLine.tsx:283` |
| thread tool-call, grouped tool-call and turn-fold lines | `24px` (`min-h-6`) | console-ui-system.md §4.2.1; `src/components/ActivityDisclosure.tsx:74`, `:161`, `:235` |
| operator message meta line | one `text-xs` line (`16px` line height), never wraps | `src/components/ChannelView.tsx:167-190` |

The 24px lines are a documented, height-only exception: they are a log read in sequence, so they need no
28–32px pointer target, their type stays on the ladder, and their text stays `ink-muted`, never
`ink-faint` (console-ui-system.md §4.2.1; reasoning in `docs/design/t3code-chat-audit.md` §3.3 and §10).

### 5.4 Narrow screens

At `390px`: the sidebar is an overlay, the chat lane is the full column, the composer's mouse hint is
hidden (`sm:block`) while the target, model and effort stay on the under-row, presence rows grow to
`44px`, the operator bubble is capped at `80%` of the lane, and every table in rendered markdown scrolls
inside its own box. The sidebar gate and the rows gate run at `1440` and `390` in both themes
(`scripts/sidebar-gate.mjs`, `scripts/rows-check.mjs`).

## 6. Components

Shared primitives (`src/components/ui/*`) are the shadcn AI Elements chat patterns on the console tokens:
`Message`, `MessageContent`, `Bubble`, `BubbleContent`, `Markdown` and the scroller.

### 6.1 Sidebar tree and its rows

Purpose: the tree of sessions, windows and panes, and the scope picker.

States: expanded or collapsed plane; overlay on a narrow screen; selected scope; focused row; hovered
row; and a per-agent status dot with the seven states of §4.6, `idle` and `waiting` drawing nothing.

Rows: a session or window row is one 28px line — name, chevron, agent count; a window with one pane has
no row of its own. A pane row is two lines: the agent name on line 1; the role, the runtime word and the
folder-plus-repo on line 2, with the status dot at the right
(`src/components/sidebar/SessionTree.tsx:88`). Line 2 is `text-xs` in `ink-muted` and carries no state
word (XTRM-1048, XTRM-1057). Every role is bold; Lead and Manager also take the thread view's pill
colours and every other role stays in the normal line ink (operator ruling, XTRM-1028;
`src/components/sidebar/SessionTree.tsx:31`). The repository is shown, not the cwd (XTRM-1024 seq13), with
a folder glyph before it (XTRM-1024 seq14).

The tree is keyboard operable with roving focus: one `treeitem` per row, Arrow keys move, and the row's
accessible name ends with the dot's state word.

### 6.2 Shell frame, switcher and header controls

Purpose: the console frame around the viewer, and the controls that change how the thread is read.

`ConsoleShell` owns the 44px header, the drag-resizable sidebar plane, the collapse-to-zero state and the
reopen button (`src/shell/ConsoleShell.tsx:50-65`, `src/shell/layout.ts:12-93`, `README.md:34-38`).
`HalfSwitch` is the Work / Threads switcher; its selected colours follow the top-right view control per
palette (XTRM-1024 seq13, seq14).

`ViewerHeader` holds the view tablist (Channel, All events; `:30`), the chat-width control (`:73-142`) and
the Colours control. States: current view, current palette, width preset or custom, a closed sidebar
(which swaps the collapse control for the reopen button), and a suppressed shortcut while a text field
has focus. The collapse tooltip opens on hover and keyboard focus only, never on shell focus, and never
covers the Sessions heading (XTRM-1044).

### 6.3 The resize split

Purpose: one draggable pane boundary, with the console's geometry.

`ResizableGroup` provides the width and the drag state; `ResizablePanel` writes the size during render;
`FillPanel` takes the rest; `ResizeHandle` is the `8px` separator (`src/shell/resizable.tsx`). States: at
rest; hovered (the handle shows its `accent` line on focus); dragging (no width transition); focused
(keyboard operands); collapsed (the handle is hidden and focus moves to the reopen button).

This component replaced `motion-panels` in XTRM-1067: the library cost a `151 kB` chunk, `51 kB` gzip, for
a width, a clamp, a drag, two arrow keys and a collapse. The console's values are unchanged
(`264` / `220`–`360` / `250ms` / `cubic-bezier(0.32, 0.72, 0, 1)`) and the sidebar gate checks the drag,
both clamp edges, persistence, the keyboard path, the collapse and the reopen.

### 6.4 Thread rows: the operator message

Purpose: show what the operator sent, as one scan-friendly block.

States:

| state | what shows | source |
|---|---|---|
| at rest | bubble, and one meta line: time `·` `to <agent>` `·` delivery mark, all visible | `src/components/ChannelView.tsx:167-190` |
| hovered | the Copy action reveals at the row's right; the meta line does not move | `.xtrm-meta`, `src/styles.css:674-689` |
| sending | spinner in place of the mark, `animate-spin` with `motion-reduce:animate-none` | `src/components/ChannelView.tsx:56-70` |
| seen | double check in `ink-muted` | same |
| replied | double check in `accent-ink` | same |
| not sent | danger mark plus the reason as text, and a `dismiss` action | `src/components/ChannelView.tsx:48-54`, `:183-190` |
| folded | clamped at `11rem` with the eased mask; the fold control sits inside the bubble | `src/styles.css:709-713`, `src/components/ChannelView.tsx:160-165` |
| joined | consecutive messages share an edge: the later one loses its outer corner on the joined side | `src/components/ChannelView.tsx:146-152` |

The meta line is visible at rest on every operator message, because a mark alone looked like a floating
icon (operator ruling 2026-11-26, XTRM-1047; `31777231`). Only Copy reveals. The bubble is `bg-control`,
`text-read`, radius 10px, `14px/1.625`, `12px` padding, capped at `80%` of the lane.

### 6.5 Delivery marks

What the operator can know about a prompt sent through `tmux send-keys` (`src/lib/delivery.ts:4-19`). Only
the newest operator message per agent carries a state; older ones are history (`latestUserIds`, `:52`).

| mark | icon | word | colour | when |
|---|---|---|---|---|
| Sending | `loader` (spinning) | Sending | `ink-muted` | the send request is in flight; an optimistic row |
| Sent | `check` | Sent | `ink-muted` | `send-keys` returned; the transcript has no echo yet |
| Seen | `checkCheck` | Seen | `ink-muted` | the prompt is in the agent's transcript |
| Replied | `checkCheck` | Replied | `accent-ink` | the same agent has since settled a turn |
| Not sent | `circleX` | Not sent | `danger` | the keys did not reach the pane; the reason is shown as text |

Each mark is `role="img"` with the word as its accessible name and a sentence as its tooltip: for
example "Sent: the keys reached the pane. The prompt has not appeared in the transcript yet."
(`src/components/ChannelView.tsx:32-38`). A failure is the one case that also carries text, because the
reason is what the operator needs to read.

### 6.6 The agent turn and the tool fold

Purpose: one scannable line per event, and the machine's own work collapsed behind it.

States: running (the fold row reads `Working` with the `viewer-fade` animation); settled (the fold row
reads `Worked for 1m 12s`, or `N steps` when the turn has no usable duration, with a detail suffix);
failed (`<n> failed` in `danger` with a dot); expanded (the activity rows); collapsed. `ActivityRow` is
one tool call, `GroupRow` groups repeats as `label ×N`, and all three line kinds are `24px`
(`src/lib/fold.ts:14-70`, `src/components/ActivityDisclosure.tsx:74`, `:161`, `:235`).

A settled turn's detail opens inside the thread as `--x-inset` panels; the thread itself never navigates.

### 6.7 Intercom cards

Purpose: peer traffic shown as a card, not folded into tool noise (`README.md:177`).

States: collapsed to three rendered lines (`3 * 25.6px`) with the eased mask and `Show more`; expanded
with `Show less`; failed (danger mark, the reason as text); reply requested (an accent dot and `reply
requested`); and the ordinary accepted state.

Layout: a 24px monogram, then `from → to`, a delivery mark and the time on the same line, then the body,
then the optional footer (`src/components/IntercomCard.tsx:84-140`). The card shows `Sent` or `Received`
as the mark's label.

The message id and the runtime are transport detail, not reading content, so the footer no longer carries
them (operator ruling 2026-11-26; `src/components/IntercomCard.tsx:82`). The peer is a resolved session
name, never a socket path (`server/peers.ts`).

When both sides of one message are present, one card is shown: the send keeps its timestamp and position,
the receiver supplies the message id (`src/lib/thread.ts`, `README.md:177`).

### 6.8 Presence line and panel

Purpose: what is running right now, above the composer, without a spinner in the thread
(`docs/design/working-presence.md`).

The collapsed line states `Working · N` with the agent monograms and their status dots
(`src/components/presence/PresenceLine.tsx:254`), and expands into a listbox of agent rows (`:251`); the
panel is the expanded form. States: empty (the line hides), one agent, several agents, attention (the dot
flashes), quiet (static muted), narrow screen (44px rows). The line's text is derived by
`presenceLine` and announced politely through `presenceAnnouncement` with `aria-live="polite"`
(`src/components/presence/PresenceLine.tsx:407`). Monogram pills wear a 2px `ring-canvas`, so they read as
cut-outs against any palette's canvas (`docs/design/palette-console.md`).

### 6.9 Composer, target row and menus

Purpose: send one operator message to one agent, and answer a specific agent without retyping.

Geometry: a 56px one-line box that grows to `max-h-52` (`208px`), no border and no ring in any palette or
state, a fill one step above the canvas, a slight drop shadow, `16px/24px` prompt, a 32px bare send glyph
at the box's bottom right, and an empty attach slot on the left for a control that does not exist yet
(`src/components/Composer.tsx:225-319`). The box carries `--x-composer-fill`, `--x-composer-focus`,
`--x-composer-shadow` and `--x-composer-shadow-focus` (`.xtrm-composer-box`, `src/styles.css:749-765`), so
a palette decides the step, the elevation and the focus signal without touching the component.

The two controls are bare glyphs (XTRM-1149). Send is a `16px` `CornerDownLeftIcon` — a return arrow, the
gesture the button sends — in `text-github`, whose hover steps to `text-github-hover`; Stop is a `14px`
outline `SquareIcon` in `text-ink`, whose hover shifts opacity. Neither draws a background box, both keep a `32px` hit area, their `aria-label` and `title`, and
a `focus-visible` accent ring; a disabled control fades to `opacity-30`, and the working spinner replaces
the glyph unchanged.

The box centres the painted band, not the line box. Inside a 24px line box a font's descender ink is
shallower than its cap height, so an evenly padded line draws its ascenders and descenders slightly low
in the box; the operator sees that as text sitting under the middle. The textarea therefore carries
`3.25px` above the line and `4.75px` below, and the measurement that binds is the rendered band: at a 2x
device ratio the placeholder and a typed line both paint across `20.5–35px` of the 56px box, the send
glyph across the same band, and every gap is within 0.25px of centre (`npm run test:composer` asserts
this on pixels, not on rects).

The target row sits under the box, right-aligned, 12px apart: the target (status dot, name, chevron),
its model, and its bare effort — for example `lead  claude-opus-4-8  high` (`:264-341`). The values come
from the agent's `model` and `thinkingLevel` through `composerMeta` (`src/lib/composer-meta.ts`); a missing
value is omitted, never invented. The row is 14px against the 16px prompt, muted, with no chips and no
borders.

Beside the model name the composer draws the agent's context usage (XTRM-1087): a 14px ring whose arc is
the fraction of the model's window the transcript fills, with the track at 22% of the tone colour. The
tone steps from `ink-muted` under 75% to `ink` from 75% and `danger` from 90%, and the accessible name and
tooltip carry the number, for example `46% of 200k tokens` (`src/components/ContextRing.tsx`). The
fraction is the newest assistant message's input plus its cached prefix, read from either runtime's
transcript, and the window comes from a model table in `src/lib/context-usage.ts`; a model the table does
not know, or an agent with no usage, draws no ring rather than a guess.

The agent menu opens upward from the target it belongs to, anchored to the right edge of the target group
so it meets the send button's right edge, sizing to its rows between `14rem` and `20rem` and never wider
than the screen (`:270-300`). The status word sits on each row's right.

The two controls keep their names: `aria-label` for the screen reader and a `title` naming the key, `Send
(Enter)` and `Stop (Esc)` (`:290-320`).

Other states: empty with a placeholder and the mouse hint (`@ to mention`, `text-2xs`, hidden below
`sm`, starting on the box's own 12px text inset so it lines up with the prompt above and the effort text
opposite, XTRM-1153); draft; addressed; sending (the send glyph becomes a spinner); error
(`text-2xs` in `danger` under the box); gone (the target pane left — the composer disables and the reply
bar drops, `src/lib/reply.ts:14-27`).

The composer addresses the pane itself, else the most recently active agent of the scope; `@` opens the
agent list; Escape clears the reply bar before it clears the draft (`src/lib/reply.ts:41`). Newlines
flatten to spaces for this version (`README.md:121`). The optimistic user row disappears when the matching
user event appears in the transcript.

### 6.10 Scroll pill, new-since divider and the follow policy

Purpose: keep a reader's place, and show what arrived while they were away.

The pill appears only when the reader is not at the end; it reads `Scroll to end`, adds `· N new`, and
never steals the composer's focus (`src/components/ui/message-scroller.tsx:640-660`). The follow policy is
one function (`src/lib/stick.ts:8`): smooth only while at the end and content is arriving, never for a
reader who scrolled up, and the reader's own input ends it. A send is the one exception: it pins the
viewport to the end even when the reader had scrolled up, and the intent survives the optimistic-to-echo
swap and the reply; a wheel, touch, pointer or key gesture clears it so a deliberate scroll-up wins
(XTRM-1064).

The new-since divider is a single line, `New · N`, placed at the first item after the scope's last-read
time. The baseline is frozen for the visit, so the divider does not walk away while the reader reads
(`src/components/ChannelView.tsx`, `src/lib/readstate.ts:69-103`). Operator rows never count as unseen
(`unseenTimelineItems`, `:92`).

### 6.11 All-events view

Purpose: the raw event log, for debugging rather than reading.

Loaded on demand as its own chunk (`src/App.tsx:51`, `:552`), with a light `Loading events…` line as the
Suspense fallback. It is the one view that renders the model as data: effect, time, agent, payload.

## 7. Interaction and accessibility

**Keyboard.** The sidebar is a `tree` with roving focus (`src/components/sidebar/SessionTree.tsx:202`);
the presence panel is a `listbox` with its own key handler; the view control is a `tablist` with two
`tab`s (`src/components/ViewerHeader.tsx:30-40`); the chat-width control is a `radiogroup` with `radio`
items and a custom field (`:104-142`); menus are buttons with `aria-expanded` that open upward. `Ctrl/Cmd+B`
toggles the sidebar; Escape clears the reply bar, then the draft, then closes an open menu.

**Focus.** One global `:focus-visible` rule draws a 2px accent ring with a 1px offset
(`src/styles.css:333-336`). No component removes an outline without replacing it: the resize handle
replaces it with an accent line on its own edge (`src/shell/resizable.tsx:160`), the composer with its
inset ring. Collapsing the sidebar moves focus to the reopen button, so focus is never lost.

**Labels.** Every dot is `role="img"` with a state word, and carries a `title` (`src/components/sidebar/SidebarDot.tsx`,
`src/components/presence/PresenceLine.tsx`). The sidebar row's accessible name ends with that word, so a
screen reader hears `lead, Claude, pi-viewer, Quiet 16m` even though the row shows no word. Delivery marks
carry their word and a sentence. Status is never conveyed by colour alone: the dot differs in shape,
animation and label.

**Live regions.** The presence line announces changes politely (`aria-live="polite"`) and never
interrupts typing. Nothing else in the viewer is a live region: the thread changes under the reader
without announcement, which is correct for a transcript and wrong for an alert.

**Contrast.** Text meets 4.5:1 and every non-text mark meets 3:1 against the plane it sits on. Two gates
hold this: `npm run test:contrast` measures the status dots in five palettes and both themes, and
`npm run test:palette` measures the palette's text roles per palette and theme. Both fail the run rather
than warning.

**Reduced motion.** Every animation has a branch (§4.5). Under `prefers-reduced-motion: reduce` the dots
stay at full opacity, the shimmer and fades stop, the metadata transition is removed, and colour alone
still distinguishes every state.

**Pointer.** A coarse pointer reveals row metadata at rest (`@media (pointer: coarse)`,
`src/styles.css:685-689`), because hover does not exist there. The resize handle is `8px` wide with a
`16px` keyboard step; the composer's send button is `32px`; no transcript row is a pointer target.

**Motion and layout stability.** No row changes height on entering the viewport — `content-visibility` is
deliberately not used (`src/styles.css:579-581`). The scroller owns anchoring: rows are indexed once per
mutation, offsets are cached, and a reader's position is restored by index rather than by pixel.

## 8. Performance

### 8.1 What ships to the browser (XTRM-1067)

One chunk of `766.22 kB` (`240.10 kB` gzip) became four, and the heaviest view, the fonts and the resize
library each lost their weight. Numbers from the XTRM-1067 journal, measured with `npm run build` on
private ports.

| asset | before | after | gzip after |
|---|---|---|---|
| react + react-dom + scheduler | in the single chunk | `210.54 kB` | `65.70 kB` |
| the markdown stack | in the single chunk | `172.39 kB` | `52.00 kB` |
| app | `766.22 kB` | `228.36 kB` | `72.00 kB` |
| runtime | — | `0.72 kB` | `0.42 kB` |
| All-events view | in the single chunk | `9.04 kB`, loaded on demand | `2.58 kB` |
| CSS | `78.00 kB` | `75.87 kB` | `13.64 kB` |
| fonts | 8 subsets, `101.4 kB` | 2 latin faces, `43.27 kB` | — |

The split is a table of matchers in `vite.config.ts` (`build.rollupOptions.output.manualChunks`): react,
the markdown stack, and motion. The fonts are two `@font-face` rules against the pinned fontsource
packages (`src/styles.css:9-23`): Figtree Variable 300–900 and Geist Mono Variable 100–900, latin only.
The viewer reads English tmux and agent text, so the four latin-ext and cyrillic faces were 58 kB of build
weight for nothing.

### 8.2 Cold load, measured

`npm run measure:load` (`scripts/load-check.mjs`) records requests, bytes and the time to the first
message bubble.

| serve | requests | bytes | first message bubble |
|---|---|---|---|
| dev (`npm run dev`) | 75 | 15,541,167 | 2,075 ms |
| preview (`npm run build && npm run preview`) | 10 | 669,909 | 2,060 ms |

The preview row's remaining bytes are dominated by the thread JSON: two `/api/thread` calls, `422 kB` in
that run (`README.md:44`). That is server territory, not bundle weight. `npm run preview` is the whole
production serve, because the `/api` middleware comes from the Vite plugin (`README.md:24-25`).

### 8.3 The request path (XTRM-1066)

Measured on one session of 13 agents, gzip bytes per response:

| scope | before (scope ignored) | after |
|---|---|---|
| session | `376,410 B` | `377,505 B` |
| window of 6 panes | `376,410 B` | `316,955 B` |
| window of 2 panes | `376,410 B` | `80,991 B` (−78%) |
| pane, 75 events | `376,410 B` | `22,023 B` (−94%) |
| pane, 4,048 events | `376,410 B` | `246,637 B` (−34%) |

Warm response time fell from `0.11–0.32 s` for every scope to `2.1–4.3 ms` on a cached frame. The event
loop no longer blocks on discovery: `discover()` blocked `78–127 ms` per pass, `discoverAsync()` blocks
`14–20 ms`. Cold first request on a fresh server: session `1.36 s` → `1.19 s`; a 2-pane window
`0.141 s` → `0.017 s`.

Mechanism: the scope is applied server-side; one `ScopeView` per (scope, agent set, cache counter) holds
the filtered list and the memoized cut windows; discovery runs on a `2 s` async timer with an idle stop
after `60 s`; encoded frames are cached by (query, scope, agent-hash, cursor, revision) with async gzip,
16 frames or 24 MB; one stat pass per discovery (`server/stat-pass.ts`).

### 8.4 Render cost (XTRM-1065)

The thread no longer remounts on a scope change: the provider is not keyed by scope, and a thread-key
effect restores the new thread's position. Rows are memoized, the timeline is built once per payload, and
the presence line derives from the same timeline instead of building a second one. Measured on a
re-baselined worktree: idle `TurnView` renders under live writes fell 75% (`1128` → `282` in a 4.5 s
window), and 93% in a quiet window; a heavy scope switch stayed fetch-bound at `50–100 ms` with 106 row
renders, i.e. no regression. The first measurement in that issue was discarded because its baseline had
no rendered turns, and the corrected numbers replaced it (XTRM-1065 journal, seq 3).

The operator bubble's fold is decided from a text estimate rather than a `getComputedStyle` +
`scrollHeight` pair per mount, which removed one forced layout per operator message
(`src/components/ChannelView.tsx:145-148`).

### 8.5 Gates

| gate | checks |
|---|---|
| `npm run measure:load` | cold-load requests, bytes, first paint |
| `node scripts/perf-check.mjs` | idle turn renders, scope-switch time and renders, console errors |
| `npm run test:scope` | the thread request carries pane and window scope; frames differ per scope |
| `npm run build` | no chunk above `500 kB`; a warning fails review |

## 9. Turn state model

Summary of `docs/design/working-presence.md` §8 (authority: XTRM-1043). Three review rounds failed
heuristic classification (XTRM-1037, 1040, 1041), so one explicit state machine replaced them (code:
`src/lib/turn-state.ts`).

- **One effect per record.** The server classifies every transcript record as `open`, `step`, `reply`,
  `abort`, `fail`, `compact` or `none`, and carries it on the event (`entryEffect`,
  `server/session.ts:625`; `ViewerEvent.effect`). The table of which records produce which effect, and the
  three cases the record alone does not settle (Claude slash commands, Pi `custom_message` wake-up types,
  Claude `stop_sequence`), is `docs/design/working-presence.md:326-356`.
- **States.** `phase` is `none`, `open`, `settled`, `aborted` or `failed`; an open turn also records
  `loop`, and a failed one whether the error was a context overflow (`src/lib/turn-state.ts:42-54`).
  Transitions are `nextTurnState` (`:66`); `none` never changes the state.
- **Status.** The status and its note derive from the phase and the silence: `attention` on an open
  question or plan approval, else `quiet` after 15 minutes without a turn-moving write, else `working`;
  `waiting` when settled, `error` when failed, `idle` otherwise; permission prompts from the pane capture
  are applied last (`server/attention.ts:231`).
- **Time.** No timer enters the machine. The clock is `ViewerAgent.lastWriteAt`, the write time of the
  newest turn-moving record, a running maximum, clamped to the file time (`server/session.ts:691`).
- **Grouping.** The browser folds the same effects with the same machine (`groupAgent`,
  `src/lib/thread.ts`; `splitPresence`, `src/lib/presence.ts`), so the presence line and the thread cannot
  disagree about a turn. Meta events that carry an effect reach the browser; rendering still skips meta.
- **Proof.** The replay harness writes a transcript one record at a time and checks, after each record,
  that a fresh parse equals the incremental one, that no stopped row disappears, and that an open turn
  exists exactly while the status is live (`test/replay/harness.ts`). The server reads only trailing
  records (`resolveTurnState`, `src/lib/turn-state.ts:99-118`), which equals a fold from the start.
- **Known limits.** The model does not guess a retry before it is written, and an overflow reads as
  `error` until its compaction arrives (`docs/design/working-presence.md:481-497`).

## 10. Decisions log

Operator rulings that shape the app, with the durable record. "seq" is a journal entry of that issue.

| date | ruling | record |
|---|---|---|
| 2026-11-18 | Restraint: no new colour, no new tint; the console's six principles govern every component | console-ui-system.md §2.3, §2.1 |
| 2026-11-23 | The XTRM-853 design page is superseded by console-ui-system.md | console-ui-system.md §16 |
| 2026-11-25 | Working presence: build option B, the agent list above the composer | XTRM-1024 seq3 |
| 2026-11-25 | A read-only `tmux capture-pane` may detect permission prompts; nothing may send keys for them | XTRM-1024 seq3 |
| 2026-11-25 | Interrupt and approve/deny are shown, never clicked | XTRM-1024 seq3 |
| 2026-11-25 | Restyle = the t3code audit's top ten plus delivery state, new-since divider, quiet hint, failure roll-up; the contrast fix is ink-faint → ink-muted for text | XTRM-1024 seq3 |
| 2026-11-25 | The user bubble and the composer radius is 10px, not t3code's 16px | XTRM-1024 seq2 |
| 2026-11-25 | 24px tool rows are a documented transcript exception | XTRM-1024 seq2 |
| 2026-11-25 | The viewer sits in the console shell, built from console primitives, with the console's values | XTRM-1044 |
| 2026-11-25 | Palettes stay as themes and switch at the top; the operator decides which stays | XTRM-1024 seq13 |
| 2026-11-25 | Presence pill border matches the background; message action rows never wrap | XTRM-1024 seq13 |
| 2026-11-25 | All roles remain; role text is bold for every role | XTRM-1024 seq13 |
| 2026-11-25 | Sidebar pane metadata shows the repository, not the cwd | XTRM-1024 seq13 |
| 2026-11-25 | Console palette restores the original switcher selected state; Threads gets stronger contrast; a folder glyph precedes the repo name | XTRM-1024 seq14 |
| 2026-11-25 | Push only, no PR | XTRM-1024 seq13 |
| 2026-11-25 | One explicit state model replaces incremental heuristics, proven by a real-transcript replay harness | XTRM-1024 seq12; XTRM-1043 |
| 2026-11-25 | Reply beside Copy aims the composer at that agent; no quoted text | XTRM-1045 |
| 2026-11-25 | Chat width: Comfortable 46rem, Wide 72rem, Full, custom from 36rem; one lane variable | XTRM-1042 |
| 2026-11-25 | The pane row's line 2 carries no state word; the dot carries the state, as in the thread | XTRM-1048 |
| 2026-11-26 | All five palettes stay — Threads, Threads soft text, Console, Console soft text, Desktop; the default remains Threads | XTRM-1024 seq17 |
| 2026-11-26 | Desktop palette (dimmer reading text) and soft-text versions of Threads and Console; muted text rises to #a1a1a1 for 4.5:1 | XTRM-1051, XTRM-1053 |
| 2026-11-26 | Composer: one-line 56px box, no border, target row with model and effort under it on the right | XTRM-1054, XTRM-1056, XTRM-1067 |
| 2026-11-26 | Composer: no border and no ring in any palette or state; a drop shadow, and a context-usage ring beside the model | XTRM-1087 |
| 2026-11-26 | The composer centres the painted ink band, not the line box: 0.75px more padding below than above | XTRM-1087 |
| 2026-11-26 | Stopping is allowed: Escape to the agent's own pane, from a Stop control while it works and from Esc in an empty box; approve and deny stay show-only | XTRM-1088 |
| 2026-11-26 | Folds sit inside the bubble or card with one wording; the fade masks the text itself | XTRM-1055 |
| 2026-11-26 | Reviewer roles run as specialists | XTRM-1024 seq14 |
| 2026-11-26 | Sidebar line 2 is text-xs in ink-muted, matching the line above | XTRM-1057 |
| 2026-11-26 | An idle or waiting agent draws no sidebar dot; the absence is the state | XTRM-1058 |
| 2026-11-26 | The operator's newest message carries a delivery mark, not a word; time, recipient and mark read as one line at rest | XTRM-1047 |
| 2026-11-26 | A long message folds inside its bubble or card, with the eased mask and the toggle inside it | XTRM-1055, XTRM-1047 |
| 2026-11-26 | The intercom card drops the message id and the runtime; they are transport detail | XTRM-1047 |
| 2026-11-26 | The agent menu opens upward from the target row, right-aligned to the send button | XTRM-1054 |
| 2026-11-26 | Bundle split and a lazy events view; latin fonts only; `motion-panels` replaced by an in-repo split | XTRM-1067 |
| 2026-11-26 | A send pins the thread to the end until the reader scrolls | XTRM-1064 |
| 2026-11-26 | Scope is applied server-side, discovery leaves the request path, frames are cached | XTRM-1066 |
| 2026-11-27 | Composer send and stop are bare glyphs: an outline square in ink and a return arrow in the github tone, no filled boxes, hover by tone or opacity; the hint reads only `@ to mention` | XTRM-1149 |
| 2026-11-27 | One scrollbar: every scroll container in both packages takes the chat's thin dim bar (`* { scrollbar-width: thin; scrollbar-color: var(--color-border-strong) transparent }` in the base layer), so no container falls back to the browser default; the composer's `@ to mention` moves onto the box's 12px text inset; the send button names its key (`Send (Enter)`) | XTRM-1153 |

## 11. Open questions

1. **Dead sidebar state code.** `stateOf` and `STATE_LABEL` in `src/lib/tree.ts` are unused by production
   code since the dot carries the state; `test/sidebar-tree.test.ts` still asserts the three-state
   mapping. Removal is a code change and belongs to a separate issue (follow-up from XTRM-1048).
2. **The README still describes older geometry.** `README.md` gives the sidebar indent step as `0.75rem`
   while `src/components/sidebar/geometry.ts:11` has `INDENT_REM = 0.5`, and its checks list predates
   `test:composer`, `test:scope` and `measure:load`. The README needs its revision; it is outside this
   issue's scope.
3. **The presence panel has no shortcut.** No global key opens it; the proposal is none in v1
   (`docs/design/working-presence.md`).
4. **Agents outside the scope.** The presence line counts only the scope; the proposal is to keep it that
   way and let the sidebar show the rest (`docs/design/working-presence.md`).
5. **Interrupt and approve.** Approval is designed but not built, because nothing may change agent
   state (XTRM-1024 seq3). The interrupt half was ruled on 2026-11-26: stopping by Escape is allowed,
   and the composer sends it while the target works (XTRM-1088).
6. **Inferred Desktop tokens.** Desktop inherits `border-muted`, `border-subtle`, `border-strong`,
   `ink-faint`, `hover`, `pressed` and `accent` from the dark base, and the operator supplied no light
   values at all, so Desktop in light is Threads light. Both are recorded as inferred in
   `docs/design/palette-console.md`; a supplied value would replace an inference.
7. **Discovery runs every 2 s, not 10 s.** The contract asked for at least 10 s; the snapshot is refreshed
   every 2 s because the thread poll reads agents' `modifiedAt` and `eventCount` from it, and a 10 s
   snapshot would delay new events by up to 10 s. The constant is `DISCOVERY_INTERVAL_MS` in
   `server/api.ts` (XTRM-1066 journal, deviation).
8. **The idle thread poll still repeats the agent list.** `ThreadPayload.agents` is sent on every poll
   (about 2.1 kB idle, more with 13 agents). A delta or a separate source would shrink it (XTRM-1066
   journal, follow-up).
9. **The composer's attach slot is empty.** `[data-composer-attach-slot]` reserves 32px for a control the
   viewer does not have; it is a placeholder for a future attachment affordance (XTRM-1056).
10. **A second resizable panel would need its own offsets.** The resize handle is positioned from the
    panel's width, which is correct for the shell's single split; a second split would need per-panel
    offsets (XTRM-1067).

## 12. Glossary

| term | meaning |
|---|---|
| agent | one `pi` or Claude Code process in a tmux pane, identified by pane id |
| channel | the thread view of one scope: operator messages, intercom cards and agent turns in order |
| chunk | one JavaScript file the build emits; a route or view can be a lazy chunk |
| delivery | what the operator can know about a sent prompt: queued, typed, seen, answered, failed |
| density | one of the console's three row spacings; the viewer's sidebar uses `sidebar` |
| effect | the server's classification of one transcript record: open, step, reply, abort, fail, compact, none |
| fold | the collapsed form of a long message, a card or a turn's activity, with a toggle inside the box |
| frame | an encoded thread response, cached server-side per query, scope, cursor and revision |
| lane | the aligned reading column that the thread, composer and presence line share |
| monogram | the two-letter agent badge in the presence line and on an intercom card |
| palette | a set of region assignments and plane values: Threads, Console, Desktop, each with a soft-text variant |
| presence | the live list of agent turns and their states, shown above the composer |
| region | a part of the page that wears a plane: canvas, sidebar, surface, raised, control, inset, code |
| revision | a server tag for the current shape of a scope's event space; a change means reload the window |
| scope | what the reader is looking at: a session, a window, or one pane, from the URL |
| settle | the moment a turn's final reply arrives; the timeline places the turn there |
| soft text | a text-only palette layer (Desktop's text colours) applied over a base palette |
| status dot | the one mark that carries an agent's state, with a label but no visible word in the sidebar |
| strip | the persistent control strip at the foot of the console sidebar |
| turn | one agent response cycle: opened by a record, moved by steps, settled, aborted or failed |
