# Console UI system — rail, toolbar, rows, PR identity, Project visuals, Specialists Factory

Issue: XTRM-853 (design pass and spec). Status: proposal for lead review, then operator look. Nothing in `src/` changes under this issue.
Companion design page: [`mocks/console-ui-system.html`](mocks/console-ui-system.html), a self-contained static file; the lead publishes it as an update of the private here.now page `smooth-tangle-g995`. It renders every item below in the Console light and dark themes, using the token values of `src/styles.css`.
Binding authority: ADR-002 §D9 (visual contract) and §12 (rulings of 2026-11-17); `sidebar-restyle.md` §5, §10, §11 (XTRM-632, XTRM-636/637). Paths below are relative to `packages/xtrm-app/`.

## 0. How to read this document

- **Existing** means the file and symbol exist today and the spec states what changes. **New** means the file does not exist; the path is where the implementation issue creates it. No new file is created by XTRM-853.
- "Consumers" lists the surfaces that render the component. A consumer not listed must not import it without a spec amendment.
- Every status is a word plus a shape; colour is never the only carrier (ADR-002 §D9, XTRM-853 CONSTRAINTS). Each component section states its text carrier.
- **Decisions followed, not reopened** (lead, 2026-11-18): status chip after the issue key; PR key coloured by state with the state in tooltip and `aria-label`; the row expand action is removed (the Inspector opens on click); a local list filter stays separate from Ctrl+K; linked Substrate refs go in a Linked column with `+N` and a popover.
- **Rulings requested** (§9) are the only places where this spec asks the lead to decide. Each has a default that the implementation issues use unless the lead rules otherwise.

## 1. Evidence: what was read, what was searched

### 1.1 Read

`src/styles.css`; `src/ui/{primitives,sidebar,icon,badge,github-pill,drawer,popover,menu}.tsx`; `src/shell/{ContextSidebar,Inspector}.tsx`; `src/issues/{IssuesSurface,pr-state,meta,PullRequestsBlock}.tsx`, `src/issues/issue-table.ts`; `src/github/{PullsSurface,PullPanel,pr}.tsx|ts`; `src/refs/references.tsx`; `src/app/destinations.ts`; `docs/adr/ADR-002-project-surface-status-board-and-jira.md` (§2 D1, D2, D9, §3, §7, §11, §12); `docs/design/sidebar-restyle.md`; the issue contracts XTRM-454..459 and XTRM-817..820.

The operator's three screenshots are not in the repository. This spec works from their description in the XTRM-853 PROBLEM statement (expandable sections with icons on children and misaligned labels; chip-like toolbar controls; oversized row icons and hover actions; PR list with a state dot and overflowing linked refs; PR inspector with the key and state buried). The "Today" panels in the design page are rebuilt from the current source, not from the screenshots.

The reference artifact `smooth-tangle-g995` was supplied by the lead as a file (`.lead-scratch/smooth-tangle/index.html`, git-excluded). Its structure (kicker/h2 sections, Mercury tokens, app-token miniatures, text-equivalent tables) is reused; its content is replaced by the XTRM-853 scope.

### 1.2 Registry search (ADR-001 Decision 6; `docs/ui-component-reference-registry.md`)

Registries configured in `components.json`: `@shadcn`, `@spectrumui`, `@agents-ui`, `@reui`. Searches run on 2026-11-18 with the `shadcn` MCP (`search_items_in_registries`, `view_items_in_registries`) and the `spectrum-ui` MCP (`search_components`, `get_component`):

| query | relevant result | disposition |
|---|---|---|
| `sidebar` (shadcn, 722 hits) | `@reui/c-sidebar-3` (search field, collapsing sections, sub-tree under the current page); `@reui/c-sidebar-2` (rail + tooltip at 3rem); `@spectrumui/sidebar-navbar` | **REFERENCE.** They depend on the shadcn `Sidebar` provider (Radix). The app owns `src/ui/sidebar.tsx` on Base UI and an existing row primitive; a second sidebar layer would fork behaviour. The rail geometry is hand-built from `Row`. |
| `tree view` (shadcn, 583 hits) | `@reui/c-collapsible-10` (tree with file actions); `@reui/app-shell-33` (searchable scope tree) | **REFERENCE** for disclosure semantics (`aria-expanded`, arrow keys). Hand-built, because the Workers tree needs per-row columns and virtualisation (`src/ui/virtual-list.tsx`). |
| `tree` (spectrum-ui) | `@spectrumui/tree-nav` ("a nav list with a tree rail and a spring marker"; depends on `motion`, `use-typewriter`) | **REFERENCE only.** It confirms the rail-plus-marker shape of the NavRail. The spring marker is rejected: it adds motion that the XTRM-632 weight spec does not allow and breaks `prefers-reduced-motion` unless re-guarded. `motion` is a dependency of the app (`package.json`), so this is a choice, not a limit. |
| `sidebar navigation` (spectrum-ui) | `sidebar-navbar`, `nav-list-card`, `link-search-footer` | Not applicable (marketing/footer patterns). |
| `expanding search input` (spectrum-ui) | no match (form inputs only) | Hand-built: `ListFilter` (§4.2) is a 28px icon button that widens its own input on focus. |
| `badge` (shadcn) | `@reui/badge`, `c-badge-1..7` (default, info, warning, success, outline) | **ADOPTED in part.** `src/components/reui/badge.tsx` already exists; `src/ui/badge.tsx` is the app's own tone map. The spec adds one derived tone (`success`) to the existing map instead of a second badge. |
| `hover card popover` (shadcn) | `data-grid-filtering-4` (Popover + HoverCard in a filtered grid) | **REFERENCE.** `LinkedRefs` uses `src/ui/popover.tsx` (Base UI), already in use in `ContextSidebar.tsx`. |
| `org chart node graph flow` (shadcn) | no graph/tree-chart component | The Workers tree is hand-built (§6). |
| `gantt-view` (`@reui`) | appeared in the `tree view` results | **REJECTED.** XTRM-853 NON-GOALS and ADR-002 §D9 exclude a Gantt-style chart. |

Consequence: no registry install is proposed. Every new component composes `Row`, `Badge`, `Icon`, `IconButton`, `Tip`, `Popover` and `Fields`.

## 2. Principles that every component follows

