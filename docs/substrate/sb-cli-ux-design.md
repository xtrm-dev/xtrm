# Substrate `sb` CLI UX — terminal-native operator design

**Status:** design contract for later implementation  
**Date:** 2026-09-15  
**Scope:** `packages/substrate/cli`, Substrate Pi integration, Substrate Claude plugin/MCP, operator docs and related skills  
**Authority:** presentation/interaction only; this document does not change Substrate Issue, Journal, readiness, claim, provenance or lifecycle semantics

## 1. Decision

The `sb` CLI must feel like a first-class terminal application rather than a thin debug projection over the typed service.

The target is deliberately terminal-native:

- dense, readable, minimal chrome;
- tmux-like interaction and color vocabulary;
- a strong selected-row treatment, using the familiar black-on-yellow / reverse-video family rather than decorative panels;
- clear headers and local section hierarchy;
- keyboard-first navigation;
- tree indentation for Epic/child structure;
- useful defaults that show active work rather than the entire historical board;
- explicit, concise success/no-op/failure feedback after mutations;
- the same semantic execution feedback exposed through `sb`, the Pi integration and the Claude plugin/MCP;
- machine output remains stable and free of presentation concerns.

This is a presentation contract over existing typed services. ANSI, terminal Markdown, selection state and interactive navigation must not leak into `IssueService`, `JournalService`, `ProvenanceService`, or persisted state.

## 2. Current-state audit

Current `packages/substrate/cli/sb.ts` is intentionally thin and still renders most Issue data as one-line projections.

Current human Issue summary:

```text
<locator> · <humanRef> · <title> [<state> rev<revision>]
```

Current `sb issue show` already fetches substantially more information than it renders to humans:

- lifecycle state;
- current revision and contract hash;
- full contract;
- readiness state;
- dispatchability;
- readiness reasons;
- latest attestation;
- active claim;
- provenance summary.

The JSON payload therefore contains the information needed for a richer human surface; the human renderer currently discards most of it.

Current contract rendering builds literal Markdown-shaped text (`## problem`, `- item`) rather than rendering Markdown as terminal typography.

Current `sb issue list` returns every Issue in the project, including terminal history. It has no status filter.

Current `sb issue tree` already recursively indents children. That hierarchy should inform the normal list surface rather than existing as a separate discoverability island.

Current errors are structurally sound: nonzero exit, stderr in human mode, structured `{ok:false,error}` in JSON mode, and unknown flags fail closed. Success feedback is much weaker: most mutations return a generic Issue/object rendering instead of explicitly stating what happened.

## 3. Design principles

### 3.1 Terminal, not dashboard

Do not turn `sb` into a boxed dashboard.

Prefer:

```text
spacing
alignment
indentation
short separators
bold headers
one strong focus highlight
small semantic status marks
```

over:

```text
nested boxes
cards around every section
large colored backgrounds
heavy borders
multiple simultaneous accent colors
```

The target should visually belong beside tmux, fzf, git and a good Unix pager.

### 3.2 Information first

Structure before decoration.

Color communicates state or focus. It must not be used simply because a field exists.

Use terminal defaults for ordinary body prose.

### 3.3 One strong focus treatment

Interactive selection should use a tmux-like `mode-style` concept.

Preferred default:

```text
selected row: black foreground on yellow/amber background
```

with a monochrome fallback using reverse video.

This focus treatment is stronger than status colors. Do not simultaneously paint a selected row red/green/yellow based on status; retain textual/symbol status inside the highlighted row.

### 3.4 Human TTY, plain pipe, structured machine mode

Human TTY output may use ANSI styling and terminal Markdown.

When stdout is not a TTY:

- no ANSI escapes;
- no spinner/animation;
- no interactive prompt;
- no alternate-screen browser;
- deterministic text unless `--json` was explicitly selected.

Respect at minimum:

```text
NO_COLOR
TERM=dumb
```

Add a consistent explicit `--no-color` / `--plain` policy if implementation does not already provide one.

`--json` remains the stable machine contract and must not change because the human renderer improves.

### 3.5 Color never carries state alone

Pair color with symbols/text.

Examples:

```text
○ open
◐ in progress
● blocked
✓ completed
! warning
✗ failure
```

Exact glyphs may be adjusted after terminal-width testing, but every state must remain understandable with color disabled.

Avoid Nerd Font or emoji dependencies.

## 4. Visual vocabulary

