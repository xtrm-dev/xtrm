# Start, close and move agent sessions from the threads app (XTRM-1078)

Status: phase-1 draft 1, for the thread lead and then the operator. No application code changes in this phase.
Contract: Substrate `XTRM-1078` rev 2; journal seq 2-5 (operator note, lead inventory, the native-tmux correction, the operator direction).
Mockups: [`mockups/session-lifecycle.html`](mockups/session-lifecycle.html) (desktop 1440, `?w=390` for phone, `?theme=light|dark`). Screenshots: [`shots/XTRM-1078/`](shots/XTRM-1078/) (`xtrm-1078-<frame>-<theme>.png`, frames F1-F9 at 1440 and M1-M3 at 390).
Reference studied: `pingdotgg/t3code` at `17a44b5e5fb9548571a0e3016ec51f5d74b884c8` (2026-11-28), shallow clone, source read only. `T3/` means `apps/web/src/`.

Every statement is marked when it matters: **verified** (read in source or observed in a command this session), **inferred** (derived, not observed), **proposal** (my design choice, open to the operator).

## 1. Summary

1. Starting a thread is a **draft thread** in the main pane, not a form or a modal. It uses the composer the operator already knows: the prompt box, with the pickers placed around it the same way as the existing target, model and effort under-row. The four entry points open the same draft. They differ only in the placement prefilled into the placement picker.
2. The composer shows **where** above the box (placement, repo, worktree) and **who** under it (runtime, role, model, issue). A one-line **command preview** shows the exact `xt` argv that Enter will run. That preview is how "every action is visible" is met before the action runs.
3. **Close** is a dialog on the pane row. It shows the worktree's git state and has three actions: Commit and push, Discard (behind its own confirmation, which lists the files), and Close, which is enabled only when the tree is clean and pushed. Close ends the agent's pane and runs `xt worktree release --pane`.
4. **Move** is a submenu on the pane and window rows. It uses native `tmux join-pane`, `break-pane` and `move-window`, all with `-S`. Moves are reversible, so they get an **Undo** toast and no confirmation, as t3code does for archive.
5. Phase 2 needs four viewer host endpoints (`/api/launch`, `/api/worktree-status`, `/api/worktree-action`, `/api/move`) and one audit log. It needs **two small core-cli changes** that the contract allows only when an existing flag cannot express the need. §4 states each gap with evidence.

## 2. What t3code does, and what we take

Findings from the read of t3code. Each one names the file it came from.

| t3code behaviour | Source | We take it as |
|---|---|---|
| Menus are data (`ContextMenuItem {label, detail, destructive, disabled, separatorBefore, children}`), and one builder feeds the native menu, the DOM fallback and the tests. A separator is inserted before the first destructive item automatically. | `packages/contracts/src/ipc.ts:25`, `apps/desktop/src/electron/ElectronMenu.ts:160-215`, `T3/contextMenuFallback.ts` | One pure `menus.ts` builder per row kind, unit-tested, rendered by one Base UI menu. The destructive group is always last and always separated. |
| Shift+F10 and the ContextMenu key open the row menu at the row's bottom-left. | `T3/contextMenuSource.ts` | The same keys on our `role="tree"` rows. The tree already has roving focus. |
| Operate actions are disabled with a reason, not hidden. | `T3/components/threadActionMenu.logic.ts:318-330`, `GitActionsControl.logic.ts:213-242` | A disabled item states its reason as a `detail` ("agent is working", "tree is dirty"). |
| New thread opens a **draft** at once. An empty draft per project is reused. It is promoted to a thread on first send, and a failed send restores the draft. | `T3/hooks/useHandleNewThread.ts:233-300`, `composerDraftStore.ts:4849`, `useComposerSend.ts:306-311` | One draft per placement key. Enter launches it. On failure the draft keeps every field and the prompt text. |
| The draft hero heading carries a searchable project combobox: "What should we build in {project}?" | `T3/components/chat/DraftHeroHeadline.tsx:142-372` | The heading names the placement in plain words: "New thread in **xx › workers**". The repo is a picker, not part of the heading, because one tmux window holds several repos. |
| Workspace: "Current checkout", "New worktree", "Previous worktree" (with its branch). It is locked after the first send. | `T3/components/BranchToolbarEnvModeSelector.tsx` | A worktree picker: **New worktree** (default, from `origin/<default>`), **New worktree from…** (`--base`), **Existing worktree** (`xt attach <slug> --fresh`). |
| Shortcuts: `mod+n` / `mod+shift+o` new thread, `mod+k` palette, `mod+shift+m` model picker, and one per composer picker, each shown in its tooltip. | `packages/shared/src/keybindings.ts:116-128` | `mod+shift+o` for new thread (`mod+n` belongs to the browser). Pickers get `mod+shift+<letter>` shown in their tooltips. There is no command palette in phase 2 (§3.6). |
| Model picker: searchable combobox, check on the selected row, jump keys, `max-h` frozen while searching so it does not jump. | `T3/components/chat/ModelPickerContent.tsx:955-1060`, `ModelListRow.tsx` | Our pickers are searchable lists with a check, grouped, with height frozen while filtering. One column, no provider rail: runtime is its own picker. |
| Chips are emphasized only when they differ from the default. | `T3/components/chat/ComposerControlsBar.tsx:135-180` | A picker reads muted at its default value and turns `--x-ink` when changed, so the operator sees at a glance what they set. |
| Worktree setup shows an inline card in the timeline with stages ("Setting up worktree…", "Worktree ready", "Worktree setup failed") and ghost actions. | `T3/components/chat/WorktreeSetupCard.tsx:113-125,340-405` | A **launch card** in the draft timeline: Starting… with elapsed time, then the outcome. On failure it shows `reason_code` and summary, Retry and Copy command. |
| Archive: no confirmation, a 5 s undo (`mod+z`). Delete: confirm. "Last thread on this worktree, delete the worktree too?" is asked once. | `T3/hooks/useThreadActions.ts:418-470,585-610` | Move: no confirmation, Undo toast. Close and Discard: confirmation. Close always asks once, because a pane owns at most one worktree here. |
| Git split button whose quick action follows repo state (Commit, Commit & push, Push). The commit dialog accepts a blank message and generates one. | `T3/components/GitActionsControl.tsx:286,1640-1720` | "Commit and push" with a message field, prefilled from the issue ref and title. We do not generate a message with a model in phase 2. |