1. **Row anatomy is fixed.** `[disclosure 13px] [kind icon 13px] [key] [status chip] [title] … [meta columns] [one row action]`. Icons never exceed the text height of the cell they sit in.
2. **Chrome is quiet.** A control is a ghost control (no resting fill) unless it holds a value the operator typed or chose. Fill is the selection and the focus state, not the resting state. This removes the "chip" read from the toolbar.
3. **Rails and hairlines, not boxes.** Hierarchy is a 1px hairline (`--x-border-muted`) with a 2px accent marker on the active item. No card around a list (ADR-002 §D9).
4. **Accent is for selection, focus, references, attention.** A PR state colour is a state, not accent. The only accent use that overlaps is `merged` (§4.4); ruling R3 covers it.
5. **One component per concept.** One PR key, one PR state chip, one linked-refs cell, one row copy action, one rail. Surfaces compose them; they do not re-draw them.
6. **Light and dark are the same layout.** Only token values change. The design page shows each specimen in both themes.

## 3. Tokens

### 3.1 Existing tokens (unchanged)

Source: `src/styles.css` (`:root`, `:root[data-theme="dark"]`, `@theme inline`). Tailwind utilities are the only way a component reads a token (`bg-surface`, `text-ink-muted`, …).

| token (CSS var) | utility | light | dark | role | used by (this spec) |
|---|---|---|---|---|---|
| `--x-deep` | `bg-deep` | `#f4f4f5` | `#0d0d0d` | app background, content wells | page behind lists |
| `--x-sidebar` | `bg-sidebar` | `#f4f4f5` | `#232323` | sidebar plane | NavRail host |
| `--x-surface` | `bg-surface` | `#ffffff` | `#151515` | list and drawer plane | rows, inspector |
| `--x-raised` | `bg-raised` | `#ffffff` | `#1e1e1e` | popovers, tooltips | `LinkedRefs` popover, `Tip` |
| `--x-control` | `bg-control` | `#efeff1` | `#262626` | inputs, day headings | `ListFilter` input, `DayGroup` |
| `--x-hover` | `bg-hover` | ink @ 4.5% | white @ 3% | hover and focus fill | every ghost control, rows |
| `--x-pressed` | `bg-pressed` | ink @ 8% | white @ 6% | selected row, pressed | selected row, neutral chip |
| `--x-ink` / `-muted` / `-faint` | `text-ink*` | `#18181b` / `#5f5f68` / `#94949c` | `#ececef` / `#a0a0a8` / `#6a6a72` | text ladder | all |
| `--x-border-muted` | `border-border-muted` | ink @ 7% | white @ 8% | rail, section rules | NavRail rail, drawer sections |
| `--x-border-subtle` | `border-border-subtle` | ink @ 4% | white @ 6% | table grid only | row separators |
| `--x-border` / `-strong` | `border-border*` | ink @ 11% / 20% | white @ 12% / 18% | inputs, dashed provenance | `LayerChip` dashed |
| `--x-accent` | `bg-accent`, `ring-accent` | `#4f46e5` | `#818cf8` | selection marker, focus | NavRail active marker |
| `--x-accent-ink` | `text-accent-ink` | `#4338ca` | `#a5b4fc` | references, merged | `PrKey` merged, `ReferenceChip` |
| `--x-accent-soft` | `bg-accent-soft` | accent @ 10% | accent @ 12% | soft fill | `accent` badge |
| `--x-success` | `text-success` | `#1b7f46` | `#5ccb8a` | done, diff add | `PrKey` open |
| `--x-success-ink` | `text-success-ink` | `#146839` | `#5ccb8a` | success text on its own tint | `Badge success` |
| `--x-danger` | `text-danger` | `#c42b2b` | `#f07171` | blocked, error | `PrKey` closed, blocked chip |
| `--x-diff-add` / `-del` | `text-diff-add/del` | `#1b7f46` / `#c42b2b` | `#5ccb8a` / `#f07171` | diff counts | PR header and PR list |
| `--x-shadow-float`, `-panel` | `shadow-float`, `shadow-panel` | see file | see file | floating layers only | popover, Tip |
| `--x-strip-*` | `*-strip*` | see file | see file | sidebar foot strip | unchanged |
| `--radius-sm/md/lg` | `rounded-sm/md/lg` | 6 / 8 / 10 px | same | corners | rows `md`, chips `rounded` (4px via `Badge`) |
| `--text-xs` / `-sm` / `-base` | `text-xs/sm/base` | 11.5 / 13 / 14 px | same | type scale | cells `xs`, titles `sm` |
| `--font-sans` / `--font-mono` | `font-sans/mono` | Figtree / Geist Mono | same | mono only for keys, SHAs, paths | `PrKey`, `IssueKey`, branches |

### 3.2 Tokens this system adds

No new colour token and no new surface level. Four additions, all derived from existing tokens or sizes:

| addition | file | definition | why |
|---|---|---|---|
| Icon size `text` | `src/ui/icon.tsx` `SIZES` | `text: 13` (equals `--text-sm`) | Row and toolbar icons are 14px today (`xs`) beside 13px titles and 11.5px meta. Operator: "icons are larger than text". |
| Icon size `micro` | `src/ui/icon.tsx` `SIZES` | `micro: 12` (equals the `text-xs` cap height plus 0.5px) | Icons inside `Badge xs`, `PrKey` in dense cells, `LinkedRefs`. |
| Stroke rule | `src/ui/icon.tsx` | `strokeWidth` defaults to `2` for sizes `micro` and `text`; `2.25` stays for `nav`, `sm`, `md`, `lg` | 2.25 at 13px closes the counters of `git-pull-request`. |
| Badge tone `success` | `src/ui/badge.tsx` `TONE` | `success: "bg-success/12 text-success-ink"` (same pattern as `danger: "bg-danger/12 text-danger"`, with the ink token of §3.1 so the tint stays readable: 5.85:1 on white, 5.34:1 on the canvas) | GitHub-style Open chip. The only way to express it today is `active`, which is accent-soft and reads as "reference". |
| PR state map | `src/ui/pr-key.tsx` (new) | `PR_STATES` (§4.4) | One table for the key colour, the chip tone, the glyph, the word and the tooltip, so list, inspector, chips and prose cannot drift. |

`--x-success` in light is `#1f8a4c`: 4.38:1 on `#ffffff` and 3.98:1 on `#f4f4f5`, below the 4.5:1 text minimum at 11.5–13px. It becomes the `PrKey` open colour, so ruling R1 asks to darken it to `#1b7f46` (5.04:1 on white, 4.58:1 on `#f4f4f5`; verified by computation). Dark values pass (9.0:1 on `#151515`).

`--x-diff-add` follows `--x-success` in both themes: one datum, one green. It was `#1f8a4c` (4.38:1 on white) while `--x-success` moved, so the PR header and the PR list showed a second, lighter green next to the key colour. Lead ruling on the UI-1 review (XTRM-860).

