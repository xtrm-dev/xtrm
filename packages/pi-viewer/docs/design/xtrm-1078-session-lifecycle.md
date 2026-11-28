# Start, close and move agent sessions from the threads app (XTRM-1078)

Status: phase-1 draft 3 (thread-lead reviews of #527 applied: round 1 rulings in §9, design fixes a-g, the socket test in §3.4; round 2 polish: draft dot, runtime/model rule, F6, F10, §8). For the operator after the lead. No application code changes in this phase.
Contract: Substrate `XTRM-1078` rev 2; journal seq 2-5 (operator note, lead inventory, the native-tmux correction, the operator direction).
Mockups: [`mockups/session-lifecycle.html`](mockups/session-lifecycle.html) (desktop 1440, `?w=390` for phone, `?theme=light|dark`). Screenshots: [`shots/XTRM-1078/`](shots/XTRM-1078/) (`xtrm-1078-<frame>-<theme>.png`, frames F1-F10 at 1440 and M1-M3 at 390).
Reference studied: `pingdotgg/t3code` at `17a44b5e5fb9548571a0e3016ec51f5d74b884c8` (2026-11-28), shallow clone, source read only. `T3/` means `apps/web/src/`.

Every statement is marked when it matters: **verified** (read in source or observed in a command this session), **inferred** (derived, not observed), **proposal** (my design choice, open to the operator).

## 1. Summary

1. Starting a thread is a **draft thread** in the main pane, not a form or a modal. It uses the composer the operator already knows: the prompt box, with the pickers placed around it the same way as the existing target, model and effort under-row. The four entry points open the same draft. They differ only in the placement prefilled into the placement picker.
2. The composer shows **where** above the box (placement, repo, worktree) and **who** under it (runtime, role, model, issue). A quiet **Command** disclosure under the who-row expands to the exact, full `xt` argv that Enter will run, with Copy. It never shows a truncated argv. That preview is how "every action is visible" is met before the action runs.
3. **Close** is a dialog on the pane row. It shows the worktree's git state and has three actions: Commit and push, Discard (behind its own confirmation, which lists the files), and Close, which is enabled only when the tree is clean and pushed. Close ends the agent's pane and runs `xt worktree release --pane`.
4. **Move** is a submenu on the pane and window rows. It uses native `tmux join-pane`, `break-pane` and `move-window`, all with `-S`. Moves are reversible, so they get an **Undo** toast and no confirmation, as t3code does for archive.
5. Phase 2 needs four viewer host endpoints (`/api/launch`, `/api/worktree-status`, `/api/worktree-action`, `/api/move`) and one audit log. It needs **core-cli changes** that the contract allows only when an existing flag cannot express the need. The private-socket test in §3.4 found more gaps than draft 1 expected: the `--json` launch path ignores `--pane`, refuses `--window`, and a failed placement leaves orphan panes. §4 states each gap with evidence.

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
| Shortcuts: `mod+n` / `mod+shift+o` new thread, `mod+k` palette, `mod+shift+m` model picker, and one per composer picker, each shown in its tooltip. | `packages/shared/src/keybindings.ts:116-128` | `Ctrl+Alt+N` / `⌃⌥N` for new thread (§5.1 states the browser check; `mod+n` and `mod+shift+o` belong to the browser). Pickers show their shortcut in their tooltips. There is no command palette in phase 2 (§3.6). |
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
**Proposal:** this is the case the contract allows for core cli: give `xt codex` the same placement flags as `xt pi` (core issue, owner 9hym). Until it lands, the runtime picker disables Codex for a pane placement, with the reason "Codex cannot add a pane to a window yet".

### 3.4 Socket and placement: the private-socket test (verified, 2026-11-28)

Ruling to test: does `xt` honour a child `TMUX="<sock>,<pid>,0"` with an explicit placement flag? Method: `unset TMUX TMUX_PANE; export TMUX_TMPDIR=$(mktemp -d)`, a private server on `-S $TMUX_TMPDIR/<x>.sock` holding one `sleep` pane in session `probe`, a scratch git repo with a local bare `origin`, then `xt pi --no-attach ...`. After every run, the default server still had its 5 windows, and each private server was stopped with `tmux -S <sock> kill-server`.

| Child env | Placement | Result |
|---|---|---|
| `TMUX=<sock>,<pid>,0` | `--new-session --json` | ok: a session on the private server. `@agent_parent_session` is set from the fake `TMUX` (`$0`, then `$1`) and is wrong for a UI launch |
| `TMUX=<sock>,<pid>,0` | `--pane probe:base` / `--workers --session probe` | `✗ tmux placement failed: no current client`. The pane is **still created** and left running, without `@agent_worktree`/`@agent_branch`. The worktree and branch remain |
| `XTRM_SESSION_SOCKET=<sock>`, `env -i` | `--new-session --json` | ok: on the private server, `@agent_parent_session ''`. `xt` already honours this variable |
| `XTRM_SESSION_SOCKET=<sock>`, `env -i` | `--pane probe:base --json` | **`status: ok`, but the pane is in a new session `pi-2l0q`, not in `probe:base`**: the JSON path ignores `--pane` |
| `XTRM_SESSION_SOCKET=<sock>`, `env -i` | `--workers --session probe --json` | `no current client`, orphan pane left |
| any | `--window --session probe [--window-name w2]` with `--json` | `✗ --window cannot combine with --json` |
| `XTRM_SESSION_SOCKET=<sock>`, `env -i` | `--window --session probe --window-name w2` (no `--json`) | worktree created, then `no current client`, orphan window left |
| `XTRM_SESSION_SOCKET=<sock>`, `env -i` | `xt codex 8137 --no-attach --json` / `xt pi 8137 …` with `xt/8137` taken | plain text, **no outcome object**: `✗ Worktree branch already exists: xt/8137` / `✗ Worktree path already exists. Refusing to reuse stale directory.`, exit status non-zero |

Also observed: launched from this agent's pane, the child inherited `XTMUX_AGENT_ISSUE`, `XTMUX_AGENT_ROLE` and others, and the new panes carried `@agent_issue XTRM-1078`, `@agent_role worker` and `@agent_dispatcher sessiondesign`. With `env -i`, `@agent_dispatcher sessiondesign` still appeared, so `xt` reads the dispatcher from a source other than the child env (**inferred**: an ancestor process). No claim or journal entry was written on XTRM-1078 (checked with `sb issue show` and `sb journal show`).

**Conclusions.**
1. The socket is solved without a fake `TMUX`. The viewer runs `xt` with `XTRM_SESSION_SOCKET=<its socket>` and **no** `TMUX`. A fake `TMUX` corrupts `@agent_parent_session`. The variable the lead proposed (`XTMUX_SOCKET`) is not needed; C2 as a socket change is dropped.
2. Placement is the real gap. Only `--new-session` works from a process with no tmux client. With `--json`, `--pane` is silently ignored (a wrong placement reported as `ok`) and `--window` is refused. Filed by the lead as **CORE-2826**.
3. A failed placement leaves a running orphan pane, a worktree and a branch. Filed by the lead as **CORE-2827**.
6. Under `--json`, launch failures print plain text and no `xtrm.command-outcome.v1` object, so there is no `reason_code` to show. The viewer maps them to `{status: "failed", reason_code: null}`, plus the exit status and the last `✗` line from xt's output. Proposed as C5: `--json` emits an outcome on every exit.
4. The viewer builds the child env from an allowlist (`HOME`, `PATH`, `USER`, `LANG`, `TMUX_TMPDIR`, `XTRM_SESSION_SOCKET`) and passes identity only as flags. Inheriting the env of the shell that started the viewer would stamp every launch with that shell's issue and role. The dispatcher leak is reported to core with C4.
5. The viewer's own tmux calls take `-S <socket>` everywhere. Today they carry none (`server/api.ts:619-620,649`, `server/discover.ts:91`); P1 fixes that.

### 3.5 Close and the release command (partly verified, partly open)

- **Dry-run side effect (verified).** `xt worktree release --pane %16 --dry-run`, run in this session, returned `action: nudged` and **typed the nudge into the agent's pane**. The lead read the source: the nudge branch runs before the `dryRun` check. The lead filed this as **CORE-2825**. The UI never uses release to read state. The viewer reads git state itself with `git -C <@agent_worktree> status --porcelain=v2 --branch` plus `git log @{u}..` (read-only).
- **Own agent exempt (inferred).** The blockers in that run were two pids, the shell running my own probe. The pane's agent process (`claude`, cwd inside the tree) was not listed. Release therefore appears to exempt the pane's own agent. Phase 2 verifies this on a private socket.
- **Confirmation path (verified by the lead in core `cli/src/core/worktree-release-pane.ts`).** Without `--client`, release returns `action: 'checked'` with "needs confirmation: press prefix+X ... (or pass --client)" and removes nothing. It also refuses when `process.env.TMUX` is unset. The host has no client and, by §3.4, no `TMUX`. **C3 is needed:** a host-confirmed, non-interactive path, `--confirmed-by <actor>`, that names who confirmed (the viewer passes `pi-viewer:<operator>`), writes that actor into release's log, and takes the server from `XTRM_SESSION_SOCKET`. It is not a bare `--yes`.
- **Discard.** Per journal seq 4: Discard runs `git restore --staged --worktree -- <files>` and `git clean -f -- <untracked files>` on exactly the listed files. Release gets no force flag. Commits that are not pushed are not "discarded" by this. The dialog offers Push for them, and the branch is kept by release anyway.

### 3.6 Over-built or premature

- **A command palette.** The viewer has none, and the console's `cmdk` palette is a separate surface. **Proposal:** phase 2 ships the shortcut `Ctrl+Alt+N` / `⌃⌥N` and the menus. A palette waits for the shared shell work (XTRM-1098).
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
| C1 | `xt codex`: `--pane`, `--session`, `--layout`, `--workers`, `--new-session` with `xt pi` semantics | Codex has `--window` only | `xt codex --help` |
| C2 = **CORE-2826** | Launcher placement from a process with no tmux client: `--pane`, `--workers` and `--window [--window-name] --session` must work under `XTRM_SESSION_SOCKET` and with `--json`. An unsupported combination must fail, never report `ok` for a different placement | `--json` ignores `--pane` and refuses `--window`; without `--json`, placement fails with "no current client" | §3.4 table |
| C3 | `xt worktree release --pane <id> --confirmed-by <actor>`, logged, server from `XTRM_SESSION_SOCKET` | Without `--client` release only checks; it refuses without `TMUX` | §3.5, core `worktree-release-pane.ts` |
| C4 = **CORE-2827** | Bug: a failed placement rolls back its pane, worktree and branch. Identity comes from flags, not from inherited `XTMUX_AGENT_*` env or ancestors | Orphan panes and worktrees after "no current client"; `@agent_issue`/`@agent_role`/`@agent_dispatcher` leaked | §3.4 |
| C5 | `--json` emits an `xtrm.command-outcome.v1` object on every exit, failures included | Branch and path collisions print plain text only | §3.4 |
| — | CORE-2825: release `--dry-run` nudges (filed by the lead) | | §3.5 |

Filed: CORE-2825, CORE-2826, CORE-2827. C1 and C3 are filed after operator approval (lead ruling). C5 is a proposal for the lead.

Until CORE-2826 lands, phase 2 ships entry point (c), New session, only. It works today (`--new-session --json` under `XTRM_SESSION_SOCKET`). Entry points a, a', b and d stay hidden until then.

No new verb for move or close (non-goal, journal seq 4).

## 5. Interaction model

### 5.1 Entry points

| # | Where | Gesture | Menu item | Prefilled placement |
|---|---|---|---|---|
| a | Window row (multi-pane window) | right-click, Shift+F10, ContextMenu key | New thread in this window | Pane in `session:window` (`--pane <session>:<window> --layout tiled`) |
| a' | Pane row (any) | same | New thread beside | Pane in that pane's window |
| b | Session row | same | New thread in new window | New window in that session (`--window --session <s>`) |
| c | Fixed "Sessions" header | same, plus a `+` icon button that appears on hover/focus | New session | New session (`--new-session`) |
| d | Top bar, far right | `+ New thread` button; `Ctrl+Alt+N` (Linux, Windows) / `⌃⌥N` (macOS) anywhere | — | Default (§5.3) |

**Shortcut check.** Google's Chrome shortcut page (support.google.com/chrome/answer/157179, Windows & Linux and Mac tabs, read 2026-11-28) assigns `Ctrl+Shift+O` (Bookmarks Manager), `Shift+Alt+N` and `⌘+Option+N` (split view), and `Shift+Alt+T` and `Shift+Alt+I`. It does not list `Ctrl+Alt+N` or `⌃⌥N`. Firefox's shortcut page could not be read (a challenge page was served), so Firefox is **unverified**. The P2 browser gate presses the key in Chrome and Firefox and asserts the draft opens. One known risk: on Windows, `Ctrl+Alt` acts as AltGr in Polish and other layouts (`AltGr+N` types `ń`). The handler matches `event.code === "KeyN"` with `ctrlKey && altKey` and never fires inside a text field. The fallback is a single `N` outside editable fields. The hint renders as text ("Ctrl Alt N") in the sans face, so no glyph reads as a digit.

Mobile has no right-click. A long press (500 ms) on a row opens the same menu as a bottom sheet. The top-bar button stays, as an icon only.

### 5.2 Menus (one builder, Base UI menu, console anatomy)

Anatomy is the console's `OptionsMenu` (`packages/xtrm-app/src/ui/menu.tsx`): `min-w-48 rounded-lg bg-raised p-1 shadow-float`, items `h-8 rounded-md px-2 text-sm text-ink-muted`, highlighted `bg-hover text-ink`, 16px muted icon. Added: a right-aligned `detail` in `text-xs text-ink-faint` (shortcut or reason), the submenu chevron, and a danger item (`text-danger`, `hover:bg-danger/10`) that always sits last after a separator. The viewer has `radix-ui`, not Base UI (verified, `package.json`). Phase 2 adds `@base-ui/react` to share the console's primitive, or ports the classes onto Radix's ContextMenu. **Proposal:** Base UI, one primitive family with the console.

- **Sessions header:** New session · `⇧⌘O` hint not shown (that shortcut opens default placement) · ── · Collapse all, Expand all.
- **Session row:** New thread in new window · ── · Move window here ▸ (lists windows of other sessions) · ── · Copy session name.
- **Window row:** New thread in this window · Move window to ▸ (sessions, "New session") · ── · Copy target (`xx:2`).
- **Pane row:** New thread beside · Move to ▸ (windows grouped by session; "New window in xx"; "New session") · ── · Copy ▸ (pane id, worktree path, branch) · ── · **Close thread…** (danger).

Disabled items stay visible with their reason, for example "Close thread… · agent is working".

### 5.3 The new-thread draft (one component)

The main pane switches to a **draft** scope. The sidebar shows a draft row at the target placement: a dashed row border and a static hollow dot, the size of the status dots. Every dashed or dotted ring tried at 7-10px read as a loader, so the dashes are on the row border, not on the dot. The dot becomes a spinner only after Enter, while the launch runs (F5). The draft has three parts, from top to bottom:

1. **Hero:** "New thread" (`text-base font-semibold`) and one plain sentence for the placement: "Adds a pane to **workers** in **xx**." The sentence updates as the pickers change.
2. **Where row** (above the box, left-aligned, the same 13px muted step as the existing under-row): `Placement ▾` (for example "Add pane to xx › workers") · `Repo ▾ path` · `Worktree ▾`.
3. **The composer box**, which is the existing `xtrm-composer-box` (same fill, shadow, 56px one-line height, 32px send button). The placeholder is "Describe the task, or leave empty to start idle". The send glyph is the same `CornerDownLeft`. Enter launches and Shift+Enter adds a newline.
4. **Who row** (under the box): `Runtime ▾` · `Role ▾` · `Model ▾` · `Issue ▾`.
5. **Command** disclosure on its own full-width line under the who-row. It is closed by default and shows only the word "Command". Open, it shows the full argv, wrapped and never truncated, with Copy: `xt claude --role worker --issue XTRM-1078 --pane xx:workers --layout tiled --no-attach --json`.

Hero, where-row, box, who-row and Command form **one block, centred vertically** in the main pane, as in t3code's draft. There is no void between the heading and the box at any width (F3, F4, M2). The launch card sits directly under the block.

Pickers (all popovers that open upward from their trigger, like the current agent menu, `max-h-72`, searchable when they hold more than 8 rows):

- **Placement:** a list of `New session` (optional session name), then each session with `New window in <s>` (optional window name), then its windows as `Add pane to <window>`. The UI never says "split". A check marks the selection. Windows without agents are listed too (§3.1).
- **Repo:** recent repos first (distinct repo roots of live panes plus the last 5 launched, stored in localStorage `xtrm.viewer.launch.v1`), then "Other path…", an absolute-path input that the server validates as a directory in a git repo. Line 2 shows the path in mono.
- **Worktree:** New worktree from `origin/<default>` (default) · New worktree from… (ref input, `--base`) · Existing worktree ▸ (unattached worktrees of this repo from `xt topology --json` `orphans.worktrees`, launched with `xt attach <slug> --fresh`).
- **Runtime:** Claude · Pi · Codex, one line each, with a reason when disabled (§3.3).
- **Role:** none (plain session) · grouped list from `specialists list --json` (`name`, `description`, `category`, `model`). Line 2 is the description, truncated.
- **Model:** the role's default as the placeholder, then the models allowed for the runtime. Anthropic models are hidden for Pi (rule in `ANTHROPIC_MODEL`). Free text is allowed.
  **Runtime change rule:** when the runtime changes, the model resets to the role's default for that runtime, else to the runtime's own default (shown as "<Runtime> default", which sends no `--model`). The list then shows only the models that runtime can run. A free-text model that the new runtime cannot run is cleared. The same reset applies when the role changes (F6: Codex with "Codex default").
- **Issue:** free text with a ref check (`sb issue show --json` through the host). It shows the title when the ref resolves.

**Default placement (d):** the window of the currently selected scope when one is selected, else a new session. The last-used repo, runtime, role and model persist in localStorage. As in t3code, a picker that is not at its default reads in `--x-ink`.

**Launch states**, in the draft timeline:

- *Starting:* a launch card "Starting claude in a new worktree…" with shimmer (the existing `xtrm-shimmer`) and elapsed seconds. The send button shows a spinner. The fields are locked.
- *Ready:* the outcome `ok` arrives with `session_name:pane_id`. The viewer selects the new pane's scope. The draft row becomes the real pane row once discovery sees it (one poll). An audit toast reads "Started worker-a3 in xx › workers".
- *Failed:* the card turns `--x-danger`. It shows the outcome `reason_code` and `summary` when xt returned an outcome; otherwise it shows the exit status and xt's own `✗` line (§3.4 item 6). Actions: Retry, Copy command, and "Use existing worktree" when the failure is a taken branch or path (`xt attach <slug> --fresh`). The fields unlock and keep their values. Nothing is lost. F6 shows a failure the UI cannot prevent: the branch `xt/8137` already exists. A placement the runtime cannot do is never offered (§3.3), so it cannot fail here.

**Empty states:** with no tmux server, the sidebar says "No tmux server. Start one with New session" and the `+` stays. With no agent, the main pane offers the `+ New thread` button in place of "No agent".

### 5.4 Close

Pane row ▸ **Close thread…** opens a console `DialogFrame` (`packages/xtrm-app/src/ui/dialog.tsx`, `rounded-lg bg-raised shadow-float`, width 32rem):

- Header: "Close worker-a3" plus the branch and worktree path in mono.
- **Agent:** status dot plus word ("Agent idle", "Agent working"). Only while `working`, a note row under it reads "Commit and push and Discard are off while the agent works. Stop it with Esc in the composer.", and Commit and push, Discard and Close thread are disabled (F10). While idle, the note row is absent (F7).
- **Changes:** one row per file from porcelain v2, with an `M / A / D / R / ??` glyph in diff colours, and counts in the section title.
- **Not pushed:** n commits ahead of upstream, or "no upstream".
- The header shows the branch, then the worktree path in mono, truncated **from the left** on one line with the full path in a tooltip.
- Actions, left to right: `Discard changes…` (danger ghost) · ── · `Commit and push` (opens a labelled "Commit message" field prefilled `XTRM-1078: <title>`, then runs `git add -A`, `git commit -m`, `git push -u origin <branch>` as separate argv calls; repo hooks run) · `Close thread` (primary). Close thread is always visible. While the tree is dirty or ahead it is disabled, and a line under the buttons gives the reason: "Close thread · commit and push first" (F7).
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
| `/api/launch` | `{runtime, cwd, name?, prompt?, role?, issue?, model?, base?, attach?: slug, placement: {kind: "session"\|"window"\|"pane", session?, window?, windowName?, layout?}}` | `xt <runtime> [name] --no-attach --json …` or `xt attach <slug> --fresh …`, env from an allowlist plus `XTRM_SESSION_SOCKET`, no `TMUX` (§3.4) | the `xtrm.command-outcome.v1` object plus `{session, paneId}` |
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
| P2 | `/api/topology`, `/api/launch` (child env from an allowlist, `XTRM_SESSION_SOCKET`, identity only as flags), the draft scope, pickers, Command disclosure, launch card, `Ctrl+Alt+N`. **Ships entry point (c) New session only; a, a', b and d stay hidden until CORE-2826 merges** | gate on a private socket: (c) starts a session, `@agent_*` match the identity doc with no inherited issue or role; failure card on a taken branch. **When CORE-2826 merges**, a follow-up PR enables a, a', b and d and extends the same gate to all of them |
| P3 | `/api/worktree-status`, `/api/worktree-action`, close dialog, discard confirmation | browser gate: dirty → commit and push → close; dirty → discard → close; working agent disables actions |
| P4 | `/api/move`, Move submenus, Undo toast | browser gate: join, break, move-window and undo; options unchanged after each |
| core | C1, C2, C3, C4 (owner 9hym); CORE-2825 | core CI |

The socket needs no core change (`XTRM_SESSION_SOCKET`, §3.4). Placements other than New session depend on C2, Codex placement on C1, and Close on C3.

## 9. Rulings (thread lead, round 1, 2026-11-28) and open items

1. Viewer-local `POST /api/launch`: **approved**.
2. Socket: tested (§3.4). `XTRM_SESSION_SOCKET` already works; a fake `TMUX` corrupts identity. The placement gap is C2.
3. C3 **needed**, as `--confirmed-by <actor>`. The dry-run nudge is CORE-2825.
4. Base UI in the viewer: **approved**, on the condition that P1 measures the gzipped bundle delta and reports it in its PR.
5. Audit at `~/.xtrm/state/pi-viewer/actions.jsonl`, no Substrate journal line on launch: **approved**.

Open: the core issues for C1, C2, C3 and C4 (owner 9hym; the lead opens them). Operator: approval of the draft-thread model (§5.3) and of Undo instead of confirm for moves (§5.5).