What we do **not** take: glass and backdrop blur (no new visual language; our popovers are `bg-raised shadow-float`), the provider icon rail, multi-model send, favourites, and native Electron menus (the viewer is a web page).

## 3. Scope critique: what the contract misses, gets wrong or over-builds

Each point ends with a **proposal**.

### 3.1 The window header does not exist for most windows (verified)

The sidebar omits a window row when the window holds one agent pane (`README.md` "Sidebar"; `src/lib/tree.ts:190`). Entry point (a), "right-click a window header", is therefore unreachable for every single-pane window. Windows and sessions that hold **no** agent are omitted as well.
**Proposal:** the pane row menu also carries "New thread beside" (a pane in the same window). The placement picker lists targets from tmux itself (`list-windows -a`), not from the agent tree, so the operator can also target windows that are not shown.

### 3.2 The host launch endpoint cannot carry this launch (verified)

The XTRM-557.9 / XTRM-601 launch path takes `command: "pi" | "xt pi"` only, with options `name, role, bead, model, thinking, prompt` (`packages/xtrm-app/src/adapters/agent/protocol.ts:221-229`, `server/agent-host-ssh.ts` `launchRequestError`). It has no claude, no codex and no placement option. It is also the console's bridge to the agent host, not a viewer route: the viewer server today has only `/api/sessions`, `/api/thread`, `/api/event`, `/api/send` and `/api/stop` (`server/api.ts:509-660`).
**Proposal:** phase 2 adds a viewer route `POST /api/launch` that runs `xt <runtime> [name] --no-attach --json <placement flags>` through `execFile` (argv, no shell). It ports the endpoint's validation rules unchanged: absolute cwd, known options only, no value starting with `-`, no control characters, no Anthropic model on pi. It uses the same `xtrm.command-outcome.v1` result. The agent-host launch request can adopt the same option set when the multi-host design lands (a non-goal now). **Lead decision needed:** a viewer-local route, or extending the core agent host first.

### 3.3 `xt codex` cannot be placed (verified)

`xt codex --help` offers `--window` but no `--pane`, `--session`, `--layout`, `--workers` or `--new-session`; `xt pi` and `xt claude` have all of them. Codex can therefore start only as a new session or as a window in the caller's session.
**Proposal:** this is the case the contract allows for core cli: give `xt codex` the same placement flags as `xt pi` (core issue, owner 9hym). Until it lands, the runtime picker disables Codex for a pane placement, with the reason "Codex cannot split a window yet".