`--x-success-ink` carries what `--x-success` cannot: `--x-success` as text on its own 12% tint is 4.30:1 on `#ffffff` and 3.93:1 on `#f4f4f5`, below the 4.5:1 text minimum. Light is `#146839`, the same hue darkened: 5.85:1 on the 12% tint over white (`#e4f0e9`) and 5.34:1 over the canvas (`#dae6e0`). Dark keeps `#5ccb8a` (7.06:1 on its tint over `#18181b`).

## 4. Components

For each component: file, props, states, accessibility, consumers. "Slice" names the implementation issue shape in §10.

### 4.1 NavRail — nested sidebar sections (item 1)

Replaces the `indent` prop of `SidebarRow` and the three hand-indented groups in `ContextSidebar.tsx` (`ProjectRows`, `ResearchRows`, and the Project toggle in `WorkSidebar`).

- **File:** `src/ui/sidebar.tsx` (Existing; adds two exports, removes `indent`).
- **Anatomy** (measured from `SidebarRow` today: `px-2`, icon 16, `gap-2.5`, label x = 8 + 16 + 10 = 34px):
  - Parent row: unchanged (`h-[30px]`, 16px `nav` icon, label 13px semibold, count or trailing chevron).
  - Rail: a `div` with `ml-[15px] border-l border-border-muted`. The rail x equals the centre of the parent icon (8px padding + 8px half icon = 16px; the 1px border sits at 15–16px).
  - Child row: `h-7` (28px), **no icon**, `pl-[18px]` so the label x is 16 + 18 = 34px: the child label aligns with the parent label (the aligned label column). Label 13px, weight 500, `text-ink-muted`; count right-aligned `text-xs text-ink-faint tabular`.
  - Active child: `text-ink font-semibold bg-hover`, plus a 2px marker on the rail: `before:absolute before:-left-px before:inset-y-1.5 before:w-0.5 before:rounded-full before:bg-accent`. The marker replaces the hairline at that row; the hairline is continuous elsewhere.
  - Hover and focus: `bg-hover` on the row only; the rail does not move.
  - Deferred child: `text-ink-faint` (existing deferred convention), still navigable.
  - Motion: none beyond the existing `grid-rows` collapse (150ms), disabled under `prefers-reduced-motion`.
- **Props:**
  ```ts
  NavRail({ children, label }: { children: ReactNode; label: string })              // renders role="group" aria-label={label}
  NavRailItem({ label, count?, selected?, deferred?, onActivate }: {
    label: string; count?: number | null; selected?: boolean; deferred?: boolean; onActivate?: () => void })
  SidebarRow({ …existing, children?: ReactNode })                                    // children render inside a NavRail below the row; `indent` is removed
  ```
- **Accessibility:** parent toggle keeps `aria-expanded` and the label `Expand|Collapse <label>`; the active child carries `aria-current="page"` (already set by `Row` when `selected`); ArrowRight expands and ArrowLeft collapses on the parent row (same keys as issue-tree rows, `sidebar-restyle.md` §12); the marker is decorative, the active state is also carried by weight and ink.
- **Consumers:** `ContextSidebar.tsx` → `WorkSidebar` (Project: Overview, Timeline, Questions, Workers, Follow-ups, Jira, Integration; Research: Experiments, Recent Runs, Saved Comparisons, Workloads). `src/agent/AgentSidebar.tsx` does not use nested rows today and is not changed.
- **Tests that change:** `src/ui/sidebar.test.tsx` (nested rows no longer pass `indent`), `src/app/shell.test.tsx` (Project and Research nesting assertions).

### 4.2 Toolbar — ghost controls and the local list filter (item 2)

- **File:** `src/ui/primitives.tsx` (Existing: `SurfaceToolbar`, `TOOLBAR_CONTROL`, `TOOLBAR_REST`, `TOOLBAR_GHOST`) and `src/ui/toolbar.tsx` (New).
- **Change to the tokens:** `TOOLBAR_REST` is deleted. Its resting `bg-pressed` fill is what makes `Status ▾`, `Priority ▾`, `Type ▾`, `Order by ▾` and `New issue` read as chips. `TOOLBAR_GHOST` becomes the only resting style: `text-ink-muted hover:bg-hover hover:text-ink focus-visible:bg-hover`. `TOOLBAR_CONTROL` (28px, `px-1.5`, `text-xs`, `gap-1`) is unchanged.
- **New components (`src/ui/toolbar.tsx`):**
  ```ts
  ToolbarButton({ icon?, children, primary?, ...button }: ComponentProps<"button"> & { icon?: IconName; primary?: boolean })
  //   resting: ghost. `primary` = text-ink font-medium (New issue). No border, no fill at rest.
  ToolbarFilter({ label, value, options, onChange }: { label: string; value: string | null; options: OptionItem[]; onChange: (v: string | null) => void })
  //   trigger = ghost text "Status" or "Status: open" (value in text-ink font-medium) + 12px chevron; wraps OptionsMenu (src/ui/menu.tsx).
  //   An active filter shows its value in the label; aria-label = "Status filter: open".
  ToolbarTabs({ tabs, value, onChange, label }: { tabs: Array<{ id: string; label: string; count?: number }>; value: string; onChange: (id: string) => void; label: string })
  //   role="tablist". Selected = text-ink + 2px bottom bar in --x-ink; unselected = ghost. Counts tabular, faint. (Replaces the bg-pressed selected tab in PullsSurface.)
  ListFilter({ value, onChange, placeholder?, count? }: { value: string; onChange: (v: string) => void; placeholder?: string; count?: number })
  ```
- **`ListFilter` behaviour (the local filter, distinct from Ctrl+K):**
  - Resting: a 28px `IconButton` with the `filter` icon (`ListFilter` from lucide, a new key `filter` in `icon.tsx`), label `Filter this list`, shortcut `/`. It is deliberately not the `search` magnifier, which belongs to global search (Ctrl+K, `GlobalSearch.tsx`).
  - Focused (click, `/`, or keyboard focus): widens from 28px to `w-48` (192px) over 150ms (instant under `prefers-reduced-motion`), shows an input with `placeholder="Filter this list"`, `bg-hover` fill, `focus-within:ring` from the global focus style. The widen is the only moving part.
  - With a value: stays expanded after blur, shows the match count (`12 of 41`, `aria-live="polite"`) and a `close` action that clears; Esc clears and collapses.
  - Scope: it filters the rows already loaded in the current surface by title, key and author. It never navigates and never queries other surfaces; Ctrl+K searches across surfaces and opens results.