Keep the palette intentionally small and based on terminal/ANSI semantics rather than hard-coded RGB branding.

Suggested roles:

```text
body/default         terminal foreground
metadata             dim/default
heading/reference    cyan or blue
success              green
warning/attention    yellow
failure/blocker      red
selected row         black on yellow (tmux-like mode style)
separator            dim/default
```

Yellow background is reserved for focus/selection in interactive views. Yellow foreground remains available for warnings where necessary, but avoid presenting both heavily in the same local surface.

Do not assume dark terminal backgrounds.

## 5. `sb issue show`

`show` becomes the canonical human Issue inspector.

It should render current state, authority-relevant metadata and the contract in one readable terminal document.

Target shape:

```text
XTRM-252  Final Substrate agentic work model
──────────────────────────────────────────────────────────────
OPEN        P1        EPIC        READY
rev 4       claim coordinator · 41m left
locator XTRM-252

Problem
  Complete repository identity, Journal outcomes, Closure and
  execution/session provenance across Substrate.

Success
  • `sb init` is the normal repository setup
  • Specialist results persist automatically
  • terminal Issues preserve outcome and reason

Scope
  • xtrm
  • core
  • specialists

Constraints
  • one global state.db
  • fail closed across repositories

Validation
  • full Substrate acceptance suite
  • multi-session provenance E2E

──────────────────────────────────────────────────────────────
Journal       18 entries · latest result 23m ago
Provenance     4 receipts · 6 commits · PR #185
Children       8 active · 5 done · 1 blocked
```

The precise footer depends on data available after the final Journal/Closure amendment lands. Do not fabricate unavailable counters.

### 5.1 Header rules

The header should make the following scannable immediately:

- durable human reference;
- title;
- lifecycle / derived operational state;
- priority;
- kind;
- readiness;
- revision;
- active claim if present;
- closure outcome when terminal.

Do not lead with opaque machine IDs.

### 5.2 Markdown contract rendering

Contract string values must render as terminal Markdown, not raw Markdown source.

Support at least:

- headings;
- paragraphs and wrapping;
- unordered and ordered lists;
- emphasis;
- inline code;
- fenced code blocks;
- links;
- basic tables where terminal width permits.

Body prose stays neutral/default foreground. Heading style may use bold plus a restrained accent. Inline/code uses a separate semantic token, not rainbow syntax.

If output is too long and stdout is a TTY, pager integration may be considered, respecting `$PAGER`; do not require a pager for ordinary Issues.

## 6. `sb issue list` — active board by default

The default list should represent current actionable work, not every terminal Issue ever created.

Normal:

```bash
sb issue list
```

means the active board.

Terminal states such as completed/cancelled/archived are excluded by default.

Explicit history remains available through filters or `--all`.

### 6.1 Status filters

Support status filtering with a concise, composable surface:

```bash
sb issue list --status open
sb issue list --status in_progress
sb issue list --status blocked
sb issue list --status ready
sb issue list --status deferred
sb issue list --status closed
sb issue list --status open,in_progress
sb issue list --status done,cancelled
sb issue list --all
```

Do not add `in_progress`, `blocked` or `ready` blindly to the persisted lifecycle enum.

Prefer derived operational status:

```text
open + live claim                 → in_progress
open + unsatisfied blocking edge → blocked
open + dispatchable readiness    → ready
done                             → closed/completed presentation
```

The presentation/query layer may expose these familiar concepts while preserving the stronger Substrate domain separation.

Potential later filters:

```text
--kind
--priority
--claimed
--unclaimed
--parent
--search
```

They are not required to block the first UX implementation.

## 7. Tree-aware list rendering

Normal list output should preserve Epic/child relationships where available.

Example:

```text
○ P1  XTRM-252      Final Substrate closeout
  ↳ ◐ P1  XTRM-253  Repository-native init
  ↳ ● P1  XTRM-254  Closure provenance              blocked
  ↳ ○ P2  XTRM-255  Documentation anti-drift

○ P1  XTRM-331      Provider session correlation
  ↳ ◐ P1  XTRM-337  Claude session lineage
```

Use simple indentation and one light relationship glyph. Avoid elaborate ASCII tree forests unless they materially improve nested depth beyond two levels.

Provide:

```bash
sb issue list --flat
```

for consumers/operators who prefer a flat board.

When a filter matches a child whose parent does not match, retain enough dim ancestor context to keep the child understandable rather than presenting an orphaned locator.