### 3.4 `xt` cannot target a tmux socket (verified)

No `xt` runtime has `-S` or `-L`. `xt` chooses its server from `$TMUX` or the default socket, and inside `$TMUX` without a placement flag it runs **in the current pane** (`xt claude --help`, `--new-session`). The constraint "host tmux calls target the host's own server explicitly (-S)" can be met for the viewer's own tmux calls, but not for `xt` itself. Today the viewer's tmux calls carry no `-S` either (`server/api.ts:619-620,649`, `server/discover.ts:91`).
**Proposal:** (1) The viewer resolves its socket once at start: `PI_VIEWER_TMUX_SOCKET`, else the default `$TMUX_TMPDIR/tmux-$UID/default`, never an inherited `$TMUX`. It passes `-S` on every call it makes. (2) `xt` gets a documented `XTMUX_SOCKET` env var, or a `--socket` flag (core issue), that its launcher honours. The viewer sets it and **always** passes an explicit placement flag, so `xt` never falls back to "run in the current pane". (3) Tests use a private socket only. **Lead decision needed:** env var or flag.

### 3.5 Close and the release command (partly verified, partly open)

- **Dry-run side effect (verified).** `xt worktree release --pane %16 --dry-run`, run in this session, returned `action: nudged` and **typed the nudge into the agent's pane**. The UI must not use release to read state. **Proposal:** the viewer reads git state itself with `git -C <@agent_worktree> status --porcelain=v2 --branch` plus `git log @{u}..` (read-only).
- **Own agent exempt (inferred).** The blockers were two pids, the shell running my own probe. The pane's agent process (`claude`, cwd inside the tree) was not listed. Release therefore appears to exempt the pane's own agent, so a host process outside the tree can release an idle, clean, pushed tree. Phase 2 verifies this on a private socket.
- **Confirmation path (open).** Release asks its confirmation on a tmux client (`--client`). From the host there is no client. **Question for 9hym:** does release without `--client` proceed, refuse, or wait? The UI already confirms; the host needs a non-interactive path. If one is missing, that is the second justified core change.
- **Discard.** Per journal seq 4: Discard runs `git restore --staged --worktree -- <files>` and `git clean -f -- <untracked files>` on exactly the listed files. Release gets no force flag. Commits that are not pushed are not "discarded" by this. The dialog offers Push for them, and the branch is kept by release anyway.

### 3.6 Over-built or premature

- **A command palette.** The viewer has none, and the console's `cmdk` palette is a separate surface. **Proposal:** phase 2 ships the shortcut `mod+shift+o` and the menus. A palette waits for the shared shell work (XTRM-1098).
- **"Commit and push" while the agent works.** Committing under a working agent races its edits. **Proposal:** Commit and push and Discard are disabled while the pane's status is `working`, with that reason. The operator asks the agent to stop first. Stopping is the existing Esc control, and the close flow does not add an interrupt (non-goal).
- **Role list as a flat dropdown.** `specialists list --json` returns 36 roles (verified), including `manager`, `board-helper` and `transcriber`. **Proposal:** a searchable list grouped by `category`, the description as line 2, and the role's default model shown as the model picker's placeholder, because `--model` overrides `specialist.execution.model`.

### 3.7 Missing from the contract

- **Thread name.** `xt <runtime> [name]` names the branch `xt/<name>` (verified, `xt claude --help`). The draft needs an optional name field. Empty means the random name xt picks.
- **First prompt.** The prompt box text is `--prompt`. With `--role` and `--issue`, xt renders the issue as the prompt and refuses `--prompt` (verified, `--issue` help text). The box then says "The issue is the prompt" and locks.
- **Base ref.** `--base origin/stable` for hotfixes (verified flag). It belongs in the worktree picker.
- **Window name.** `--window-name` for a new window (verified flag). It belongs in the placement picker's "New window" row.
- **Audit.** The viewer has no audit today (verified: no audit sink in `server/`). See §7.
- **Identity after a move.** All `@agent_*` options are pane-scoped and travel with the pane (journal seq 4). `@agent_parent_session` keeps the **launch** session, and the launch ledger keeps the launch `sessionName`. After a cross-session move, `xt attach` restores into the old session (journal seq 4, a known limit). The UI shows nothing wrong. The phase-2 gate asserts the options are unchanged, not that they are "updated".
- **Identity doc.** `docs/agent-identity.md` lives in the core repo, outside this worktree (`packages/substrate/src/domain/pane-issue-sync.ts:18`). The field list here comes from journal seq 4 and `xt topology --json` (`agent.role, task, bead_id, worktree, branch, parent_session_id, parent_pane_id, instance_id`). The phase-2 gate needs the doc's exact list.