- **Consumers:** `src/issues/IssuesSurface.tsx`, `src/github/PullsSurface.tsx`, `src/github/IssuesSurface.tsx`, `src/github/ReleasesSurface.tsx`, `src/github/ContentSurface.tsx`, `src/surfaces/ActivitySurface.tsx`, `src/surfaces/ResearchSurface.tsx`, `src/surfaces/other.tsx`, `src/settings/SettingsSurface.tsx` (every file that imports `SurfaceToolbar`/`TOOLBAR_*`, from `git grep`). The Inspector header's two bordered buttons (`Attach to composer`, `Open` in `src/shell/Inspector.tsx`) switch to `ToolbarButton` so the drawer and the toolbar share one look.
- **Order inside the toolbar:** `[SourceBadge] [primary action] [tabs or filters] [ListFilter] … [layout radio] [options menu]`. The layout radio and options menu stay at the end.

### 4.3 List rows (item 3)

- **File:** `src/ui/primitives.tsx` (`Row`, `IconButton`), `src/ui/icon.tsx`, `src/ui/badge.tsx`, `src/ui/row-action.tsx` (New), `src/issues/IssuesSurface.tsx`.
- **Icon size:** inside rows and toolbars use `Icon size="text"` (13px). `nav` (16px) stays for top-level sidebar destinations only.
- **Anatomy of an issue row** (`IssueRow` in `IssuesSurface.tsx`; the order changes):

  | slot | today | proposed |
  |---|---|---|
  | 1 | disclosure `size-5` + `xs` chevron | disclosure `size-5` button, `text` chevron (hit target unchanged) |
  | 2 | kind icon `xs` (14px) | kind icon `text` (13px), `title={kind}` kept |
  | 3 | `PriorityGlyph` | unchanged |
  | 4 | **status `Badge` (`w-16`)** | **key** (`IssueKey`, mono, `--key-col` width from `keyColumnRem`) |
  | 5 | key + `/ ref` | **status `Badge` `xs`**, fixed `w-[4.25rem]` (68px; "In progress" at `text-[0.62rem]` is about 57px plus `px-1`), label = `issueStatus().label`, `title={hint}` |
  | 6 | title | title (unchanged); detached parent chip `↑` stays |
  | end | `open` + `copy` `IconButton size-5` on hover | one `RowAction` (copy), `Icon text`, `size-5` |

  The status chip text is the state carrier (`Blocked`, `In progress`, `Ready`, …); the tone only reinforces it.
- **`RowAction`:**
  ```ts
  RowAction({ icon, label, onAct, doneLabel? }: { icon: IconName; label: string; onAct: () => void; doneLabel?: string })
  ```
  `size-5` (20px) button, `Icon text`, required `aria-label` and `Tip`. For copy: on act, the icon swaps to `check` for 1.2s and an `aria-live="polite"` node announces `doneLabel` (`Copied`). Revealed on hover and `focus-within` (existing `Row` `actions` behaviour); the row `actions` wrapper keeps `onClick` stop-propagation. In table rows the action sits at the row end, absolutely positioned over the trailing cell (`absolute inset-y-0 right-1`) with a `bg-surface` mask that becomes the hover fill on hover, so it never reflows the grid (the same technique as the current open/copy pair).
- **Removed:** the `open` row action (`IconButton icon="open"`). The Inspector opens on row click; the full page opens on double-click (existing `onDoubleClick`) and from the Inspector header `Open` button (existing, `Inspector.tsx`). The row disclosure chevron for tree children is a different control and stays.
- **Row geometry:** unchanged (`h-8` list rows, 32px virtual row height). No change to `Row` density names.
- **Consumers:** `IssuesSurface.tsx` (issues), `PullsSurface.tsx` (PR rows, §4.5), `github/IssuesSurface.tsx` (`#N` + title row), `surfaces/ActivitySurface.tsx`, Project rows (§6).

### 4.4 PR identity (item 4)

One module owns PR identity: **`src/ui/pr-key.tsx` (New)**. It absorbs `src/issues/pr-state.tsx` (`PrStateBadge`, which re-exports from the new module until its callers move), `pullStateTone`/`pullStateLabel` in `src/github/pr.ts` (kept as thin wrappers), and the state dot in `PullsSurface.tsx`/`PullPanel.tsx`.

**State model** — four states. `draft` is a flag on an `open` PR today (`pullStateLabel(state, draft)`); the module resolves it once:

```ts
type PrState = "open" | "draft" | "merged" | "closed";
prStateOf(state: string | null, draft?: boolean | null): PrState | "unknown"   // unknown is rendered neutral with its own word; a new upstream state never renders empty
PR_STATES: Record<PrState, { word: string; keyClass: string; chipTone: BadgeTone; icon: IconName; hint: string }>
```

| state | word | key colour (utility) | contrast (light on `#fff` / dark on `#151515`) | chip tone | glyph (lucide) | tooltip text |
|---|---|---|---|---|---|---|
| open | Open | `text-success` | 4.38 (5.04 after R1) / 9.01 | `success` (new) | `git-pull-request` | `Open — ready for review` |
| draft | Draft | `text-ink-muted` | 6.32 / 7.03 | `neutral` | `git-pull-request-draft` | `Draft — not ready for review` |
| merged | Merged | `text-accent-ink` | 7.90 / 9.16 | `accent` | `git-merge` | `Merged` (+ `merged_at` when known) |
| closed | Closed | `text-danger` | 5.63 / 6.35 | `danger` | `git-pull-request-closed` | `Closed without merging` |

The existing `PrStateBadge` maps `open → active`, `closed → muted`. The new map replaces that: open is green, closed is red, matching GitHub and the diff colours already on screen. `unknown` and `assumed` stay as in `pr-state.tsx` (the `assumed` suffix goes into the tooltip and `aria-label`).

**`PrKey`** — the key, coloured by state, used everywhere a PR key renders:

```ts
PrKey({ number, state, draft?, repo?, glyph = true, className }: {
  number: number; state: string | null; draft?: boolean | null; repo?: string;   // repo shows "owner/name" faint after #N when set
  glyph?: boolean;                                                               // text-size state glyph before #N
  className?: string })
```

