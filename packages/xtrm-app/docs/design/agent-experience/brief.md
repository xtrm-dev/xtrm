# Agent experience — design brief (Phase 0 inputs)

Epic: XTRM-621 · This brief: XTRM-622 · Navigator implementation: XTRM-630 · Date: 2026-10-04
Decision record: [ADR-001 — Agent experience: design authority and process](../../adr/ADR-001-agent-experience-design-authority.md)

This brief is the shared starting point for every Phase 0 design direction. It states the goal, the
users, what exists today, what the operator asked for, the hard constraints, the scenarios that every
direction must show, and how the directions are judged. It does not design anything.

## 1. Goal

**The operator prefers working in the XTRM Agent surface over the terminal and over other agent
harnesses** (Claude Code, Codex, Pi in tmux).

Today the operator runs many agents in tmux and moves between them with the xtmux fzf picker. The app
wins only if it is faster to answer three questions than the terminal is:

1. What needs me now?
2. What is everything doing, and how does it relate (repo, worktree, issue, branch, PR, who dispatched whom)?
3. How do I talk to this agent, comfortably, without losing my place?

## 2. Audience

- **Primary: the operator.** One expert user, keyboard-first, runs 5–15 live agents across 3–6
  repositories, often with a coordinator agent that dispatches workers into worktrees. Uses
  light and dark themes. Large monitor (1440×900 and larger) and a laptop (1280×720).
- **Secondary: agents reading screenshots.** Coordinators compare implementation screenshots against
  the approved design. Every state must be legible in a static screenshot, without hover.
- **Readers of this brief:** the designers of directions A, B and C (XTRM-623/624/625), the
  component study (XTRM-626) and the Claude design pass.

## 3. What exists today

The Agent half shipped in XTRM-557 and passes 45/45 real-host acceptance tests (XTRM-601). It works,
but it does not look or feel like the product the operator wants. The `before/` screenshots show it in
light and dark, at 1440×900:

| File | Shows |
|---|---|
| `01-launch-*` | First load. Sidebar "Sessions 557", one group "Other 557", selected-session Details block, source-status footer. |
| `02-new-session-*` | New-session popover (cwd, launch profile, name, model). |
| `03-frame-activity-*` | A settled Frame: request, collapsed tool group "Read 3 files · ran 1 command", reply, Frame divider. |
| `04-tool-group-expanded-*` | The same group expanded: flat rows (`read notes.txt 14ms`). |
| `05-frame-dock-*`, `06-history-*` | Frame dock under the composer; History (Frames list). |
| `07-drawer-*` | Inspector drawer on a session. |
| `08-long-output-*` | Lazy long tool output. |
| `09-session-working-*` | A live, working session. |
| `10-extension-request-*` | An inline extension prompt waiting for the operator. |
| `11-reference-picker-*` | The `@` reference picker. |
| `12-tool-classes-*` | Native / MCP / extension / coordination tool rows. |

Sources: `docs/screenshots/agent-half/acceptance/` and `docs/screenshots/agent-half/` (renamed copies).
The full set, including the real-host run, stays in `docs/screenshots/agent-half/`.