## 4. Core-cli changes the design needs

| # | Change | Why no existing flag works | Evidence |
|---|---|---|---|
| C1 | `xt codex`: `--pane`, `--session`, `--layout`, `--workers`, `--new-session` with `xt pi` semantics | Codex has `--window` only, so "pane in window" and "window in session X" cannot be expressed | `xt codex --help` |
| C2 | `xt` launcher: `XTMUX_SOCKET` env (or `--socket <path>`) | No socket option; the server comes from `$TMUX`, which the host must not inherit | `xt pi/claude/codex --help` |
| C3 (conditional) | `xt worktree release --pane <id> --yes` (non-interactive, logged) | Only if release without `--client` cannot proceed (§3.5, open question) | `xt worktree release --help` |

No new verb for move or close (non-goal, journal seq 4).

## 5. Interaction model

### 5.1 Entry points

| # | Where | Gesture | Menu item | Prefilled placement |
|---|---|---|---|---|
| a | Window row (multi-pane window) | right-click, Shift+F10, ContextMenu key | New thread in this window | Pane in `session:window` (`--pane <session>:<window> --layout tiled`) |
| a' | Pane row (any) | same | New thread beside | Pane in that pane's window |
| b | Session row | same | New thread in new window | New window in that session (`--window --session <s>`) |
| c | Fixed "Sessions" header | same, plus a `+` icon button that appears on hover/focus | New session | New session (`--new-session`) |
| d | Top bar, far right | `+ New thread` button; `mod+shift+o` anywhere | — | Default (§5.3) |

Mobile has no right-click. A long press (500 ms) on a row opens the same menu as a bottom sheet. The top-bar button stays, as an icon only.

### 5.2 Menus (one builder, Base UI menu, console anatomy)

Anatomy is the console's `OptionsMenu` (`packages/xtrm-app/src/ui/menu.tsx`): `min-w-48 rounded-lg bg-raised p-1 shadow-float`, items `h-8 rounded-md px-2 text-sm text-ink-muted`, highlighted `bg-hover text-ink`, 16px muted icon. Added: a right-aligned `detail` in `text-xs text-ink-faint` (shortcut or reason), the submenu chevron, and a danger item (`text-danger`, `hover:bg-danger/10`) that always sits last after a separator. The viewer has `radix-ui`, not Base UI (verified, `package.json`). Phase 2 adds `@base-ui/react` to share the console's primitive, or ports the classes onto Radix's ContextMenu. **Proposal:** Base UI, one primitive family with the console.

- **Sessions header:** New session · `⇧⌘O` hint not shown (that shortcut opens default placement) · ── · Collapse all, Expand all.
- **Session row:** New thread in new window · ── · Move window here ▸ (lists windows of other sessions) · ── · Copy session name.
- **Window row:** New thread in this window · Move window to ▸ (sessions, "New session") · ── · Copy target (`xx:2`).
- **Pane row:** New thread beside · Move to ▸ (windows grouped by session; "New window in xx"; "New session") · ── · Copy ▸ (pane id, worktree path, branch) · ── · **Close thread…** (danger).

Disabled items stay visible with their reason, for example "Close thread… · agent is working".

### 5.3 The new-thread draft (one component)

The main pane switches to a **draft** scope. The sidebar shows a draft row at the target placement with a dashed status dot. The draft has three parts, from top to bottom:

1. **Hero:** "New thread" (`text-base font-semibold`) and one plain sentence for the placement: "Adds a pane to **workers** in **xx**." The sentence updates as the pickers change.
2. **Where row** (above the box, left-aligned, the same 13px muted step as the existing under-row): `Placement ▾` · `Repo ▾ path` · `Worktree ▾`.
3. **The composer box**, which is the existing `xtrm-composer-box` (same fill, shadow, 56px one-line height, 32px send button). The placeholder is "Describe the task, or leave empty to start idle". The send glyph is the same `CornerDownLeft`. Enter launches and Shift+Enter adds a newline.
4. **Who row** (under the box, right-aligned like the current target/model/effort row): `Runtime ▾` · `Role ▾` · `Model ▾` · `Issue ▾`, then the left-aligned muted **command preview**: `xt claude --role worker --issue XTRM-1078 --pane xx:workers --no-attach --json`. Click copies it.