- Render: `<span class="inline-flex items-center gap-1 font-mono text-xs {keyClass}" title="{tooltip}" aria-label="Pull request #{number}, {word}">[glyph]#{number}[repo]</span>`. Mono is allowed for keys (ADR-002 §D9).
- The state is carried by: the colour, the glyph shape (`git-pull-request` vs `-draft` vs `git-merge` vs `-closed`), the tooltip and the `aria-label`. Within a `button` (chip), the button `aria-label` includes the state word.
- Default `glyph` is `true`. It replaces the state dot column in the PR list, so the key cell is `[glyph]#142`. `glyph={false}` is allowed only in running prose where the surrounding sentence names the state.
- **Used by (every site that renders a PR key today, from `git grep`):**

  | site | file | change |
  |---|---|---|
  | PR list row | `src/github/PullsSurface.tsx` (`PullRow`) | delete the `StatusDot` column and `#number`; use `PrKey` |
  | PR inspector header | `src/github/PullPanel.tsx` | `PrKey` + title (§4.5) |
  | PR reference chip | `src/refs/references.tsx` (`PullReferenceChip`) | `#short` span becomes `PrKey glyph={false}` plus faint repo; the chip `aria-label` gains the state; the link target and hover stay |
  | Issue table PR column | `src/issues/IssuesSurface.tsx` (`issue.primaryPr`) | `#N` text + `PrStateBadge xs` become `PrKey` (the word is in the tooltip; the 6.5rem column keeps the glyph so state does not depend on colour) |
  | Issue page PR block | `src/issues/PullRequestsBlock.tsx` (`LinkRow`) | `ReferenceChip` + `PrStateBadge` stay (room for the word); the chip uses `PrKey` through the reference chip |
  | PR events | `src/issues/PullRequestsBlock.tsx` (`LinkEvents`) | `repo#N` text becomes `PrKey glyph={false}` when the state is in the payload, plain text otherwise |
  | Activity feed | `src/surfaces/ActivitySurface.tsx`, `src/activity/github.ts` refs | through `ReferenceChip` |
  | Agent composer chips | `src/agent/RefChip.tsx`, `src/agent/queries.ts` (`detail: p.state`) | through `ReferenceChip` |
  | Project Timeline `pr` events | `src/project/timeline/EventRow.tsx` (New) | `PrKey` |
  | Project Workers trail | `src/project/workers/WorkerNode.tsx` (New) | `PrKey` |

**`PrStateChip`** — the small state chip, GitHub-style, for headers:

```ts
PrStateChip({ state, draft, stateSource?, size = "sm" }: { state: string | null; draft?: boolean | null; stateSource?: string | null; size?: "xs" | "sm" })
```
A `Badge` with the glyph (`Icon micro`) and the word, tone from `PR_STATES`. This is `PrStateBadge` with the new tone map and a glyph; `PrStateBadge` becomes an alias.

### 4.5 PR list columns and inspector header (item 4, continued)

**`LinkedRefs`** — Substrate refs for a PR, one cell, never wrapping:

- **File:** `src/ui/linked-refs.tsx` (New). Uses `src/ui/popover.tsx` and `ReferenceChip`.
  ```ts
  LinkedRefs({ refs, max = 1, onOpen }: { refs: string[]; max?: number; onOpen?: (ref: string) => void })
  ```
- Behaviour: renders the first `max` refs as compact chips and, when `refs.length > max`, a `Badge xs neutral` `+N` that is a `Popover` trigger (`aria-label="N more linked issues"`). The popover (`bg-raised shadow-float`, `max-h-72 overflow-y-auto thin-scrollbar`) lists every ref as `ReferenceChip showTitle` in full. The cell is `flex min-w-0 flex-nowrap overflow-hidden whitespace-nowrap`; the first chip truncates (`min-w-0 truncate`) before `+N` is pushed out. `+N` has `shrink-0`.
- Dedupe by resolved issue (the existing `IssueChips` logic: a locator and its flat ref are one row) moves into a shared hook `usePrLinkedRefs(pull)` in `src/github/pr.ts`, used by the list cell and the inspector.
- Zero refs: the cell renders an em dash in `text-ink-faint`, not an empty cell.

**PR list** (`src/github/PullsSurface.tsx`): columns become

| key | label | width | content |
|---|---|---|---|
| `pull` | Pull request | `minmax(0,1fr)` | `PrKey` then title (truncate); `title` tooltip keeps `head → base` |
| `linked` | Linked | `9.5rem` | `LinkedRefs max=1` |
| `author` | Author | `6.5rem` | unchanged |
| `diff` | Diff | `5.5rem` | unchanged |
| `checks` | Checks | `6.5rem` | unchanged |
| `review` | Review | `6rem` | unchanged |
| `comments` | Comments | `5rem` | unchanged |
| `updated` | Updated | `4.5rem` | unchanged |

The `state` column (`1.75rem`) is deleted; its content is the glyph inside `PrKey`. The row `RowAction` is copy (`owner/repo#N`). `IssueChips` is removed from the title cell, which fixes the overflow.

**PR inspector header** (`src/github/PullPanel.tsx`, `data-testid="pull-header"`), top to bottom:

1. Line 1: `PrKey` (glyph on) then the title, `text-base font-medium`, wraps; `GithubPill size="sm"` at the end (unchanged).
2. Line 2: `PrStateChip` (small, GitHub-style), then `head → base` (mono `text-xs`, `min-w-0 truncate`, `title` = full text), then the diff `+additions −deletions` (`text-diff-add`/`text-diff-del`, tabular) and `N files` (`text-ink-faint`).
3. Line 3: `AuthorInline` and `opened/updated <ago>` (`text-xs text-ink-faint`).

The first three `Fields` rows of "Overview" (Author, Branch, Change) are redundant with this header and are removed from `Overview`; Checks, Review, Mergeable and Updated stay. The `Linked Substrate issues` section moves directly under the header (before Overview) and keeps the full list (`ReferenceChip showTitle`); the Linked column in the list is the compact form of the same data.

### 4.6 Existing components with a stated role in this system

| component | file | role here |
|---|---|---|
| `Row` | `src/ui/primitives.tsx` | the one row; `actions` slot carries one `RowAction` |
| `IconButton` | `src/ui/primitives.tsx` | icon-only control, required label; `size` `sm` is 28px (`size-7`) |
| `Tip` | `src/ui/primitives.tsx` | every tooltip; `PrKey` uses native `title` plus `aria-label` in dense cells, `Tip` in headers |
| `StatusDot` | `src/ui/primitives.tsx` | stays for checks and worker liveness (always beside a word); leaves PR identity |
| `Badge` | `src/ui/badge.tsx` | chips; gains `success` |
| `IssueKey`, `PriorityGlyph` | `src/issues/meta.tsx` | issue key (mono) and priority; unchanged |
| `EmptyState`, `LoadingState`, `ErrorState`, `SourceBadge` | `src/ui/primitives.tsx` | unchanged; used by every Project surface |
| `Fields`, `InspectorSection` | `src/ui/drawer.tsx` | drawer body; `Fields` is the Factory field list base |
| `Popover`, `OptionsMenu`, `Tooltip` | `src/ui/{popover,menu,tooltip}.tsx` | Base UI re-exports |
| `VirtualList` | `src/ui/virtual-list.tsx` | long lists: issues, PRs, Workers tree |
| `GithubPill` | `src/ui/github-pill.tsx` | "Open on GitHub" in PR header; unchanged |