Measured gaps (epic XTRM-621): no v15 shell; a flat, jumpy list of every indexed session (555 on the
operator's host) with live work not separated from history; no Frame header actions; activity as flat
rows, not semantic cards; a plain composer; no inspector rail; no registry components used.

## 4. Operator feedback

Collected from XTRM-618, the XTRM-557 closure and the operator's messages up to 2026-10-04.

1. **The sidebar jumps.** Rows reorder and shift while events stream. This is the most visible defect.
2. **Live work is buried.** 555 history sessions sit in one list with the 8 live ones. Live sessions
   must come first, as attention-first, notification-style entries ("Now"): waiting for input,
   failed, finished and unread, working — in that order.
3. **The composer is a plain box.** Wanted: floating card, context line (repo · branch · agent),
   slash palette, `@` picker with previews, model and thinking-level selectors, permission mode,
   attachments, visible queued steer/follow-up chips, keyboard-first.
4. **Chat polish.** Activity must read as grouped semantic cards (commands with exit status, file
   edits with inline diff, coordination threads, extension prompts) that stream calmly with zero
   layout shift. Errors must clear when the input is corrected (XTRM-618 note on 31-02).
5. **v15 and v14 are inspiration, not authority.** Take the shell spirit from v15 and the Agent ideas
   from v14 (Frame header actions, coordination blocks, History with Frames/Tree, `/` menu, Frame
   dock, drawer tabs). Do not pixel-copy either.
6. **2026-10-04 — navigate by tmux, not by project.** Agent navigation is derived from the operator's
   open tmux sessions, the way the xtmux picker works, but more polished. The per-project view becomes
   secondary. An optional graph view of the same topology is wanted and must be extensible later.
   Section 5 covers this in detail.

## 5. The Sessions navigator (central requirement)

### 5.1 What it replaces and what feeds it

The Sessions navigator replaces the per-project session sidebar as the default Agent navigation. It
is fed by the host topology projection, `xt topology --json` (schema `xtrm.topology.projection.v1`,
source `core/cli/src/core/topology-projection.ts`). One snapshot contains:

- `panes[]` — one entry per tmux pane: session, window, command, cwd, and, when an agent runs in it,
  `agent` (state, role, task, issue id, worktree, branch, `parent_session_id`, `parent_pane_id`);
  plus `jobs[]` (specialist jobs owned by the pane, with chain ids), `bead` (issue), `worktree`
  (path, branch, head, shared-by panes) and `pull_request` (number, state, draft, checks).
- `orphans` — specialist jobs and git worktrees that no pane owns.
- `sources[]` — per-source health (xtmux, tmux, specialists, issues, git, github) with status and
  duration. A source can be `error` or `unavailable` while the rest is fine.

Two sample files are in this folder:

- `topology-sample.json` — a real capture from the operator's host, sanitized (host and instance ids
  replaced, paths under `$HOME` shown as `~`, timestamp fixed). It shows the shape of real data: 8
  panes, one tmux session (`xtrm`) holding 6 panes across 3 repositories, no specialist jobs, no
  dispatch lineage, GitHub skipped, the issue source failing, and 37 orphan worktrees.
- `topology-scenario.json` — **synthetic**, same schema. It adds what the real capture lacks: a
  coordinator with five dispatched children (`parent_pane_id`), a specialist chain (executor →
  reviewer), open/draft/merged PRs with check states, issue status and titles, every attention state,
  a shared worktree, an orphan job and orphan worktrees. Use it for the scenario set (§8).

### 5.2 What the xtmux picker does well (keep these)

Source: `~/dev/xtmux/bin/tmux-session-picker` and `~/dev/xtmux/docs/keys.md`.