Pickers (all popovers that open upward from their trigger, like the current agent menu, `max-h-72`, searchable when they hold more than 8 rows):

- **Placement:** a list of `New session` (optional session name), then each session with `New window` (optional window name), then its windows with `Split`. A check marks the selection. Windows without agents are listed too (§3.1).
- **Repo:** recent repos first (distinct repo roots of live panes plus the last 5 launched, stored in localStorage `xtrm.viewer.launch.v1`), then "Other path…", an absolute-path input that the server validates as a directory in a git repo. Line 2 shows the path in mono.
- **Worktree:** New worktree from `origin/<default>` (default) · New worktree from… (ref input, `--base`) · Existing worktree ▸ (unattached worktrees of this repo from `xt topology --json` `orphans.worktrees`, launched with `xt attach <slug> --fresh`).
- **Runtime:** Claude · Pi · Codex, one line each, with a reason when disabled (§3.3).
- **Role:** none (plain session) · grouped list from `specialists list --json` (`name`, `description`, `category`, `model`). Line 2 is the description, truncated.
- **Model:** the role's default as the placeholder, then the models allowed for the runtime. Anthropic models are hidden for Pi (rule in `ANTHROPIC_MODEL`). Free text is allowed.
- **Issue:** free text with a ref check (`sb issue show --json` through the host). It shows the title when the ref resolves.

**Default placement (d):** the window of the currently selected scope when one is selected, else a new session. The last-used repo, runtime, role and model persist in localStorage. As in t3code, a picker that is not at its default reads in `--x-ink`.

**Launch states**, in the draft timeline:

- *Starting:* a launch card "Starting claude in a new worktree…" with shimmer (the existing `xtrm-shimmer`) and elapsed seconds. The send button shows a spinner. The fields are locked.
- *Ready:* the outcome `ok` arrives with `session_name:pane_id`. The viewer selects the new pane's scope. The draft row becomes the real pane row once discovery sees it (one poll). An audit toast reads "Started worker-a3 in xx › workers".
- *Failed:* the card turns `--x-danger` and shows the outcome `reason_code`, the `summary`, Retry and Copy command. The fields unlock and keep their values. Nothing is lost.

**Empty states:** with no tmux server, the sidebar says "No tmux server. Start one with New session" and the `+` stays. With no agent, the main pane offers the `+ New thread` button in place of "No agent".

### 5.4 Close

Pane row ▸ **Close thread…** opens a console `DialogFrame` (`packages/xtrm-app/src/ui/dialog.tsx`, `rounded-lg bg-raised shadow-float`, width 32rem):

- Header: "Close worker-a3" plus the branch and worktree path in mono.
- **Agent:** status dot plus word. While `working`: "The agent is working. Stop it in the composer (Esc) before you close." Commit, Discard and Close are disabled.
- **Changes:** one row per file from porcelain v2, with an `M / A / D / R / ??` glyph in diff colours, and counts in the section title.
- **Not pushed:** n commits ahead of upstream, or "no upstream".
- Actions, left to right: `Discard changes…` (danger ghost) · ── · `Commit and push` (opens an inline message field prefilled `XTRM-1078: <title>`, then runs `git add -A && git commit -m && git push -u origin <branch>` as separate argv calls; repo hooks run) · `Close thread` (primary, enabled only when clean and pushed).
- **Discard confirmation** (a second, AlertDialog-style frame): "Discard 4 changes in worker-a3?" It lists every file and says "This cannot be undone. Commits are kept." It has Cancel and a red `Discard 4 files`. There is no type-to-confirm. It is one explicit confirmation, as the contract asks.
- **Close** runs, in order: (1) re-read git state (it must still be clean and pushed); (2) `xt worktree release --pane <id>` (§3.5); (3) when release removed the tree, `tmux -S <sock> kill-pane -t <id>` only if the pane still exists. The result is a toast plus an audit line. A release refusal shows its blockers in the dialog verbatim.

### 5.5 Move

| Action | Menu | tmux (all with `-S <sock>`) | Undo |
|---|---|---|---|
| Pane to another window | Pane ▸ Move to ▸ `<window>` | `join-pane -d -s %P -t <session>:<window>` then `select-layout -t … tiled` | `join-pane` back to the source window, or `break-pane` if the source window is gone |
| Pane to a new window | Pane ▸ Move to ▸ New window in `<s>` | `break-pane -d -s %P -t <s>:` (same session) or `break-pane` then `move-window` (other session) | `join-pane` back |
| Window to another session | Window ▸ Move window to ▸ `<s>` | `move-window -s <s0>:<w> -t <s>:` | `move-window` back |