## 5. Project section (item 5)

ADR-002 §D9 names the components and puts them in `src/project/`; this section fixes what they look like. The route tree (§D2), read-only first and the Gantt exclusion are unchanged. All sections use `SurfaceToolbar` (title-less; the NavRail row names the surface), `EmptyState`/`LoadingState`/`ErrorState`, `SourceBadge`-style provenance, and the freshness label from `ProjectHealth`.

| surface | component (file) | anatomy | text carrier for status |
|---|---|---|---|
| Overview `/project` | `ProjectShell` (`src/project/ProjectShell.tsx`), `AttentionList`, `AttentionRow` (`src/project/overview/AttentionList.tsx`), `IntegrationState` (`src/project/IntegrationState.tsx`) | header: repository, binding `Badge`, freshness (`synced 2m ago`); a now/next block from `board/next`; then **ranked attention rows**. A row is `[reason chip] [subject] [refs] … [age] [→ section]`. Reasons in rank order: `Question`, `Blocked`, `Claim expiring`, `Follow-up due`, then awareness. The reason chip is a `Badge xs` with the word; `Blocked` uses `danger`, `Claim expiring` uses `neutral` plus the countdown. | chip word; countdown text |
| Timeline `/project/timeline` | `DayGroup`, `EventRow`, `NowMarker` (`src/project/timeline/`) | day heading (`bg-control`, mono caps `text-xs`), event rows `[time] [kind glyph + word] [label] [refs]`, a horizontal now marker (`border-danger` hairline plus the word `now`). Kinds: `window`, `pr`, `handover`, `incident`, `report`; the kind word is rendered (`text-xs text-ink-muted`). `pr` events render `PrKey`. A "next" window is `text-ink`, past rows `text-ink-muted`. **Agenda only, no lanes** (ADR-002 §D9). | kind word + time |
| Workers `/project/workers` | `WorkersTree`, `WorkerNode` (`src/project/workers/`) | the tree in §6. Grouping and the include-archived control from XTRM-819 stay as toolbar controls (`ToolbarFilter`, `ToolbarButton`). | state word per node |
| Follow-ups `/project/followups` | `FollowUpRow` (`src/project/followups/FollowUpRow.tsx`) | `[priority glyph] [title] [status chip] [owner] [when] [typed refs]`, grouped by status as `DayGroup`-style headings. Refs resolve through `useIssueIndex`; an unresolved ref is plain text (existing rule). | status chip word |
| Jira `/project/jira` | `JiraRow`, `JiraChip` (`src/project/jira/`) | `JiraChip` = `Badge`-sized mono key + status word + external glyph; `JiraRow` = key, summary, status, assignee, sync state. The same chip appears in the Inspector header of an issue and in issue rows when a binding exists. A `syncState` other than `ok` is a word (`stale`, `unbound`), never colour alone. | key + status word |

All Project rows are `Row density="list"` with one `RowAction` at most. No card wraps a list.

## 6. Workers tree (item 5, Workers) — data source per field

**Form: a tree, not a free graph.** Lead → worker → specialist activation form a strict parent chain (`reportsTo` / `@agent_parent_session`), so a tree with the NavRail rail (one hairline, label column aligned) is the right form and stays keyboard navigable and virtualisable. Issue and PR are the leaves of each chain; they render as the node's **trail** (`XTRM-853 [In progress] → #431 [Open]`) in columns, not as extra tree levels, because an issue has many activations and a PR many issues and a tree level per entity would duplicate rows. The design page also draws the data lineage as an SVG so the joins are explicit.

**Node anatomy** (`WorkerNode`, one `Row density="list"`): `[disclosure] [kind glyph] [name] [role word chip] | [state word] | [issue key + status chip] | [PrKey] | [ctx %] | [claim / age]`. Glyphs use existing registry icons: panes `agent`, activations `specialists`; the **role word** (`lead`, `worker`, `activation`) and the state word are always rendered.

**Sources.** Three real sources exist. No field is invented.

- **S1 — Status board `workers/*`** (typed `Worker` record, ADR-002 §3): `{ name, kind, where, runtime, issue, task, status, milestone, milestoneAt, ctxPct, claimUntil, reportsTo, note }`. Adapter: `statusBoard` (XTRM-813). Read-mostly, synced on the 5-minute timer.
- **S2 — Core topology projection `xtrm.topology.projection.v1`** (`~/dev/core`, `packages/contracts/schemas/xtrm.topology.projection.v1.json`; served by `xt host` at `GET /v1/topology` and `GET /v1/topology/events`, `docs/xt-topology.md`). Per tmux pane: `pane_id`, `session_id`, `session_name`, `window_name`, `current_command`, `current_path`, `agent` (`state`, `role`, `task`, `bead_id`, `worktree`, `branch`, `parent_session_id`, `parent_pane_id`, `instance_id`), `agent_session` (`session_id`, `provider`, `state`), `jobs[]` (`job_id`, `specialist`, `status`, `bead_id`, `epic_id`, `chain_id`, `is_chain_root`, `branch`, `worktree_path`, `started_at_ms`, `owning_pane_id`, `pull_request`), `bead` (`id`, `status`, `title`, `issue_type`, `priority`, `parent_id`), `worktree` (`path`, `branch`, `head_sha`, `shared_by_pane_ids`), `pull_request` (`number`, `state`, `url`, `title`, `head_branch`, `base_branch`, `is_draft`, `merged_at`, `checks_state`). A `sources[]` ledger (`xtmux`, `tmux`, `specialists`, `substrate`, `beads`, `git`, `github` with `ok|unavailable|error`) says which part degraded. The `agent.*` fields are the tmux `@agent_*` options the launcher writes. `docs/xt-pi-role.md` ("Pane options set at launch") documents `@agent_task`, `@agent_parent_session`, `@agent_state`, `@agent_worktree`, `@agent_branch`, `@agent_bead` and `@agent_role`; the schema also carries `parent_pane_id` and `instance_id` (`@agent_parent_pane`, `@agent_instance_id`), which the projection reads from tmux (`cli/src/core/topology-projection.ts`) but that document does not describe. `bead` is the v1 name of the Substrate issue.
- **S3 — Substrate** (existing adapter, `src/adapters/substrate`): issue `status`/readiness, claim (`holder`, expiry), `primaryPr` from provenance links.