## 8. Interactive browser

Add a small interactive read-first navigator, conceptually:

```bash
sb issue browse
```

This is not a replacement for `xtrm-tui` and not a new workflow runtime.

It is a local operator browser over the same presentation/read model.

Target layout:

```text
Substrate · xtrm                       active 18 · blocked 2

  ○ XTRM-252   Final Substrate closeout
    ◐ XTRM-253   Repository-native init
  > ● XTRM-254   Closure provenance
    ○ XTRM-255   Documentation

────────────────────────────────────────────────────────────
XTRM-254 · Closure provenance
P1 · blocked · task · rev 2
Blocked by XTRM-253

Implement durable closure outcome/reason...
────────────────────────────────────────────────────────────
↑↓/jk move   Enter inspect   / search   f filter   q quit
```

The selected line receives the tmux-style yellow background.

### 8.1 Interaction grammar

Initial required bindings:

```text
↑ / k       previous row
↓ / j       next row
Enter       inspect/open selected Issue
+ / -       expand/collapse selected Epic where meaningful
/           incremental search
f           filter
Esc         cancel current search/filter/detail state
q           exit browser
? / F1      help
```

A concise bottom hint line should always show the currently relevant actions.

Every interactive state must have an obvious escape path.

### 8.2 Mutations in browser

The first implementation should be read-mostly.

Possible later object-local commands:

```text
c claim
n note
x close
r reopen
```

Do not ship interactive mutation until success/failure feedback, confirmation policy and parity with CLI/Pi/Claude are correct.

### 8.3 Screen strategy

Prefer a tmux/fzf-like hybrid or simple alternate-screen implementation depending on library behavior and usability testing.

The important properties are:

- no ornamental shell;
- stable rows;
- immediate keyboard feedback;
- selection clearly visible;
- terminal restored on exit and Ctrl-C;
- no requirement for a mouse.

## 9. Command execution feedback

Every mutating command must explicitly report its outcome in human mode.

A successful function return is not enough; feedback should be based on the canonical post-mutation state/receipt where applicable.

### 9.1 Success

Examples:

```text
✓ Created XTRM-341 · Add CLI issue browser

✓ Updated XTRM-341
  revision 2 → 3
  readiness invalidated

✓ Claimed XTRM-341
  coordinator · expires in 59m

✓ Added finding to XTRM-341 · journal seq 18

✓ Closed XTRM-341
  outcome: completed
  reason: Acceptance suite passed

✓ Linked XTRM-341 → XTRM-252 · discovered_from
```

Keep confirmations short. Additional detail appears only when it affects what the operator should know next.

### 9.2 No-op / idempotent success

Do not imply mutation when nothing changed.

Example:

```text
○ XTRM-341 already has priority P1 · no change
```

This distinction is particularly useful for agents and retries.

### 9.3 Warning / partial state

Example:

```text
! Updated XTRM-341
  revision advanced to 4
  readiness is now stale

  next:
    sb issue validate XTRM-341
```

Warnings may still exit `0` if the requested mutation succeeded. The message must be explicit about residual work.

### 9.4 Failure anatomy

Every expected human-facing failure should answer:

1. what failed;
2. why;
3. what to do next.

Example:

```text
✗ Cannot claim XTRM-254
  already claimed by reviewer-02 until 15:42

  inspect:
    sb issue show XTRM-254
```

Do not expose raw stack traces by default.

Use debug/diagnostic mode for unexpected internal errors if required.

## 10. Confirmation policy

Do not prompt before every normal mutation. That would damage scriptability and agent operation.

Confirmation prompts are reserved for destructive, irreversible or broad/batch actions.

If a command requires confirmation:

- prompt only when stdin is a TTY;
- provide an explicit bypass such as `--yes`/`--force` according to operation semantics;
- without a TTY, never hang: refuse and explain which explicit flag is required;
- Ctrl-C cancels cleanly and restores terminal state.

Post-operation acknowledgement is mandatory for all mutations whether or not pre-confirmation is required.

## 11. Shared feedback contract across CLI, Pi and Claude

Execution outcome semantics must not be CLI-only decoration.

The CLI, Pi extension and Claude plugin/MCP all consume the typed Substrate service directly, so mutation outcomes should be represented once as structured result semantics and adapted per surface.

Conceptually:

```text
Typed service mutation
       ↓
OperationResult
  status: changed | unchanged | warning
  entity/ref
  action
  summary
  relevant state deltas
  remediation / next action when applicable
       ↓
 ┌──────────────┬───────────────┬────────────────┐
 │ sb CLI       │ Pi tool       │ Claude MCP     │
 │ human ANSI   │ structured    │ structured     │
 │ / plain      │ + concise msg │ content/text   │
 └──────────────┴───────────────┴────────────────┘
```

Do not make Pi or Claude parse CLI strings.

### 11.1 Pi

Pi tool results should include enough structured data for the model to know:

- mutation succeeded;
- actual post-state;
- whether a revision changed;
- whether readiness became stale;
- whether a claim/closure/note was actually created;
- the safe next action when one is mechanically known.

Human-visible Pi rendering may use the same concise success/warning/failure vocabulary where the integration exposes tool output to the operator.

### 11.2 Claude

Claude MCP tools must return equivalent structured semantics and useful bounded text content.

A model should not infer success merely because no MCP exception was raised.

The result must say what changed or that the operation was a no-op.

### 11.3 Error parity

The same underlying error condition should map coherently across all three surfaces.

Example:

```text
foreign live claim
```

must remain the same semantic failure whether observed through:

```text
sb issue claim
Pi substrate_issue_claim
Claude substrate issue tool
```

Human wording can differ slightly; error kind, relevant IDs/state, retryability and remediation must not contradict each other.

## 12. Presentation architecture

Keep presentation separate from domain services.

Target shape:

```text
IssueService / JournalService / ProvenanceService
                   │
                   ▼
          presentation/read model
          ├─ machine JSON renderer
          ├─ plain renderer
          ├─ rich TTY renderer
          └─ interactive browser
```

Suggested implementation modules may include:

```text
cli/presentation/
  theme.ts
  terminal.ts
  markdown.ts
  issue-view.ts
  issue-list.ts
  operation-feedback.ts
  symbols.ts

cli/browser/
  model.ts
  keys.ts
  render.ts
```

Exact filenames are not normative.

Do not duplicate Issue/readiness business logic in these modules.

## 13. Semantic theme tokens

Use named roles rather than scattered ANSI codes.

Conceptually:

```text
text.primary
text.muted
accent.reference
focus.selected
status.success
status.warning
status.error
status.info
separator
markdown.heading
markdown.code
```

The default theme maps `focus.selected` to the tmux-like yellow background.

A later theme mechanism may remap tokens. This document does not require a full theme system.

## 14. Plain and accessibility degradation

Every rich surface must remain understandable under:

```text
NO_COLOR=1
TERM=dumb
stdout redirected
16-color terminal
monochrome/reverse-video terminal
narrow terminal
```

Selected row fallback:

```text
color terminal       black on yellow
monochrome terminal  reverse video
plain output          `>` selection prefix
```

Do not require Unicode box drawing for correctness. Provide simple ASCII/plain fallbacks where needed.

## 15. Output stream contract

Preserve standard CLI composability.

- primary command data/document goes to stdout;
- errors go to stderr;
- transient progress/warnings not part of primary data go to stderr;
- JSON mode remains pure structured output;
- ANSI never contaminates redirected/piped output;
- exit `0` means the requested operation succeeded;
- failure exits nonzero.

Do not add noisy informational logging to stderr by default.

## 16. Help and discoverability

Update help when these surfaces land.

Examples:

```text
sb issue list --help
sb issue show --help
sb issue browse --help
```

`issue list --help` must explain default active-only behavior and how to include terminal history.

`issue browse --help` must list keyboard bindings and state that it requires a TTY.

Examples should appear before exhaustive option reference where practical.

## 17. Recommended implementation packets

### UX-1 — rich non-interactive rendering

Implement:

- terminal capability detection;
- semantic color tokens;
- plain fallback;
- Markdown renderer;
- rich `issue show`;
- no changes to JSON shape.

### UX-2 — active board and hierarchy

Implement:

- active-only default list;
- `--status`;
- `--all`;
- tree-aware list projection;
- `--flat`;
- derived status rules;
- filtered ancestor context.

### UX-3 — operation feedback parity

Implement:

- structured operation-result semantics where required;
- success/no-op/warning/failure human renderers;
- remediation hints;
- Pi parity;
- Claude MCP parity;
- confirmation policy for destructive operations only.

### UX-4 — interactive browser