- Moves are reversible, so there is no confirmation. A toast reads "Moved worker-a3 to xx › workers · Undo" (5 s, `mod+z` while it shows).
- After a move, the selection follows the pane. The sidebar scrolls to it and its row fades in once (150 ms `bg-pressed`, none under reduced motion). A source window left empty by tmux disappears from the tree.
- Drag and drop of rows is phase 3. Menus are keyboard-accessible and testable first.
- The server re-reads the pane against a fresh discovery before every move, as `/api/send` does, so a stale id cannot move a reused pane.

## 6. Host endpoints (phase 2)

All endpoints are `POST`, pass `requireWrite` and `hostVerdict` (`server/guard.ts`), use `execFile` with argv only, use `-S <sock>` on every tmux call, are re-checked against a fresh discovery, and write one audit line (§7).

| Route | Body | Runs | Returns |
|---|---|---|---|
| `/api/launch` | `{runtime, cwd, name?, prompt?, role?, issue?, model?, base?, attach?: slug, placement: {kind: "session"\|"window"\|"pane", session?, window?, windowName?, layout?}}` | `xt <runtime> [name] --no-attach --json …` or `xt attach <slug> --fresh …` | the `xtrm.command-outcome.v1` object plus `{session, paneId}` |
| `/api/worktree-status` (GET) | `?paneId=` | `git -C <@agent_worktree> status --porcelain=v2 --branch`, `git log --oneline @{u}..` | `{worktree, branch, files[], ahead, upstream, agentStatus}` |
| `/api/worktree-action` | `{paneId, action: "commit-push"\|"discard"\|"release", message?, files?}` | commit plus push / restore plus clean on `files` (each must be in the last status) / `xt worktree release --pane` | outcome plus a fresh status |
| `/api/move` | `{paneId?, windowTarget?, to: {kind, session, window?}}` | `join-pane` / `break-pane` / `move-window` | `{paneId, session, window}` plus the undo body |
| `/api/topology` (GET) | — | `tmux -S list-windows -a`, `xt topology --json --no-github`, `specialists list --json` (cached 60 s) | picker data |

## 7. Audit and visibility

- Every mutating route appends one JSONL line to `~/.xtrm/state/pi-viewer/actions.jsonl` (proposal): `{at, route, argv, cwd, paneId, outcome, ms}`. Message text is not stored; only its length and hash are kept for send.
- The UI shows each action three times: before (the command preview or the dialog), during (the launch card or the button spinner), and after (a toast with Undo where an undo exists, and the result in the dialog).
- **Open (lead):** whether launch also writes a Substrate journal line on `--issue`. I propose no; the xt launcher already records the issue binding.

## 8. Phased build plan (after operator approval)

| PR | Content | Gate |
|---|---|---|
| P1 | Socket resolution and `-S` on all existing viewer tmux calls; `menus.ts` builder plus the Base UI context menu on all four row kinds (copy items only); Shift+F10 and long press | unit tests for the builder; browser gate: menus on each row kind, keyboard open |
| P2 | `/api/topology`, `/api/launch`, the draft scope, pickers, command preview, launch card; entry points a, a', b, c, d; `mod+shift+o` | browser gate on a private socket: all four entry points start a pane at the right placement; `@agent_*` options match the identity doc after each |
| P3 | `/api/worktree-status`, `/api/worktree-action`, close dialog, discard confirmation | browser gate: dirty → commit and push → close; dirty → discard → close; working agent disables actions |
| P4 | `/api/move`, Move submenus, Undo toast | browser gate: join, break, move-window and undo; options unchanged after each |
| core | C1, C2 (and C3 if needed), owner 9hym | core CI |

P2 depends on C2 for the socket. Codex placement depends on C1, and P2 ships with Codex limited to new session and new window until C1 lands.

## 9. Decisions requested

1. Viewer-local `/api/launch` (recommended) or extend the agent-host launch first (§3.2).
2. `XTMUX_SOCKET` env (recommended) or `--socket` flag (§3.4); open C1 and C2 as core issues.
3. 9hym: how release behaves without `--client` (§3.5).
4. Base UI in the viewer (recommended) or Radix ContextMenu with console classes (§5.2).
5. Audit file location and the Substrate journal question (§7).
6. Operator: the draft-thread model (§5.3) over a modal dialog, and Undo instead of confirm for moves (§5.5).