| node / column | field | source | note |
|---|---|---|---|
| lead (root) | name | S1 `workers/*.name` where `reportsTo` is empty, or S2 `pane.session_name` for the pane with no `agent.parent_session_id` match | tree root; role word `lead` from S2 `agent.role` (`@agent_role`) or S1 `kind` |
| worker (child) | parent edge | S2 `agent.parent_session_id` / `agent.parent_pane_id` (`@agent_parent_session`, `@agent_parent_pane`); S1 `reportsTo` | S2 is live; S1 is the fallback when the pane is gone |
| worker | name | S2 `pane.session_name`; S1 `name` | |
| worker | role word | S2 `agent.role`; S1 `kind` | `@agent_role`: set on role launches only; a bare session has none and renders as `session` |
| worker | state word | S2 `agent.state` (`@agent_state`: runtime lifecycle, `idle`/`working`); S1 `status` | **never read as done-ness** (`xt topology` guarantee); completion comes only from the issue status, `pull_request.merged_at`/`state`, or `job.status` |
| worker | runtime | S1 `runtime`; S2 `agent_session.provider`, `pane.current_command` | |
| worker | context | S1 `ctxPct` | S2 has no context field; UNKNOWN when S1 has no row |
| worker | claim | S3 claim expiry; S1 `claimUntil` | S3 wins when both exist; emphasised within 2h (XTRM-819) |
| worker | branch / worktree | S2 `agent.branch`, `agent.worktree` (`@agent_branch`, `@agent_worktree`) | shown in the row tooltip, not as a column |
| specialist activation (child of worker) | name | S2 `pane.jobs[].specialist` | |
| activation | state | S2 `jobs[].status` | |
| activation | age | S2 `jobs[].started_at_ms` | |
| activation | issue | S2 `jobs[].bead_id` | |
| activation | chain | S2 `jobs[].chain_id`, `is_chain_root` | groups the activations of one chain under their owning pane (`owning_pane_id`) |
| issue (trail) | key, title | S2 `agent.bead_id` (`@agent_bead`) / `bead.id`, `bead.title`; S1 `issue` | joined to S3 through `useIssueIndex` |
| issue (trail) | status chip | S3 `issueStatus()` (same function as the issue table); S2 `bead.status` as fallback | |
| PR (trail) | number, state, draft | S2 `pane.pull_request` (`number`, `state`, `is_draft`, `merged_at`) matched by branch; S3 `primaryPr` | rendered by `PrKey` |
| PR (trail) | checks | S2 `pull_request.checks_state` | optional word in the tooltip |

**Unverified joins and gaps (recorded, not assumed):**

1. **Name join between S1 and S2.** Substrate claim `holder` (`SUBSTRATE_HOLDER`) and the launcher's `XTRM_AGENT_NAME` are different strings in this session, so `holder` does not match a pane name. The join between a board `workers/*` row and a pane is therefore by issue (`worker.issue` = `agent.bead_id`) first and by name second. XTRM-819 must verify the join on live data before relying on name.
2. **Native specialist activations are not in S2.** `jobs[]` comes from `sp ps --json` (the legacy supervisor jobs). Activations created through the native `specialist_dispatch` tools are Substrate activation records; the topology projection does not read them, and the app adapter does not expose them (`git grep activation src/adapters` finds only journal `activationId` fields). Until a typed read exists, the "activation" level shows `jobs[]` only. Follow-up candidate: an `activations` read on the Substrate adapter (issue, role, status, started) so the tree shows native activations; scope outside XTRM-853.
3. **S2 is not consumed by the app yet** (`git grep topology -- src server` is empty). The agent host serves it; the Project adapter composition (ADR-002 §D3) needs a `topology` source or the status board must carry the same fields. Follow-up candidate, owner: XTRM-819 or a new adapter issue.
4. `kind` values of `workers/*` are not enumerated in the ADR; unknown kinds render neutrally (ADR-002 §3 mapping rule).

## 7. Specialists Factory direction (item 6)

**Problem:** XTRM-454..459 describe six surfaces (adapter, catalog + effective view, global override builder, repo-local custom specialists, skills and rules, diagnostics + activation preview). Delivered as six panels they compete with the Inspector Drawer and with each other.

**Direction: one list, one drawer, three sections.** The Factory is a regular list surface under `System → Specialists`; everything about one specialist is the Inspector Drawer content for `inspect({ kind: "specialist", ref: name })`. The Drawer already owns back/forward, pin, maximize, follow, copy reference and Esc (`InspectorDrawer`); the Factory adds no drawer of its own (XTRM-455 SUCCESS: "the Inspector Drawer is used for inspection rather than a competing drawer").

1. **Catalog (list):** `Row`s: `[name] [category chip] [source layer chip] [dispatch chip] … [model] [RowAction copy]`. Toolbar: `ToolbarTabs` (category), `ListFilter`. The dispatch chip is a word (`Dispatchable`, `Blocked`, `Unavailable`) with the reason as a tooltip; it reuses `specialist_list` verdicts through the XTRM-454 adapter.
2. **Drawer header:** name, `LayerChip` of the winning layer, a `Customize` `ToolbarButton` menu (`Override in this repo`, `Fork as new specialist`), `Copy context for agent` as an `IconButton` (XTRM-459). Writes need the capabilities endpoint of XTRM-454; without it the menu is absent, not disabled.
3. **Section "Effective"** (XTRM-455, 456): `Fields` grouped in schema order. Each field row: label, effective value, **`LayerChip`** (`default`, `user`, `repo`, `locked`), and an inline explanation on focus. Inherited values are `text-ink-muted`; overridden values are `text-ink` with the inherited value beneath it. A locked field shows a lock glyph and the word `locked` plus the layer where it can change; it has no edit control. Editing is a per-field `Popover` (`FieldEditor`): the schema-aware control, the units, the inherited value, `Reset to inherit`, and the **CLI-equivalent preview** line before `Save`. Long values (system prompt) are a collapsible `ContentPanel` with a copy action.
4. **Section "Skills and rules"** (XTRM-458): resolved skills (pack, path, pinned SHA, an `ambiguous`/`fallback` word chip when applicable) and the mandatory-rules pipeline, each contribution with its `LayerChip`; full text is a collapsible `ContentPanel`. Drift uses the existing status vocabulary through `Badge`.
5. **Section "Diagnostics and launch preview"** (XTRM-459): findings first, as banners (the existing banner pattern, `border-l-2` plus word); then the activation preview as `Fields` with a `LayerChip` per value and the word `unavailable` where a value cannot be resolved.
6. **Fork / override dialog** (XTRM-457): one `Dialog` (`src/ui/dialog.tsx`) showing the delta against the base before save, with warned fields marked by a word.