- **Attention first.** Rows are grouped "needs attention / active / other". A session takes the state
  of its most urgent pane. `Alt-1..5` jumps straight to the Nth waiting agent from anywhere;
  ``Alt-` `` jumps back.
- **Worktrees under their repository.** Any path under `.xtrm/worktrees/` or `.worktrees/` is grouped
  under the parent repository; branch and git status still come from the worktree itself.
- **Dense, two-line cards.** Line 1: current marker, session name, idle age, state. Line 2:
  repo · branch (prefix stripped) · git flags (`↑ahead ↓behind +staged ~modified ?untracked
  !conflict`) · "shared" when two sessions use one worktree. Pane rows nest under the session with
  tree glyphs and show command and task/issue.
- **Stable identity inside a row.** Fixed identity tokens come first (marker, state, pane id),
  changing payload (command, path) last, so the eye finds the same column every time. Actions use
  the hidden pane id, never the visible text.
- **Cursor stays put** on refresh (fzf `--track`).
- **Rich preview on demand.** Session: state, repo, windows, agent details, issue summary, worktree,
  git diff stat, last lines of each pane. Pane: the same plus the last 48 lines of output.
- **Specialist and staleness badges.** `[sp]` for specialist sessions, `[stale]` for a running state
  older than 45 minutes or a specialist without a live runner.
- **Fast triage actions** without leaving the list: approve (y+Enter), interrupt, message, rename,
  kill, bulk kill with one confirmation; filter presets (all / waiting / running) and a filter menu
  (repo, branch, command, text in recent output).

### 5.3 Where the picker falls short (improve on these)

- **The list still moves.** "Stable-first" means token order inside a row, not list order. Sessions
  jump between sections as agents change state, and only the cursor is preserved. The app must move
  rows only on a real state transition, never while the pointer or keyboard focus is in the list,
  and animate the move in place.
- **No live refresh.** States update only on reload or after an action; git info can be 30 s old.
  The app is live.
- **Colour carries state.** Pane id and state differ by colour only. Every state needs a shape or
  word as well as a colour, and must survive a greyscale screenshot.
- **Truncation.** Commands cut at 11 characters, tasks at 24; the preview is ~40 columns. The app
  can show issue titles, full branch names on hover, and PR status.
- **Inconsistent ranking.** "Done" ranks above "running" in the attention list but below it in the
  groups. The app needs one documented order (proposal in §6).
- **Staleness is easy to miss and fails open.** Without a timestamp nothing is stale; idle age is a
  second, similar-looking signal. Show one clear "stale" treatment and explain it in the tooltip.
- **No repository header rows.** Grouping drives sort order only; the repository is repeated on every
  row.
- **Hidden keys.** Many chords (`Alt-x` vs `Alt-X`, `^Y`, `^O`) appear only in `?` help. The app shows
  actions on hover/focus and in a shortcut sheet.
- **No relationships.** Parent session/pane data exists but is never shown. No coordinator → worker
  lineage, no issue → worktree → branch → PR chain.
- **Multi-pane sessions are flattened.** The session preview shows only the most urgent pane.

### 5.4 Hierarchy tension the directions must resolve

tmux sessions and repositories do not nest cleanly. In the real sample, tmux session `xtrm` holds
panes in `~/dev/core`, `~/dev/xtrm` and `~/dev/specialists`. XTRM-630 asks for
`session → window → pane` and for worktrees grouped under their repository. Each direction must show
its answer, for example: session-first with a repo chip per pane; repo-first with tmux session as a
secondary label; or a toggle. Per-project grouping stays available, as a secondary view.

### 5.5 Behaviour required of every direction

- Selecting an **agent pane** opens its Frame. Selecting a **non-agent pane** shows a read-only live
  preview and "Open in terminal". tmux mutations (kill, rename, switch) are out of scope for the
  first implementation; designs may reserve space for them.
- **Filter-as-you-type**, fzf-style, matching session, window, pane, repository, branch and issue.
  Fully keyboard-driven.
- **Full history** (hundreds of past sessions) lives in the Agents fleet view with search, grouping
  and virtualization, not in the navigator.
- **Source health** is visible when a source is down (for example "GitHub skipped", "issues
  unavailable"), without alarming the operator when everything else works.
- **Multiple hosts:** a host level appears only when more than one host is connected.

### 5.6 Optional graph view

A Graph view of the same projection, off by default and remembered per viewer. It shows tmux sessions
and panes, agents, dispatch lineage (`parent_pane_id` / `parent_session_id`, specialist chains), and
the work chain issue → worktree → branch → PR, with the same state colours and shapes as the list.
Clicking a node opens its Frame or issue. It must be **extensible**: design it around a registry of
node kinds (host, session, pane, agent, job, issue, worktree, branch, PR) and edge kinds (contains,
dispatched, works-on, checked-out, opened), so later features add overlays (cost, CI, review state,
messages) without a redesign. Show how an added node or edge kind would look.

## 6. Principles

1. **Attention first, then everything else.** The first thing on screen answers "what needs me".
   Proposed single order: needs input → failed → stale → finished and unread → working → idle →
   finished and read. Directions may argue for a different order, once, explicitly.
2. **Nothing moves under the operator.** Zero layout shift while streaming. Rows reorder only on state
   transitions and never while the pointer or focus is in the list.
3. **The Frame is the hero.** The conversation surface gets the space; navigation and inspection
   frame it.
4. **Topology is real.** Navigation reflects the operator's actual tmux sessions, panes, worktrees
   and dispatch lineage, not an index of past sessions.
5. **Keyboard first, mouse friendly.** Every primary action has a key and a visible affordance.
6. **State is never colour alone.** Shape, word or icon as well as colour; legible in a screenshot.
7. **Quiet and dense.** Supernova-level restraint: flat, hairline borders, minimal shadow, restrained
   violet accent, hover-revealed secondary actions. No card soup, no dashboard look, no terminal
   cosplay.
8. **Calm streaming.** Text and cards stream at 60 fps without reflow of what is already read.

## 7. Constraints

### 7.1 From the PRD (`docs/xtrm-gui-prd.md`)

- **§34.2** Supernova is the benchmark for restraint and cleanliness; XTRM keeps its own palette,
  accent, typeface and naming.
- **§34.3–34.4 Shell:** persistent global icon rail (never collapses, never shows repo state);
  contextual sidebar with repository selector, full-width search, groups Work / Code / System /
  Governance with counts, hover/focus row actions and a footer; when collapsed, a narrow rounded
  reopen rail, never zero width; explicit command palette and `⋯` menus; the collapsed inspector rail
  stays visible. §34.12: search sits in a full-width top bar.
- **§34.5 Drawer:** one drawer primitive with states closed / contextual / pinned / maximized and a
  follow-live flag; it renders inside the primary region; maximized collapses the sidebar; the Frame
  dock is a drawer mode; the reference stack is URL-restorable.
- **§34.6 Stack:** Base UI, motion panels, TanStack Router, TanStack Virtual (the only virtualizer),
  cmdk. Designs must be buildable with these.
- **§34.8** A Frame belongs to exactly one agent session.
- **§34.9 Visual standard:** quiet, flat, restrained, professional, dense but readable.
- **§34.10** says "No further static HTML mocks". Epic XTRM-621 (rev 2/3) explicitly requires new
  Phase 0 mocks, so the epic contract governs Phase 0. A PRD amendment is needed (reported as a
  follow-up, not done here).
- **§36.2** An always-visible Console / Agent switch at the top of the rail (`Mod+.` toggles). Layout:
  global rail | navigation sidebar | Frame surface | inspector rail + drawer. Live work is never
  unmounted.
- **§36.3** The navigator replaces this section's per-project session sidebar (amendment pending in
  XTRM-630). Keep its row content: role, work item, model, context % meter, Frame number, relative
  time; selected-session details; `New session` in the footer; virtualized.
- **§36.4 Frame surface:** header, centred reading column of about 760 px. Frames are chapters,
  reached through the recent-Frames dock under the composer and History (Frames / Tree). The
  transcript is never one unbounded scroll. View state is kept per session.
- **§36.5–36.6 References:** the drawer is a reference source ("Attach to composer"); the `@` picker
  is cmdk; invalid references fail before submit; budgets 4–32 KB per kind, 96 KB per submit (§36.12).
- **§36.7 Tool classes:** native, MCP, extension, coordination; nested calls; codemode script block.
  Each needs a distinct but quiet treatment.
- **§36.13 Accepted deviations:** Tree is not projected yet (XTRM-617); journal-only Frames have less
  fidelity. Designs may show Tree, marked as future.

### 7.2 From the epic and this phase

- v15 (`docs/mocks/console-v2-v15-supernova-substrate.html`) and v14
  (`docs/mocks/console-v2-v14-agent-supernova-substrate.html`) are inspiration, not authority.
- **Deliverable format:** self-contained HTML (inline CSS and JS, no network, no new dependencies),
  shown at 1440×900 and 1280×720, in light and dark. Each direction delivers its mocks plus
  screenshots of every scenario in §8.
- Light/dark parity, reduced-motion support, 60 fps streaming, no cumulative layout shift.
- Registry-first: assume components come from @agents-ui, @spectrumui, @shadcn and Base UI, adapted.
  XTRM-626 decides the set; directions should not depend on bespoke widgets without saying so.
- Out of scope: host or protocol changes (note any data a design needs that the projection lacks),
  Remote Control parity (XTRM-611), Console halves other than the shared shell.

### 7.3 Data the designs may assume, and data they may not

- Available now: everything in `topology-sample.json`; agent session data shown in `before/`
  (model, provider, context %, tokens, cost, Frames, tool classes).
- **Not available yet** (mark as "needs data" in the mock if used): a `failed` agent state from hooks
  (the hooks emit needs-input, running, done, idle, off); a last-transition timestamp in the
  projection (needed for stale and "finished unread"); PR check states (`checks_state` is always
  null today); dispatch lineage on real hosts (fields exist, mostly null); window names.

## 8. Shared scenario set

Every direction shows all of these, light and dark, at 1440×900; S1, S2 and S5 also at 1280×720.
Use `topology-scenario.json` as the data.

| # | Scenario | What the screen must make obvious |
|---|---|---|
| S1 | **Morning return.** 10 panes in 7 tmux sessions across 3 repos: 1 needs input, 1 failed, 2 finished (one unread), 4 working, 1 agent off, 1 plain process; 555 history sessions exist. | What needs me, in under 2 seconds. History does not compete. |
| S2 | **Streaming without jumping.** Three agents stream at once while the operator reads the navigator; one changes state from working to needs input. | Which row moved, why, and that nothing else moved. Show before/after frames. |
| S3 | **Coordinator and workers.** Coordinator `claude-48ac` dispatched five workers; direction-b runs an executor → reviewer chain with a draft PR, checks pending. | Lineage, who is blocked on whom, issue → worktree → branch → PR. |
| S4 | **Graph view.** The S3 topology as a graph, plus one added overlay kind (e.g. CI status or messages). | Same states as the list; how a new node or edge kind fits. |
| S5 | **Answer a waiting agent.** Open direction-a (needs input: an extension prompt), answer it, return to the list. | Path from list to answer in at most two actions; where focus lands after. |
| S6 | **Read a busy Frame.** A Frame with commands (one failed, exit status), a file edit with inline diff, a coordination thread, an extension prompt, a long output. | Semantic cards, calm hierarchy, failed command findable at a glance. |
| S7 | **Compose with intent.** Composer with context line, `/` palette open, `@` picker with a file preview, model + thinking level, permission mode, an attachment, one queued steer chip. | Everything reachable by keyboard; queued steer is visible. |
| S8 | **Non-agent pane.** Select `%2` (a `node` process, no agent). | Read-only live preview, "Open in terminal", no Frame UI. |
| S9 | **Shared worktree and orphans.** Two panes in one worktree (`%3`, `%8`); 1 orphan specialist job, 2 orphan worktrees. | Shared-worktree warning; orphans visible but quiet, with a way to act later. |
| S10 | **Degraded sources.** Issue source in error, GitHub skipped, agent host live. | What still works, what is missing, without alarm. |
| S11 | **Find old work.** The operator types "XTRM-604" in the filter; the session is history, not live. | Filter covers live rows; history is one step away in the fleet view. |
| S12 | **Shell context.** The Agent half inside the v15-spirit shell: global rail, Console/Agent switch, sidebar collapsed to the reopen rail, inspector rail, drawer pinned. | The navigator and Frame live inside the shared shell. |

## 9. Evaluation rubric

The coordinator and the Claude design pass score each direction 1–5 per criterion. Weights sum to 100.
A score of 1 on any criterion marked **gate** disqualifies the direction until it is fixed.

| Criterion | Weight | 5 means | 1 means |
|---|---|---|---|
| Attention clarity (S1, S5) — **gate** | 15 | The operator names every agent needing them within 2 s; one action opens it. | Waiting agents look like working ones or sit below the fold. |
| Stability under streaming (S2) — **gate** | 15 | Rows move only on state transitions, never under focus or pointer; the move is legible. | Rows reorder or shift height while reading. |
| Topology fidelity (S1, S3, S8, S9) | 12 | tmux sessions, panes, worktrees under repos, lineage and shared worktrees all readable; §5.4 tension resolved clearly. | Per-project index in disguise; lineage invisible. |
| Improvement over the picker (§5.3) | 10 | Each shortfall in §5.3 is addressed visibly. | A terminal list with nicer fonts. |
| Graph view and extensibility (S4) | 8 | Same states as the list; a new node or edge kind fits without redesign. | Decorative graph or a separate visual language. |
| Frame and activity (S6) | 10 | Semantic cards, failed items findable, calm hierarchy, ~760 px reading column. | Flat rows or card soup. |
| Composer (S7) | 10 | All listed capabilities, keyboard-reachable, queued input visible, compact when idle. | A plain text box with buttons around it. |
| Keyboard operation | 6 | Every scenario completable by keyboard; keys visible where used. | Mouse-only paths. |
| Visual standard (§34.9, light/dark) | 8 | Quiet, dense, readable; full light/dark parity; state survives greyscale. | Dashboard look, colour-only state, theme gaps. |
| Buildability (§34.6, registry-first) | 6 | Maps to Base UI and registry components; needs no new data, or flags it. | Bespoke widgets or data the host cannot give. |

Record per direction: scores, the three strongest ideas worth stealing for the chosen direction, and
the data gaps it exposes.

## 10. Files in this folder

| Path | What |
|---|---|
| `brief.md` | This brief. |
| `before/` | 12 screens × light/dark of the current Agent half (§3). |
| `topology-sample.json` | Sanitized real `xt topology --json --no-github` capture. |
| `topology-scenario.json` | Synthetic scenario in the same schema, used by §8. |
| `../../mocks/console-v2-v14-agent-supernova-substrate.html` | The operator's v14 mock (Agent view, Agents fleet, graph, drawer tabs). |
| `../../mocks/console-v2-v15-supernova-substrate.html` | v15 shell mock (Issues, Program, GitHub). |
| `~/dev/xtmux/bin/tmux-session-picker` | The picker (outside this repo). Key bindings: `~/dev/xtmux/docs/keys.md`. |