Implement:

- `sb issue browse`;
- keyboard navigation;
- tmux-like selected-row styling;
- search/filter;
- expand/collapse;
- preview/inspect;
- clean Ctrl-C/exit restoration;
- read-only or read-mostly first release.

## 18. Acceptance matrix

### Human rendering

- `sb issue show` exposes the state already available to the CLI rather than discarding readiness/claim/provenance context.
- contract Markdown renders as terminal Markdown.
- no unnecessary boxes/chrome.
- headings and references scan clearly.
- narrow-terminal wrapping remains usable.

### List

- default excludes terminal history.
- `--all` restores full board.
- explicit lifecycle/derived-status filters are correct.
- Epic children are visibly indented.
- filtered children retain necessary ancestor context.
- `--flat` is deterministic.

### Interactive browser

- selected row is unmistakable.
- default selection uses tmux-like yellow background when color is available.
- reverse/plain fallback is visible without color.
- arrow keys and `j/k` work.
- Enter, search, filter, expand/collapse, help and quit are discoverable.
- Ctrl-C and abnormal exit restore the terminal.
- browser refuses cleanly when no TTY exists.

### Feedback

For every public mutating Issue/Journal/claim/relation/lifecycle command:

- human success acknowledgement exists;
- idempotent/no-op state is distinguishable from changed state;
- error is nonzero;
- expected error says what/why/next;
- JSON result/error remains structured;
- no false success before durable post-state is available.

### Pi / Claude parity

For representative create/edit/claim/note/close/reopen operations:

- CLI, Pi and Claude report the same semantic outcome;
- revision/readiness effects agree;
- no-op agrees;
- claim-conflict failure agrees;
- remediation is not contradictory;
- neither provider parses CLI output.

### Pipe and accessibility

Run at minimum:

```sh
sb issue list | cat
sb issue show XTRM-1 | cat
NO_COLOR=1 sb issue list
TERM=dumb sb issue show XTRM-1
sb issue list --json | jq .
sb issue browse </dev/null
```

Verify no ANSI leakage, hangs or corrupted output.

## 19. Explicit non-goals

This design does not authorize:

- changing Issue authority semantics;
- adding `in_progress` as a persisted lifecycle state merely for display;
- replacing the typed service with CLI text parsing;
- making fzf, tmux or Nerd Fonts mandatory dependencies;
- building the full `xtrm-tui` inside `sb`;
- adding a second issue store;
- heavy theming or branding chrome;
- requiring confirmation for ordinary safe mutations;
- changing the existing JSON contract gratuitously.

## 20. Research basis

This design was cross-checked against current terminal/CLI guidance and tmux interaction conventions.

Useful external references:

- Command Line Interface Guidelines — https://clig.dev/
- GitHub TUIKit terminal foundations — https://github.com/github/TUIKit/blob/main/docs/foundations.md
- CLI Spec — https://clispec.dev/
- tmux `choose-tree` / choose mode manual — https://man.archlinux.org/man/extra/tmux/tmux.1.en
- tmux `mode-style` discussion confirming the traditional selected row as black text on yellow background — https://github.com/tmux/tmux/issues/1530
- nWave terminal UX skill — https://github.com/nWave-ai/nWave/blob/main/nWave/skills/nw-ux-tui-patterns/SKILL.md
- SOTA CLI UX skill — https://github.com/martinholovsky/sota-skills/blob/main/skills/sota-cli-ux/SKILL.md

The relevant common principles are intentionally narrow:

```text
human-friendly TTY output
machine-friendly explicit structured output
minimal color with semantic roles
visible keyboard focus
brief success acknowledgement
errors with remediation
TTY-aware interactivity
NO_COLOR support
clean exit/cancellation
stable machine contracts
```

## 21. Final target

The intended experience is not a new dashboard.

It is a compact terminal-native tracker that makes the durable board pleasant to inspect and operate:

```text
sb issue list
    → active, hierarchical, scannable board

sb issue show XTRM-252
    → rich terminal document with real current state

sb issue browse
    → tmux-like keyboard navigator with yellow selected row

sb issue claim / note / edit / close
    → immediate, explicit, trustworthy operation feedback
```

The same underlying mutation semantics must remain equally explicit to Pi and Claude.

The governing design rule is:

> **Use terminal conventions, not decorative chrome. Make focus obvious, state scannable, actions trustworthy, and machine contracts boringly stable.**