**`LayerChip`** (New, `src/ui/layer-chip.tsx`): `LayerChip({ layer }: { layer: "default" | "user" | "repo" | "locked" })`; a `Badge xs`; `default` = `muted`, `user` = `neutral`, `repo` = `accent`, `locked` = `neutral` with the `lock` glyph and dashed `border-border-strong`. The word is always rendered.

Mapping to the existing issues (no issue is dropped; the surfaces merge):

| issue | lands as |
|---|---|
| XTRM-454 adapter and bridge | unchanged; provides the list, effective config, provenance, skills, rules, diagnostics, capabilities |
| XTRM-455 catalog + effective view | Catalog list + drawer section "Effective" (read) |
| XTRM-456 global override builder | per-field `FieldEditor` popover inside "Effective" |
| XTRM-457 repo-local custom | `Customize` menu + fork/override dialog |
| XTRM-458 skills and rules | drawer section "Skills and rules" |
| XTRM-459 diagnostics, preview, copy | drawer section "Diagnostics and launch preview" + header `Copy context` |

The amendments to those contracts belong to the lead; they are listed in §10 as follow-up candidates, not edited here.

## 8. Surface-by-component map

| component | Issues | PRs | PR drawer | Project | Factory | Sidebar | Inspector |
|---|---|---|---|---|---|---|---|
| `NavRail`/`NavRailItem` | | | | | | ✓ | |
| `ToolbarButton`/`ToolbarFilter`/`ToolbarTabs`/`ListFilter` | ✓ | ✓ | | ✓ | ✓ | | ✓ (buttons) |
| `RowAction` | ✓ | ✓ | | ✓ | ✓ | | |
| `Icon` sizes `text`/`micro` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `PrKey`, `PrStateChip` | ✓ (PR col) | ✓ | ✓ | ✓ (timeline, workers) | | | ✓ |
| `LinkedRefs` | | ✓ | ✓ | | | | |
| `AttentionList`, `DayGroup`/`EventRow`/`NowMarker`, `WorkersTree`/`WorkerNode`, `FollowUpRow`, `JiraChip`/`JiraRow`, `ProjectShell`, `IntegrationState` | | | | ✓ | | | |
| `LayerChip`, `FieldEditor` | | | | | ✓ | | ✓ (specialist) |

## 9. Rulings requested from the lead

| id | question | default if no ruling |
|---|---|---|
| R1 | Darken `--x-success` (light) from `#1f8a4c` to `#1b7f46`? It is the `PrKey` open colour and the diff-add colour. 4.38:1 on white fails the 4.5:1 text minimum; `#1b7f46` is 5.04:1. One-line token change in `src/styles.css`; dark unchanged. | Apply (an accessibility fix inside the existing role, not a new colour). |
| R2 | PR state glyph inside `PrKey` (default on). The lead decision says "coloured by state with text in tooltip and aria-label"; the CONSTRAINTS say status is never colour alone. The glyph shape (`git-pull-request`, `-draft`, `git-merge`, `-closed`) is the non-colour carrier in a list that has lost its state dot. | Glyph on in lists, chips and headers; off only in running prose. |
| R3 | `merged` uses `text-accent-ink` (violet), which ADR-002 §D9 reserves for "selection, focus, references, attention". It matches GitHub and the existing `PrStateBadge` (`merged → accent`). | Keep violet for merged; the glyph (`git-merge`) separates it from a reference chip. |
| R4 | `ListFilter` shortcut `/` (Linear convention) and the `filter` icon (`ListFilter`) instead of the magnifier. | Adopt both. |
| R5 | Selected toolbar tab = ink text + 2px ink bottom bar (no fill). | Adopt. |

## 10. Implementation slices and follow-up issue candidates

These are candidates for the lead; XTRM-853 creates none.

1. **UI-1 tokens and primitives** — `icon.tsx` (`text`, `micro`, `filter`, `lock`, PR glyph names), `badge.tsx` (`success`), `styles.css` (R1), `row-action.tsx`, `toolbar.tsx`, `primitives.tsx` (delete `TOOLBAR_REST`). Tests: `badge`, `icon` sizes, `ListFilter` keyboard test.
2. **UI-2 NavRail** — `sidebar.tsx`, `ContextSidebar.tsx`; tests `sidebar.test.tsx`, `shell.test.tsx`. Blocks the Project rows of XTRM-817.
3. **UI-3 PR identity** — `pr-key.tsx`, `PullsSurface.tsx`, `PullPanel.tsx`, `references.tsx`, `IssuesSurface.tsx` PR column, `PullRequestsBlock.tsx`; `LinkedRefs`; tests `pulls.test.tsx`, `surfaces.test.tsx`, `pr-state.test.tsx`, `PullRequestsBlock.test.tsx`.
4. **UI-4 issue rows and toolbars** — `IssuesSurface.tsx` (status chip after key, one copy action, ghost toolbar), the other eight `SurfaceToolbar` consumers listed in §4.2.
5. **Amend XTRM-817..820** to reference this spec: use NavRail rows, `AttentionList` rank chips, `DayGroup`, `WorkersTree`, `JiraChip`; XTRM-819 gains `WorkersTree` and the topology source.
6. **Amend XTRM-455..459** to the one-list-one-drawer shape (§7).
7. **Follow-up candidates:** (a) Substrate adapter `activations` read (native activations in the Workers tree); (b) `topology` adapter over `GET /v1/topology` for the Project composition; (c) screenshots light and dark per slice (ADR-002 §9).

## 11. Validation of this document

- Each token and component above names its file, props or definition, and consuming surfaces (§3, §4, §5, §7, §8).
- The Workers tree names its data source per field (§6) and lists the joins it could not verify.
- No credential value, host path with a secret, or key appears in this document or in the design page.
- The design page renders items 1–6 in both Console themes. Contrast figures in §3 and §4.4 were computed from the token values in `src/styles.css`.
