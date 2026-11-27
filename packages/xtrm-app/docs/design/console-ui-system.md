# Console UI system — the as-built design language

Issue: XTRM-940 (epic XTRM-933). Status: **authority**. This document describes the console as the
tree implements it; it is written after the convergence pass, not before it.

Binding authority above this file: ADR-002 §D9 (visual contract) and §12 (rulings of 2026-11-17).
This file is the component-and-geometry authority below that ADR. Where an ADR clause and this file
disagree, the ADR wins and this file has a defect.

Companion artifacts:

- `docs/design/mocks/console-ui-system.html` — the static page of the XTRM-853 **proposal**. It
  predates the convergence pass and is kept as history; it is not authority and its screens are not
  a description of the shipped tree. See §16 for the dated supersession note.
- `docs/ui-component-reference-registry.md` — the index of **external** UI sources and their
  dispositions (ADR-001 Decision 6). It is not the index of the console's own components; this file
  is.
- `docs/screenshots/` — the maintained per-surface evidence sets, regenerated on purpose by the e2e
  specs that own them (`ui-scale/README.md` is the worked example). Screenshots illustrate; they do
  not define.

Paths are relative to `packages/xtrm-app/`.

## 0. How to read this document

1. **Every rule names its implementation.** A rule cites a file and the export, class string or
   constant that carries it. A rule with no implementation is a follow-up (§15), not a rule.
2. **Every rule names its enforcement.** `enforced by` is a test path, or the words *review only*
   when no test can see the property. *Review only* is a real status, not a promise; §15 lists them
   together because that list is the document's debt.
3. **Citations name a selector or a behaviour, never a line number.** A line number is true at one
   tree and silent about which tree (XTRM-940 journal, 2026-11-21). Where a number is unavoidable it
   is labelled with the tree it was measured at.
4. **Restraint rulings are kept verbatim** (§2.3, operator 2026-11-18). A later ruling that changes
   one is written as a dated supersession beside it, never by editing the ruling away.
5. **A claim and its source are two claims.** Where a rule was derived from a site and the site does
   not conform, the text says which one moved.

Legend for the tables: **token** is the CSS variable in `src/styles.css`; **utility** is the only
sanctioned way a component reads it; **role** is what the surface may use it for.

## 1. What converged, and what this file replaces

The XTRM-933 epic measured nine divergence families in the tree (five section-header idioms, five
selected-state idioms, five label/value grids, five row heights, 54 off-scale micro text literals,
18/20 oversized `IconButton` glyphs, 38 rounded border cards, a px indent literal, two utilities for
one concept). Each family has a replacement below, and the replacement is what the code calls today.

This file supersedes the following sections of the 2026-11-18 XTRM-853 proposal, which described
intended components rather than shipped ones. The numbers in this table are the **proposal's**
numbers, not this file's:

| proposal section | status |
|---|---|
| §1 evidence and registry search | superseded; the dispositions live in `docs/ui-component-reference-registry.md` |
| §3.2 "tokens this system adds" | superseded; the additions shipped and are token set entries now (§3) |
| §4.2 toolbar as a proposal | superseded; §5 is the shipped shape |
| §4.3 row anatomy proposal | superseded; §4 is the shipped anatomy |
| §4.4 PR identity proposal | superseded; shipped as `src/ui/pr-key.tsx` (§10) |
| §4.5 PR list columns proposal | superseded; `src/github/PullsSurface.tsx` `COLUMNS` is the shape |
| §5 Project surfaces proposal | superseded; those surfaces compose the components in §4–§13, and their routes and data sources are the ADR's |
| §6 Workers tree data sources | superseded; the shipped source is the Substrate dispatch graph, not the topology projection |
| §7 Specialists Factory direction | not built; no console surface implements it. Out of scope here. |
| §8 surface-by-component map | replaced by §14 |
| §9 rulings requested R1–R5 | all five were adopted; recorded as resolved in §2.4 |
| §10 implementation slices | all landed; the migration table (§17) is the record |
| §11 validation | replaced by §16 |

### 1.1 Citation map for source comments written before this revision

Twelve shipped files cite the **proposal's** section numbers (`§3.2` ×3, `§4.4` ×1, `§5` ×4, `§6` ×5).
Those numbers are not this file's; a reader following one lands here:

| a comment saying | was under the proposal | is now |
|---|---|---|
| `console-ui-system.md §3.2` | the unit rule and the token additions | §3.3 (unit rule); §3.2 (radii, shadows); §3.4 (glyph ladder) |
| `console-ui-system.md §4.4` | PR identity | §10 |
| `console-ui-system §5` | the Project surfaces | the component rules in §4–§13; routes and data sources are ADR-002's |
| `console-ui-system §6` | the Workers tree and its data sources | §4 row anatomy plus `src/project/workers/{model,WorkerRow,WorkersTree}.tsx`; the data source is the Substrate dispatch graph |

Re-anchoring those comments is a code change and therefore a follow-up (§15.2 item 12). Until it
lands, this table is the compatibility layer and it is authoritative for resolution.

Two proposal claims were **withdrawn** by their own proposer and must not be revived:

- **`titleClassName` on `SectionHeader`** (journal 2026-11-21, seq 10). A page-restylable level
  makes "every heading is faint" false by construction.
- **A Gantt-style timeline lane chart** (ADR-002 §D9). The timeline is an agenda.

## 2. Principles

### 2.1 The six principles every component follows

1. **One component per concept.** One section header, one row, one label/value grid, one card, one
   dialog frame, one drawer frame, one toolbar control, one filter. A surface composes them; it does
   not re-draw them.
2. **Chrome is quiet.** A control is a ghost control (no resting fill) unless it holds a value the
   operator typed or chose. Fill is the selection and the focus state, not the resting state.
3. **Hairlines, not boxes.** Hierarchy is one 1px hairline (`--x-border-muted`, or
   `--x-border-subtle` under a table header) plus the 2px accent marker on an active rail item. No
   card around a list (§11).
4. **Accent is for selection, focus, references, attention.** A PR state is a state, not accent.
5. **Status is a word plus a shape; colour is never the only carrier.**
6. **Light and dark are the same layout.** Only token values change.

### 2.2 Title versus row label

Two things look alike because they share a type step and differ because of what sits beside them:

- a name standing alone above content is a **title**: `text-sm font-medium text-ink`;
- a name with a value on the same line is a **row label**: inherits the row's type, no `font-medium`.

Test: does anything render to its right on that line? Right → label. Nothing to its right, content
below → title. Derived from, and first applied to, the Research chart title (XTRM-940 journal seq
13, XTRM-955).

The card-versus-heading half of the same ruling: identity for a *thing* (an issue, a PR, a session,
a chart) is a **card title** — `text-base font-medium text-ink` via `DetailTitle`
(`src/shell/detail-title.tsx`) in a drawer, `text-sm font-medium text-ink` inside a content block.
`SectionHeader` names a *region of a page*, never a thing.

### 2.3 Restraint (operator, 2026-11-18; kept verbatim)

> "ok-ish, we will see; tokens are quick to change" — the app must not become too colourful and must
> not fill the viewport with pills. These five rules bind every implementation slice and every later
> surface. A slice that needs an exception asks the lead before it builds.

1. **At most one coloured element per row.** In a row that carries both a PR key and a status, one of
   them is coloured and the other is plain. The status chip keeps its tone; the `PrKey` then renders
   with `quiet` (`text-ink-muted`; the state stays in the glyph, tooltip and `aria-label`). In a row
   with no status chip (the PR list) the `PrKey` is the coloured element.
2. **Chips only for state, never for metadata.** Counts, branches, refs, roles, layers, categories,
   sources, bindings and sync labels are plain text, or mono for keys and paths. A chip names a
   state: an issue status, a PR state, a dispatch verdict, a finding.
3. **No chip backgrounds in toolbars or headers.** Toolbar and drawer-header controls are ghost
   controls (§5). The one state indicator allowed in a header is the PR state chip in the PR
   inspector header; the `PrKey` on that line is then plain ink (rule 1).
4. **Colour only through the existing tokens** (§3). No new colour, no new tint level; the derived
   `success` badge tone and the `color-mix` tints already in `badge.tsx` are the only derived fills.
5. **A surface may not add a pill row.** A set of more than one tag-like value becomes a count plus a
   popover (`LinkedRefs`), never a second line of chips.

Enforcement: rules 1 and 3 are asserted per surface (`src/github/pulls.test.tsx` "the key is the one
coloured element in the list", "the header control is a ghost, not a filled pill");
`src/issues/PullRequestsBlock.test.tsx` asserts the quiet key; `src/project/jira/JiraSurface.test.tsx`
asserts the key is ink, not a second accent link. Rules 2, 4 and 5 are **review only**.

**Known exceptions to rule 2, measured 2026-11-23 (six sites)** — recorded rather than quietly tolerated:
`Badge` is used for non-state metadata at `src/github/GithubIssuePanel.tsx` (`Labels`), 
`src/github/IssuesSurface.tsx` (label chips), `src/github/ReleasesSurface.tsx` (`release.tag`),
`src/surfaces/research-semantic.tsx` (`primitiveName(type)`), `src/surfaces/ActivitySurface.tsx`
(`SourceChip`, the source name) and `src/github/identity.tsx` (`app`). Each reads as a chip in a place
rule 2 calls plain text. (`src/github/PullConversation.tsx` also renders a `Badge xs`, but it carries
`reviewLabel(it.state)` — a state, so it conforms.) §15 lists the follow-up.

### 2.4 Rulings resolved (2026-11-18 → shipped)

| id | ruling | where it lives now |
|---|---|---|
| R1 | darken light `--x-success` to `#1b7f46` for 4.5:1 | `src/styles.css` `--x-success`; `--x-diff-add` follows it |
| R2 | PR state glyph on inside `PrKey`; off only in prose | `src/ui/pr-key.tsx` `PrKey` `glyph` default `true` |
| R3 | `merged` keeps accent ink, separated by the `git-merge` glyph | `src/ui/pr-key.tsx` `PR_STATES.merged` |
| R4 | local filter uses `/` and the `filter` icon | `src/ui/toolbar.tsx` `ListFilter`; `src/ui/icon.tsx` `filter` |
| R5 | selected toolbar tab = ink text + 2px ink bar, no fill | `src/ui/toolbar.tsx` `ToolbarTabs` |

## 3. Tokens

Source: `src/styles.css` (`:root`, `:root[data-theme="dark"]`, `@theme inline`). Components read a
token **only** as a Tailwind utility. Enforcement: `src/ui/units.test.ts` refuses px font sizes,
off-scale rem text and unitless spacing values across `src/`; contrast figures are **review only**
(no test computes them).

### 3.1 Surface ladder and colour

The ladder is `deep → sidebar → surface → raised → control`. Depth comes from a background shift,
never from a shadow except on a floating layer.

| token | utility | light | dark | role |
|---|---|---|---|---|
| `--x-deep` | `bg-deep` | `#f4f4f5` | `#0d0d0d` | app background; content wells; `ContentPanel` fill at 60% |
| `--x-sidebar` | `bg-sidebar` | `#f4f4f5` | `#232323` | the contextual sidebar plane; a closed inspector pane |
| `--x-surface` | `bg-surface` | `#ffffff` | `#151515` | list plane, sticky section header, editor surface |
| `--x-raised` | `bg-raised` | `#ffffff` | `#1e1e1e` | popovers, tooltips, dialog, drawer body |
| `--x-control` | `bg-control` | `#efeff1` | `#262626` | input fill, day-caption bar, inline code |
| `--x-hover` | `bg-hover` | ink 4.5% | white 3% | hover fill, focus fill, **selected row** |
| `--x-pressed` | `bg-pressed` | ink 8% | white 6% | pressed state, neutral chip fill, segmented track, a selected top-level sidebar row |
| `--x-ink` | `text-ink` | `#18181b` | `#ececef` | body text, values, titles |
| `--x-ink-muted` | `text-ink-muted` | `#5f5f68` | `#a0a0a8` | secondary text, ghost control label, quiet PR key |
| `--x-ink-faint` | `text-ink-faint` | `#94949c` | `#6a6a72` | **every section heading**, meta, counts, em dashes |
| `--x-border-muted` | `border-border-muted` | ink 7% | white 8% | the default hairline: section rules, rails, dividers |
| `--x-border-subtle` | `border-border-subtle` | ink 4% | white 6% | the quieter hairline: the rule under a table header, a list item's own separator, a comparison-table row, a secondary pane edge |
| `--x-border` | `border-border` | ink 11% | white 12% | input borders, form controls |
| `--x-border-strong` | `border-border-strong` | ink 20% | white 18% | focus border, resize handle, dashed provenance |
| `--x-accent` | `bg-accent`, `ring-accent` | `#4f46e5` | `#818cf8` | selection marker, focus ring, attention dot |
| `--x-accent-ink` | `text-accent-ink` | `#4338ca` | `#a5b4fc` | references, links, merged |
| `--x-accent-soft` | `bg-accent-soft` | accent 10% | accent 12% | `accent`/`active` chip fill; selection wash |
| `--x-danger` | `text-danger` | `#c42b2b` | `#f07171` | blocked, error, now marker, the danger chip fill at 12% |
| `--x-success` | `text-success` | `#1b7f46` | `#5ccb8a` | done, open PR |
| `--x-success-ink` | `text-success-ink` | `#146839` | `#5ccb8a` | the success chip's own ink on its 12% tint |
| `--x-diff-add` / `--x-diff-del` | `text-diff-add` / `text-diff-del` | `#1b7f46` / `#c42b2b` | `#5ccb8a` / `#f07171` | diff counts |
| `--x-github` / `-hover` / `-ink` | `bg-github` / `-hover`, `text-github-ink` | `#24292f` / `#32383f` / `#fff` | `#f0f6fc` / `#fff` / `#24292f` | GitHub's own primary-button pair, `GithubPill` only |
| `--x-strip-*` | `bg-strip`, `text-strip-ink`, … | see file | see file | the sidebar's persistent source strip and its drop-up |

`--x-ink-faint` is faint on purpose: it is the ink of a *heading*, and headings are quieter than the
content they introduce. A worker who "fixes" a faint heading by darkening it reintroduces drift. It
is also why a deferred sidebar destination cannot use it (2.74:1 on the light sidebar, below the
4.5:1 minimum at 13px): deferred is `data-deferred` on a full-ink row.

### 3.2 Radii and shadows

| token | utility | value | role |
|---|---|---|---|
| — (Tailwind default) | `rounded` | 4px | chips (`Badge`), tiny marks |
| `--radius-sm` | `rounded-sm` | 6px | `Kbd`, `SourceBadge`, `JiraChip`, the toolbar layout switch |
| `--radius-md` | `rounded-md` | 8px | **rows**, `Card`, toolbar controls, inputs, `IconButton`, drawer/dialog inner boxes |
| `--radius-lg` | `rounded-lg` | 10px | floating layers only: drawer frame, dialog, popover, menu |
| `100%` | `rounded-full` | — | dots, markers, the inspector collapse handle, glyph dots |
| `--x-shadow-float` | `shadow-float` | see file | every floating layer: popover, menu, tooltip, dialog, sidebar strip |
| `--x-shadow-panel` | `shadow-panel` | see file | the inspector panel only, because it carries no border |

No surface names a `shadow-[…]` literal. Measured 2026-11-23: the last one outside `src/agent`
survives in `src/shell/GlobalSearch.tsx` (`shadow-[0_0_0_1px_var(--x-border-muted)]`, the search-scope
pill), and the Agent half carries three more (`src/agent/AgentSidebar.tsx`, `src/agent/Composer.tsx`,
`src/agent/NewSession.tsx`); their removal belongs with the segmented-control follow-up in §15.

### 3.3 Type ladder

Four steps. `body` takes `--text-sm`, so a token is the only way a size reaches text.

| token | utility | size / line-height | role |
|---|---|---|---|
| `--text-2xs` | `text-2xs` | 0.625rem / 0.875rem (10px at a 16px root) | the timeline `now` marker, a dense detail line, `Kbd`, `Badge xs` |
| `--text-xs` | `text-xs` | 0.72rem / 1rem (11.52px) | **every section heading**, meta cells, counts, chips, toolbar labels, keys |
| `--text-sm` | `text-sm` | 0.8125rem / 1.25rem (13px) | body copy, row titles, field values, row labels |
| `--text-base` | `text-base` | 0.875rem / 1.375rem (14px) | detail titles (`DetailTitle`), dialog titles |

Two display steps are used deliberately outside the ladder and are **review only**:
`text-xl` on the issue page title (`src/issues/IssueView.tsx` `InlineTitle` `variant="page"`) and
`text-2xl` on the GitHub device code (`src/github/auth.tsx`). Both are one-off documents, not UI
chrome.

`.xtrm-prose` (rendered markdown and the editor) owns its own scale in `src/styles.css`
(`h1` 1rem, `h2` 0.9rem, `h3/h4` 0.8125rem, `code`/`pre`/`table` 0.75rem) because it renders
third-party content. It is outside the type ladder by design; a component must not copy those values.

**Unit rule.** The scale is rem, so every size is applied as a rem utility. A px literal beside rem
text renders 1.33× too large at the operator's 12px root, which is the root they use. The gate's
`OFFSCALE_REM` (`scripts/units-gate.ts`) admits exactly eight rem text values — the four type tokens
plus 1.125/1.25/1.5/2rem display steps — and refuses every other literal. Enforcement:
`src/ui/units.test.ts`; the rendered measurement is `e2e/ui-scale.spec.ts` at a 16px and a 12px
root.

### 3.4 Glyph ladder

One table, one file: `src/ui/icon.tsx` `SIZE_CLASS`, with `ICON_REM`, `ICON_PX` and `ICON_CLASS`
derived from it so the ladder cannot drift into hand-kept copies.

| step | class | at a 16px root | stroke | use |
|---|---|---|---|---|
| `micro` | `size-[0.75rem]` | 12px | 2 | inside a chip, a `PrKey`, a `ToolbarFilter` chevron |
| `text` | `size-[0.8125rem]` | 13px | 2 | **a glyph in a row or a toolbar** — the same length as `--text-sm` |
| `xs` | `size-[0.875rem]` | 14px | 2.25 | the common mark outside a data row: a disclosure chevron, an external-link arrow, a sidebar or menu glyph |
| `sm` | `size-4` | 16px | 2.25 | a contextual mark: the Project repository glyph, the inspector rail, a banner's alert mark |
| `nav` | `size-4` | 16px | 2.25 | a top-level sidebar destination only (`SidebarRow`) |
| `md` | `size-[1.125rem]` | 18px | 2.25 | the `EmptyState` mark, a 36px `IconButton` |
| `lg` | `size-5` | 20px | 2.25 | reserved; no shipped call site |

`GithubMark` (`src/ui/github-mark.tsx`) has no size of its own: it renders `ICON_CLASS[size]`, so the
octocat is on this ladder (`GithubPill` passes `micro`/`xs`).

**The rule: a glyph never exceeds its row's text.** A row's text is `text-sm` (13px), so a row glyph
is `text`; a toolbar's text is `text-xs` and its control glyph is `text`. `IconButton` derives its
default from its own box (a `size-7` control takes `text`, a `size-9` control takes `md`), so a call
site must pass `iconSize` to say something different. Before XTRM-934 it defaulted to `sm`, and 18 of
20 call sites rendered a 16px glyph beside 11.5px text.

Enforcement: `src/ui/scale.test.tsx` (glyph ladder derives to finite rem; `ListFilter` and
`ToolbarButton` glyphs are the same step, 13px; `IconButton` default is `text` for `sm` and `md` for
`md`); `src/ui/icon.test.tsx` (per-step size and stroke); `e2e/ui-scale.spec.ts` measures at a 12px
root that the filter glyph is not larger than the toolbar text it sits beside. Which of `xs`, `sm`, `nav` and `md` a given call site picks is **review only**; the ladder values
and the `IconButton` defaults are enforced.

## 4. Row anatomy and the three densities

`Row` (`src/ui/primitives.tsx`) is the one collection row. Sidebar rows, list rows and table rows
share the anatomy and differ by density.

### 4.1 Anatomy

```
[disclosure 20px] [kind glyph] [priority glyph] [key] [status chip] [title …] [meta columns] [one row action]
```

- `gap-2.5` between slots; `min-w-0` on every truncating slot so a narrow row clips text, never
  geometry.
- The trailing `actions` wrapper (`Row` prop `actions`) reveals on hover **and** `focus-within`, and
  is `pointer-events-none` + `opacity-0` at rest so an invisible button cannot take the row's click.
  It carries stop-propagation, so a row action never activates the row.
- A table row's numeric cells are right-aligned and `tabular`; the trailing action track is a fixed
  width that the header mirrors with an empty cell, so the action never reflows the grid.

### 4.2 The three densities, with exact heights

| density | class string in `Row` | height | use |
|---|---|---|---|
| `sidebar` | `h-7 px-2 rounded-md` | 28px | a contextual-sidebar destination or list row (`NavRailItem`, sidebar pickers) |
| `list` | `h-8 px-3 rounded-md` | 32px | **the default**: Project rows, Activity rows, Follow-ups, Questions, Workers, Research lists |
| `table` | `h-full rounded-none` | the list's `rowHeight` | a virtualised table row: Issues, Pulls, GitHub issues (three rows). Four virtual lists pass `rowHeight={32}`; Repositories uses it with `list` density |

Two documented overrides, both at the call site with their reason, and one scoped exception that is not
a fourth density:

- `SidebarRow` (top-level destination) passes `h-[30px]`: 30px, because it carries a 16px `nav` glyph
  and a 13px semibold label (asserted by `src/ui/sidebar.test.tsx` "renders the 30px sidebar
  geometry").
- `src/surfaces/research-semantic.tsx` `Row density="list" className="h-auto items-start py-1.5"`:
  a definition block that wraps, so it grows. This is the one `list` row in `src/` outside `src/agent`
  that is not 32px.
- Transcript lines in the pi-viewer chat thread are 24px. This is a scoped exception, not a density:
  see §4.2.1 for the three lines it covers and why. No console row uses it.

**32px is the row height** for list and table density. A row that needs a second line keeps 32px and
puts the second line at `text-2xs` (the Questions row does exactly this;
`e2e/project-questions.spec.ts` measures both the 32px box and the 10px detail line).

Enforcement: `e2e/project-questions.spec.ts` (32px row, 10px detail line), `e2e/layout.spec.ts` (the
32px table header), `src/ui/section.test.tsx` (the list-inset header is the `h-8 px-3` row box).
`Row`'s own density classes are **review only** — no unit test renders each density.

#### 4.2.1 Transcript exception: 24px lines (operator ruling 2026-11-25, XTRM-1034)

**Surface bound:** the pi-viewer chat thread (`packages/pi-viewer`, the channel view). `packages/xtrm-app/src`
has no chat thread yet, so this section is **prospective** for the console: it binds nothing there until the
viewer joins the console, and no console test or review checks it.

In that thread, three lines are **24px** (`min-h-6`), not 28 or 32px: the tool-call line, the grouped
tool-call line and the turn-fold line ("Worked for 1m 12s").

Implementation, read at `a68830f0`: `packages/pi-viewer/src/components/ActivityDisclosure.tsx` carries the
tool-call line (`ActivityRow`, line 74, `flex min-h-6`), the grouped tool-call line (`GroupRow`, line 161,
`flex min-h-6`) and the turn-fold line (line 240, `flex min-h-6`). The working row is **not** in that file:
the running-agent line is rendered by presence above the composer, outside the thread
(`packages/pi-viewer/src/components/presence/PresenceLine.tsx`, 32px agent rows, 44px on narrow
screens), so the exception binds no working row today. If the thread renders a working row, it may be
`min-h-6` with its type from §3.3.

Reason: these lines are a log read in sequence. A reader scans them, never picks one from a list, so
they need no 28–32px pointer target, and a turn with 20 tool calls must fit on one screen. The ruling
follows `packages/pi-viewer/docs/design/t3code-chat-audit.md` §3.3 and §10 row 16. That audit is
**external to this document's gate** (§16): it is cited as the source of the ruling, it is not validated
here, and a change to it does not change this section.

Scope of the exception, and nothing wider:

- it applies to those three lines inside the chat thread only;
- **the exception is height-only.** It adds no type step: the type ladder (§3.3) and colour (§3.1) apply
  unchanged. The labels stay `text-sm` (20px line height fits the 24px box), the hover time stays
  `text-xs`, and `text-2xs` is already "a dense detail line" (§3.3). A 24px box does not shrink its text;
- every list, table and sidebar row keeps §4.2 (28px `sidebar`, 32px `list` and `table`);
- the row glyph still follows §3.4 (a glyph never exceeds its row text: the `text` step, 0.8125rem),
  so the 24px box holds a 0.8125rem glyph, not a 16px icon;
- text on these lines is `ink-muted`, never `ink-faint` (audit §1.6: `ink-faint` fails 4.5:1 as text).

### 4.3 Tree indentation

One step: `INDENT_REM` (`src/issues/issue-table.ts`, `1.25rem`), consumed as a `--row-indent`
custom property on the row. Two shipped consumptions of the same step:
`src/issues/IssuesSurface.tsx` gives its leading cluster
`width: calc(var(--row-indent) + 1.25rem)` **and** `paddingLeft: var(--row-indent)`, so the
disclosure keeps a fixed hit box while the key moves out with depth;
`src/project/workers/WorkerRow.tsx` keeps a fixed `size-5` disclosure box and puts only
`paddingLeft: var(--row-indent)` on the content cluster. Both read the one constant, so both follow
the root font size.

Enforcement: `src/ui/units.test.ts` refuses a px indent, a numeric multiplier and a unitless spacing
value in every spelling (physical and logical, class and style); `src/issues/IssueRows.test.tsx` pins
the mechanism (`var(--row-indent)`, no computed key column); `e2e/issue-rows.spec.ts` and
`e2e/activity-row-indent.spec.ts` measure the rendered indent at two root sizes.

### 4.4 Row action

`RowAction` (`src/ui/row-action.tsx`): a 20px (`size-5`) button with a `text` glyph, a required
label, and a tooltip. `onAct` may return `false` or reject; a success swaps to `check` for 1.2s and
announces `doneLabel` in a polite live region, a failure keeps the glyph and announces `failLabel`.
The confirmation is a claim about a completed write, so it is only made after the write resolves.

Enforcement: `src/ui/row-action.test.tsx` (reveal, non-clickable while invisible, 20px + text glyph,
done/fail announcements).

## 5. Toolbar

`SurfaceToolbar` (`src/ui/primitives.tsx`) is the one toolbar: `min-h-10` (40px), `px-1.5 py-1.5`,
`gap-x-1.5 gap-y-1.5`, wrapping. The surface below it owns its rule. Every surface that has controls
uses it (15 call sites); a surface with none renders `<SurfaceToolbar />` for the height.

Belt order, left to right: `[SourceBadge] [repository/context] [primary action] [tabs or filters]
[ListFilter] … [view switch] [options menu]`.

### 5.1 Controls

| component | file, export | geometry | behaviour |
|---|---|---|---|
| `TOOLBAR_CONTROL` | `src/ui/primitives.tsx` | `h-7` (28px) `px-1.5 text-xs gap-1 rounded-md` | the shared box |
| `TOOLBAR_GHOST` | `src/ui/primitives.tsx` | — | the **only resting style**: `text-ink-muted`, fill on hover/focus |
| `ToolbarButton` | `src/ui/toolbar.tsx` | the control box | `primary` = `text-ink font-medium` for the one action of a surface; glyph `text` |
| `ToolbarFilter` | `src/ui/toolbar.tsx` | the control box + `micro` chevron | the value lives in the label: `Status ▾` → `Status: open` with the value in ink; a `Clear` item reports `null` |
| `ToolbarTabs` | `src/ui/toolbar.tsx` | `h-7 px-1.5`, `count` in `tabular` faint | `role="tablist"`, selected = ink + 2px ink bar (`after:h-0.5`), no fill |
| `ListFilter` | `src/ui/toolbar.tsx` | 28px icon button → `w-48` (192px) | see §5.3 |
| `IconButton` | `src/ui/primitives.tsx` | `size-7` / `size-9` | required label + tooltip; `active` = `bg-hover text-ink` |

There is no resting fill on any of them; `TOOLBAR_REST` was deleted because its `bg-pressed` resting
fill is what made `Status ▾` and `New issue` read as chips.

### 5.2 The one filter-toggle idiom

Two selection shapes are sanctioned, and they are different concepts:

- **A tab switch** (mutually exclusive views of one list) → `ToolbarTabs`, selected = ink + 2px ink
  bar. Used by `src/github/PullsSurface.tsx` (`Open`/`Merged`/`Closed`), 
  `src/github/IssuesSurface.tsx`, `src/issues/IssueView.tsx`.
- **A filter/scope toggle** (a control that narrows what is shown) → `aria-pressed` + `font-medium
  text-ink` inside `TOOLBAR_CONTROL`, never a fill. Used by `src/surfaces/ActivitySurface.tsx`
  `Filters` and `src/project/workers/WorkersSurface.tsx` (`Tree`/`List`).

Enforcement: `src/ui/toolbar.test.tsx` ("marks the selected tab with ink text and a 2px ink bar, not
a fill", tablist keyboard); `src/surfaces/ActivitySurface.test.tsx` (`aria-pressed` + `font-medium`
on the active source, `false` on the other). The Workers view switch has no test — **review only**.

Four residual shapes are **not** sanctioned and are recorded so a worker does not copy them: an
`IconButton` `active` radio pair (`src/issues/IssuesSurface.tsx` layout switch); a segmented pill on
`bg-control` with a filled `bg-surface` thumb (`src/shell/GlobalSearch.tsx` scope,
`src/shell/ContextSidebar.tsx` `HalfSwitch`) and the Agent half's copies of it; and, inside one
sidebar, two fills for one state — a selected rail child paints `bg-hover` (`src/ui/nav-rail.tsx`),
while a selected top-level `SidebarRow` carries **both** `bg-hover` (emitted by `Row` for `selected`)
and `bg-pressed` (its own `className`, `src/ui/sidebar.tsx`), so which fill wins is decided by
stylesheet order — the same class-join hazard `Card` closed with a test. §15 lists the follow-ups.

### 5.3 `ListFilter` — the local list filter, distinct from Ctrl+K

Resting: a 28px `IconButton` with the `filter` icon (not the `search` magnifier, which belongs to
global search), label `Filter this list`, shortcut `/`. Focused (click, `/`, or keyboard focus): it
widens to 192px over 150ms (instant under `prefers-reduced-motion`), shows an input, `bg-hover` fill.
Escape clears and collapses; with a value it stays expanded after blur. The match count is announced
politely and renders `12` or `12 of 41` when the surface passes a total. It filters the rows already
loaded in that surface; it never navigates and never queries another surface.

Enforcement: `src/ui/toolbar.test.tsx` (resting size and `/`, widen and focus, Escape, stay-expanded,
count, `/` in all three open/closed/blurred states, `count of total`).

## 6. Sections

`src/ui/section.tsx` is the one section header, one titled section and one titled list. Five idioms
rendered this concept before, at four insets and three casings, so two stacked lists on one page
started their text at two different x positions.

### 6.1 `SectionHeader`

```ts
SectionHeader({ title, count?, aside?, inset = "list", level = 2, mono?, sticky?, wrap?, className? })
```

The heading is **always** `text-xs font-medium text-ink-faint` at every level; `mono` adds
`font-mono uppercase` (the timeline's day caption). `count` is `text-xs text-ink-faint tabular`;
`aside` sits at `ml-auto`. `sticky` adds `sticky top-0 z-10 bg-surface`.

| inset | box | role |
|---|---|---|
| `list` (default) | `h-8 px-3` — the `Row density="list"` box | a header above list rows: it starts where its rows start |
| `drawer` | `h-7`, **no** gutter | inside `Section`, which owns `px-5 py-4`; the header must not add a second gutter |
| `none` | no height, no gutter | inside a box that already has padding (a card, a lane, a dialog body) |

`wrap` turns the fixed box into `min-h-8 flex-wrap px-3 py-1`: a long aside falls to a second line and
the box grows, the gutter does not move.

### 6.2 `Section` and `ListSection`

- `Section({ title, count?, aside?, level = 3 })` — one hairline **above**
  (`border-t border-border-muted`, suppressed on `first:`), `px-5 py-4`, header at `inset="drawer"`.
  This is the drawer body's unit and a page's detail unit. `InspectorSection`
  (`src/ui/drawer.tsx`) is an alias, not a second implementation, so the 27 production call sites (28
  with the test usage in `ui/section.test.tsx`) keep one import.
- `ListSection({ title, count?, aside?, bordered = true })` — a hairline **below**
  (`border-b border-border-muted`), no padding of its own, header at `inset="list"`. For stacked
  lists on a page.
- `FieldLabel({ children, aside? })` (`src/ui/fields.tsx`) — `SectionHeader` at `inset="none"`,
  `level={3}`, in a `mb-1` wrapper. A form label and a drawer heading are the same step because they
  are the same component.

### 6.3 Outline ladder

`level` follows the **document outline**, not the styling:

| level | role | shipped example |
|---|---|---|
| 2 | a page section | `src/project/overview/OverviewSurface.tsx` "Now / next"; `src/surfaces/ResearchSurface.tsx` "Definition" |
| 3 | a group inside a section | `src/project/settings/IntegrationSurface.tsx`; `src/surfaces/research-charts.tsx` "Charts" |
| 4 | a leaf inside a group | `src/issues/IssueProvenance.tsx` group header; `src/issues/IssueView.tsx` lineage group |

**Depth 4 is terminal.** Anything below a level-4 heading is a **label**, rendered `<p>` or `<span>`,
never a heading — a `<h5>`/`<h6>` would be the only way to exceed the ladder and the primitive cannot
render one. The chart dataset label is the worked case (XTRM-940 journal seq 6).

Outlines are pinned as a **sequence of (level, text) per route**, not as a set of levels: a per-level
check passes when a group is flattened, and a "no level jump" check passes when a sibling is demoted
one level too deep. Enforcement: `src/app/research.test.tsx` ("Research page outlines") and
`e2e/research-outline.spec.ts`; the issue board lane heading is `e2e/issue-board.spec.ts` (an `H2` at
the section step). Every other surface's outline is **review only**.

## 7. Fields and the label-column ladder

`Fields` (`src/ui/drawer.tsx`) is the one label/value grid: a `<dl>` at
`grid gap-x-3 gap-y-1.5`, `gridTemplateColumns: "${labelWidth} 1fr"`, labels in `text-ink-faint`,
values in `text-ink`, `break-words`.

```ts
Fields({ rows, labelWidth = DRAWER_LABEL_COLUMN, size = "sm" })
```

| constant | step | fits | use |
|---|---|---|---|
| `DENSE_LABEL_COLUMN` | 3.5rem | labels ≤ 31px | a row whose values are one short token: the timeline `at`/`kind` |
| `SIDEBAR_LABEL_COLUMN` | 4.5rem | ≤ 49px | agent sidebar session rows, an Activity argument list (content-sized, floors here) |
| `PART_LABEL_COLUMN` | 6.5rem | ≤ 82px | the issue body in the canvas, `IssueJournal` block keys |
| `DRAWER_LABEL_COLUMN` | 7.5rem | ≤ 105px | **the default**: drawer and inspector bodies |
| `PAGE_LABEL_COLUMN` | 10rem | values need room | page bodies; 10rem exists for the room a page has, not for a label |

Rules:

1. A column is a **step from this ladder**, never a literal. `labelWidth="10rem"` fails the gate.
2. The **gutter is not a knob**: the primitive hardcodes `gap-x-3`. The one exception is a dense
   in-row readout (`gap-x-2`) and it is written at its site with its reason.
3. The step is a **pair**: column **and** gutter. 10rem + `gap-x-3` puts a value at 172px; the same
   column with `gap-x-2` would put it at 168px. Two grids on one page 4px apart is the defect the
   ladder replaced.
4. A **content-sized** column is a different shape, not a different size: it takes its floor from this
   ladder and lets the track grow to the widest key (a journal block, a tool call's arguments).
5. A table's column template is **not** a label/value grid. `COLUMNS`-style tracks (Issues, Pulls,
   Jira, Follow-ups, comparison) are column grids and are outside this ladder.

The gate closes the **set** (no literal, no hand-rolled two-track grid) but cannot **size** a member:
`labelWidth={PAGE_LABEL_COLUMN}` passes. Sizing is a measurement with a date, owned by the reviewer
of the page being added, and `src/app/research.test.tsx` pins Research's declared steps.

Enforcement: `src/ui/section.test.tsx` ("Fields keeps one label column and names its value step"),
`src/ui/units.test.ts` rules `label-grid-class`, `label-grid-style-literal` and
`label-width-literal`; the rendered pitch is `e2e/research-label-column.spec.ts` (172px) and
`src/app/research.test.tsx` pins the declared `10rem`/`3.5rem`. `size` per call site is review only.

## 8. Badge

`src/ui/badge.tsx`: `inline-flex items-center justify-center gap-1 rounded font-medium
whitespace-nowrap tabular`, `shrink-0` by default.

| size | geometry | use |
|---|---|---|
| `xs` | `h-4 px-1 text-2xs` | **a status chip in a table, list or footer row** |
| `sm` | `h-[1.125rem] px-1.5 text-xs` | a default chip beside a title or a count |

| tone | fill and ink |
|---|---|
| `accent` | `bg-accent-soft text-accent-ink` |
| `active` | `bg-accent-soft text-ink` |
| `success` | `bg-success/12 text-success-ink` |
| `danger` | `bg-danger/12 text-danger` |
| `neutral` | `bg-pressed text-ink-muted` |
| `muted` | `bg-hover text-ink-faint` |
| `inverse` | the `--x-strip-*` pair, for the sidebar strip only |

Rules:

1. **A chip names a state** (§2.3 rule 2). Metadata is plain text, or mono for keys and paths.
2. **The word is the carrier**; the tone only reinforces it. A chip whose word is missing is a defect
   even when the colour is right.
3. **A chip does not compress by default.** `shrink-0` is emitted deliberately; a container that must
   win passes `shrink` (which swaps in `min-w-0 shrink`) and pairs it with `truncate`/`max-w-full`.
   `cx` is a plain join with no tailwind-merge, so a call site could not override the old class.

Enforcement: `src/ui/section.test.tsx` (`xs` is `text-2xs` `h-4`, `sm` is `text-xs`; no arbitrary rem
in either), `src/ui/badge.test.tsx` (success tone built like danger; `shrink-0` default and the
opt-in), `e2e/github-issue-labels.spec.ts` (a long label pair truncates inside its cell). Rule 1 is
**review only** — see the measured exceptions in §2.3.

## 9. Card — the one bordered container

`src/ui/card.tsx` `Card` / `CARD_FRAME`: `flex flex-col gap-2 rounded-md border border-border-muted
px-3 py-2.5`. `rounded-md` is the row radius, so a card is a row's radius around a stack of rows;
`px-3` is the list gutter, so a card's text starts on the same x as the rows above it; `py-2.5` is the
denser of the two rhythms the record lists were built around.

Call sites: the issue board card, the provenance record cards, the issue details block
(`src/issues/IssueBoard.tsx`, `src/issues/IssueProvenance.tsx`, `src/issues/IssueView.tsx`). A caller
may add state the frame cannot know (selection border, hover, focus ring, a `bg-deep/40` recess, a
`group` hook); it may **not** re-declare the frame.

**Rule: one permitted bordered container per view.** Concretely:

- a **list** is never inside a bordered box; lists are separated by hairlines;
- a **section** is a hairline, never a card (§6);
- the sanctioned **bordered containers** are: `Card` (a record box), `ContentPanel`
  (`src/ui/primitives.tsx`, a bounded scroll well on `bg-deep/60`), and a form frame (an input,
  textarea or the markdown editor box). A view may use `Card` for its records and a bounded scroll
  well for long text; it may not wrap one in the other.
- a **control** may carry a border because it needs one: an input (`border-border`), `Kbd`, the
  dashed `SourceBadge` provenance chip, the dashed deferred `StatusDot`. A bordered *button* is not
  sanctioned — `ToolbarButton` is a ghost control (§5.1) — and the three surviving ones are listed in
  §15.2 item 6.

Measured 2026-11-23 (bordered containers per surface): Research 0, Settings 0 (one `rounded-full`
dot), Pull drawer 0, GitHub issue panel 0, Content 0, Integration 0. The Issue **page** exceeds the
rule and is the documented case: 1 `Card` (details), 1 hand-rolled bounded well and a bordered
trigger inside the normalize dialog, and — on the Journal tab — a bordered `<details>` per entry plus
a bordered compose button (§15.2 item 6).

Enforcement: `src/ui/card.test.tsx` (one radius and one padding value per axis on every rendered
`Card`, every call site's `className` resolved or reported unresolved, "is the only place a card frame
is written"); `e2e/issue-board.spec.ts` (a lane has no frame, radius or fill and is separated by a
1px hairline; a card keeps the 8px radius and the hairline and paints no fill); `src/ui/section.test.tsx`
("EmptyState marks itself with a glyph, not a bordered tile"). "One bordered container per view" is
otherwise **review only**.

## 10. PR identity

`src/ui/pr-key.tsx` owns the state model, the key and the chip; `src/issues/pr-state.tsx` is an alias
for the chip.

Four states plus `unknown` — `draft` is a flag on an open PR, resolved once by `prStateOf`:

| state | word | key ink | chip tone | glyph |
|---|---|---|---|---|
| open | Open | `text-success` | `success` | `pull` |
| draft | Draft | `text-ink-muted` | `neutral` | `pullDraft` |
| merged | Merged | `text-accent-ink` | `accent` | `merge` |
| closed | Closed | `text-danger` | `danger` | `pullClosed` |
| unknown | the source's own word | `text-ink-muted` | `muted` | `pull` |

- `PrKey({ number, state, draft?, repo?, glyph = true, quiet?, className? })` — mono `text-xs`, glyph
  at `micro`/`text`, `title` + `aria-label` naming the state. `quiet` mutes the ink for a row that
  already has a coloured status (§2.3 rule 1).
- `PrStateChip({ state, draft?, stateSource?, showSource?, size? })` — the glyph + word chip. Two
  call sites: the PR inspector header, and (as the `PrStateBadge` alias) a linked PR row in the issue
  page's PR block, where `showSource` adds the `assumed` chip. `assumed` renders as its own muted
  chip only where there is room for it.
- `LinkedRefs({ refs, max = 1, onOpen? })` (`src/ui/linked-refs.tsx`) — one non-wrapping cell: the
  first `max` refs as chips, the rest as plain-text `+N` that opens a popover listing every ref; `—`
  for none.

Enforcement: `src/ui/pr-key.test.tsx` (four states, unknown rendered, distinct glyph per state, quiet,
chip in its tone), `src/github/pulls.test.tsx` (Restraint rules 1 and 3), 
`src/ui/linked-refs.test.tsx` (em dash) with the connected cases in `src/github/pulls.test.tsx`.

## 11. Hairlines, not boxes

| need | token and shape |
|---|---|
| separation between sections on a page | `border-t`/`border-b border-border-muted` (usually through `Section`/`ListSection`) |
| separation between table rows | **none**: a row draws no rule on either axis; spacing separates the columns (`e2e/layout.spec.ts` measures `0px` for both). The subtle rule lives under the **header** only |
| separation between lanes (issue board) | `border-l border-border-muted`, the first lane none |
| a tree rail | `border-l border-border-muted` plus a 2px `bg-accent` marker on the active row |
| a table's own frame | **none**: the header carries no radius class (measured `0px` on all four corners), no band behind it, and one rule underneath |
| separation between rows of a non-table list | `border-b border-border-subtle` per item (`src/surfaces/ActivitySurface.tsx`), or `divide-y divide-border-muted` on the container (`src/surfaces/ResearchSurface.tsx`) |
| a secondary pane's edge (a document nav) | `border-r border-border-subtle` (`src/github/ContentSurface.tsx`) |

A `first:`/`last:` variant's suppression is explained by its wrapper, not just observed: Settings'
sections sit in a `role="group"` wrapper, so the wrapper owns the child index and the inner `Section`
computes `border-top: 0` because it is that wrapper's only child.

Enforcement: `e2e/layout.spec.ts` (the table header's four radii are `0px`, its fill is transparent,
one 4% rule underneath, and the rows draw no rule on either axis), `e2e/issue-board.spec.ts` (a lane
is a hairline, no frame, no radius, no fill; lanes abut with 0 gap), `src/ui/card.test.tsx` (the card
frame is one place), `src/app/shell.test.tsx` (the sidebar rail is `border-l border-border-muted`).

## 12. Chrome heights

| surface | height | source |
|---|---|---|
| top bar (search pill 32px centred) | 44px `h-11` | `src/shell/AppShell.tsx` `TopBar` |
| contextual sidebar header row | 44px `h-11` | `src/shell/ContextSidebar.tsx` |
| surface toolbar | 40px `min-h-10`, grows | `src/ui/primitives.tsx` `SurfaceToolbar` |
| table header | 32px `h-8` | `IssuesSurface`/`PullsSurface` header rows |
| list/table row | 32px | §4.2 |
| drawer strip / drawer header | 48px `h-12` | `src/ui/drawer.tsx` `Drawer` |
| dialog header | 48px `h-12` | `src/ui/dialog.tsx` `DialogFrame` |
| dialog footer | `py-3` (panel) / 36px `h-9` (palette) | `src/ui/dialog.tsx` `DialogFrame.Footer` |
| page detail header | 44px `h-11` `px-4` (issue) / 48px `h-12` `px-3` (research) | `src/issues/IssuePage.tsx`, `src/surfaces/ResearchSurface.tsx` |
| inspector rail | 28px wide | `src/shell/InspectorDock.tsx` `RAIL` |
| inspector bottom inset | 6px | `InspectorDock` `bottom-1.5`, mirroring the 32px pill in the 44px bar |

Shell chrome therefore has two **bars** (44 top, 48 drawer/dialog) and one **toolbar** (40). The two
page-detail headers disagree (44 vs 48) and their gutters disagree (`px-4` vs `px-3`); that is a live
divergence recorded in §15, not a rule.

Enforcement: `e2e/layout.spec.ts` (the 6px inspector inset at three viewport sizes and the 32px table
header), `src/ui/dialog.test.tsx` (`h-12` header for both dialog tones). The rest is **review only**.

## 13. Drawer frame, header and sections

- `Drawer({ variant, header, label })` (`src/ui/drawer.tsx`): an `<aside aria-label>` at
  `flex h-full min-w-0 flex-col bg-raised`. It declares **no** border, radius or shadow — the dock
  that hosts it owns those.
  - header row: `h-12 px-2 gap-1`, contains `IconButton` back/forward, the entity kind label, then
    `ToolbarButton`s (Attach, Open) and `IconButton`s (follow, pin, maximize, options, close) at
    `ml-auto`.
  - body: `thin-scrollbar min-h-0 flex-1 overflow-y-auto`; `variant="maximized"` adds
    `mx-auto w-full max-w-4xl py-4`.
- `DetailTitle` (`src/shell/detail-title.tsx`): `px-5 pt-4 pb-3`, an optional `eyebrow` at
  `text-xs text-ink-faint`, the title as `<h2 text-base font-medium text-ink>`, an optional `lead`
  (the `PrKey`), `aside` (the ghost `GithubPill`), and `meta`. This is the one drawer title; the PR
  inspector and the entity inspector both use it.
- Sections inside the drawer: `Section` / `InspectorSection` — one hairline above, `px-5 py-4`, header
  at `inset="drawer"` `h-7` (§6). The first section drops its rule.
- The dock (`src/shell/InspectorDock.tsx`): `rounded-lg bg-raised`, `shadow-panel` when open and no
  border (a bordered panel would outline it in a colour that is not its background), `bottom-1.5`,
  a resize handle at the left edge, and a collapsed rail 28px wide.

Enforcement: `src/app/research.test.tsx` and `e2e/inspector-github.spec.ts` assert the drawer is the
canonical one and mounts in the dock; the internal geometry is **review only** (no test measures
`h-12` or `px-5 py-4` in the drawer).

Dialogs: one `DialogFrame` (`src/ui/dialog.tsx`) with `tone: "panel" | "palette"`, `frameWidth`,
`top`, `maxHeight`, and `header`/`footer` slots; one scrim (`bg-black/30 dark:bg-black/50`) for every
modal, declared once. Enforcement: `src/ui/dialog.test.tsx` (slots, both tones, geometry, all three
call sites).

## 14. Surface-by-component map

| component (export, file) | Issues | Pulls | PR drawer | Project | Research | Settings | Shell |
|---|---|---|---|---|---|---|---|
| `SectionHeader`/`Section`/`ListSection` (`ui/section.tsx`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `Row` (`ui/primitives.tsx`) | ✓ table | ✓ table | ✓ | ✓ list | ✓ list | | ✓ sidebar |
| `RowAction` (`ui/row-action.tsx`) | ✓ | ✓ | | ✓ | | | |
| `ToolbarButton`/`ToolbarFilter`/`ToolbarTabs`/`ListFilter` (`ui/toolbar.tsx`) | ✓ | ✓ | ✓ buttons | ✓ | ✓ | ✓ | ✓ |
| `Fields` + label ladder (`ui/drawer.tsx`) | ✓ | | ✓ | ✓ | ✓ | ✓ | ✓ |
| `Badge` (`ui/badge.tsx`) | ✓ | ✓ | ✓ | ✓ | ✓ | | |
| `Card` (`ui/card.tsx`) | ✓ | | | | | | |
| `PrKey`/`PrStateChip`/`LinkedRefs` (`ui/pr-key.tsx`, `ui/linked-refs.tsx`) | ✓ | ✓ | ✓ | ✓ | | | |
| `DetailTitle` (`shell/detail-title.tsx`) | | | ✓ | | ✓ | | ✓ |
| `Drawer`/`InspectorSection` (`ui/drawer.tsx`) | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| `DialogFrame` (`ui/dialog.tsx`) | ✓ | | | | | ✓ | ✓ |
| `Icon` + ladder (`ui/icon.tsx`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `EmptyState`/`LoadingState`/`ErrorState`/`ContentPanel`/`SourceBadge` (`ui/primitives.tsx`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `SurfaceToolbar` (`ui/primitives.tsx`) | ✓ | ✓ | | ✓ | ✓ | ✓ | ✓ |

## 15. Enforcement index and review-only debt

Every rule above names its enforcement. This is the same list, sorted by what carries it, so the debt
is visible in one place.

### 15.1 Enforced by a test

| rule | test |
|---|---|
| no px font/glyph/spacing, no off-scale rem text, no hand-rolled label grid, no label-width literal, every scroll container names a treatment | `src/ui/units.test.ts` (rules + holes in `scripts/units-gate.ts`) |
| glyph ladder is rem, derived from one table; `IconButton` default step; `ListFilter` glyph == toolbar glyph; rail tokens in rem | `src/ui/scale.test.tsx`, `src/ui/icon.test.tsx` |
| section header insets, heading level, mono caption, wrapping; `Section` frame; `FieldLabel` delegates; `Badge` sizes; `EmptyState` has no tile; `Fields` knobs; level 4 | `src/ui/section.test.tsx` |
| toolbar ghost/primary, `ToolbarFilter` value-in-label, `ToolbarTabs` underline and keyboard, `ListFilter` full behaviour | `src/ui/toolbar.test.tsx` |
| `Badge` tones, `shrink-0` default and `shrink` opt-in | `src/ui/badge.test.tsx`, `e2e/github-issue-labels.spec.ts` |
| one `Card` frame, one radius/padding per axis, every call site resolved | `src/ui/card.test.tsx` |
| one `DialogFrame`, both tones, slots, geometry | `src/ui/dialog.test.tsx` |
| PR states, glyph per state, quiet key, chip tone; `LinkedRefs` empty | `src/ui/pr-key.test.tsx`, `src/ui/linked-refs.test.tsx`, `src/github/pulls.test.tsx` |
| `RowAction` reveal, 20px + text glyph, done/fail wording | `src/ui/row-action.test.tsx` |
| sidebar 30px geometry, rail marker, deferred ink, no child icons | `src/ui/sidebar.test.tsx` |
| filter-toggle idiom (`aria-pressed` + `font-medium`) | `src/surfaces/ActivitySurface.test.tsx` |
| outline sequences per Research route; board lane heading | `src/app/research.test.tsx`, `e2e/research-outline.spec.ts`, `e2e/issue-board.spec.ts` |
| 32px row with a 10px detail line | `e2e/project-questions.spec.ts` |
| table header squared, 32px, one 4% rule, no cell rules; 6px inspector inset | `e2e/layout.spec.ts` |
| lane is a hairline; card keeps radius+hairline and paints no fill | `e2e/issue-board.spec.ts` |
| indent step at two roots; row reading order; inline key/chip/title | `e2e/issue-rows.spec.ts`, `e2e/activity-row-indent.spec.ts`, `src/issues/IssueRows.test.tsx` |
| rendered type/glyph scale at a 16px and a 12px root | `e2e/ui-scale.spec.ts` |
| declared Research label columns and the rendered 172px pitch | `src/app/research.test.tsx`, `e2e/research-label-column.spec.ts` |
| one chart-title treatment | `e2e/research-chart-titles.spec.ts` |
| the drawer is the shared `data-testid="inspector-drawer"` mounted in the inspector dock | `src/app/research.test.tsx`, `e2e/inspector-github.spec.ts` |

### 15.2 Review only

These rules have no test that can see the property. Each is a **follow-up candidate**; the contract's
non-goal is to file them rather than edit source, and this activation may not create issues, so they
are listed here with a proposed scope and reported to the coordinator.

1. **Chip-for-state-only (Restraint rule 2)** — 6 measured metadata chips (§2.3). Proposed scope: one
   Badge per non-state use replaced by plain or mono text, or a written exception per site.
2. **One bordered container per view** — measured in §9. Proposed scope: a source rule that refuses a
   `Card` or a two-class bordered box inside a list container, plus a per-view inventory.
3. **Residual selection shapes** — the segmented `bg-control` pill (`GlobalSearch` scope,
   `ContextSidebar` `HalfSwitch`, plus the Agent half's copies), the `IconButton` `active` radio pair
   (`IssuesSurface` layout), and a selected top-level `SidebarRow` carrying both `bg-hover` and
   `bg-pressed` so its fill is stylesheet-order dependent. Proposed scope: one segmented-switch
   primitive with its own test, or adoption of `ToolbarTabs`/`ToolbarButton` at each site; and one
   selected fill for the sidebar, asserted the way `Card`'s single-frame test asserts its frame.
4. **Page-detail header height and gutter disagree** — 44px `px-4` (issue page) against 48px `px-3`
   (research page). Proposed scope: one `PageHeader` primitive, then the chrome heights table becomes
   a rule with a test.
5. **`.tabular` versus `tabular-nums`** — two sites still use the raw utility
   (`src/project/workers/WorkerRow.tsx`, both `ctxPct` cells). Proposed scope: replace both, then a
   units-gate rule for the raw utility.
6. **`IssueView` duplicates `ContentPanel`** as a hand-rolled bordered scroll well
   (`max-h-56` vs the panel's `max-h-72`), and `IssueJournal` keeps a bordered `<details>` and a
   bordered compose button. Three bordered buttons survive outside `src/agent`: `Review mapping`
   (`src/issues/IssueView.tsx`), the Journal compose button (`src/issues/IssueJournal.tsx`, "Add a
   journal entry…"), and the GitHub sign-in button (`src/github/auth.tsx`). Proposed scope: adopt
   `ContentPanel` and `ToolbarButton`, or record a per-site exception.
7. **`GlobalSearch` `shadow-[…]` literal** — the last arbitrary shadow outside `src/agent`; the Agent
   half carries three more (`src/agent/AgentSidebar.tsx`, `src/agent/Composer.tsx`,
   `src/agent/NewSession.tsx`); belongs with item 3.
8. **`Row` densities and toolbar heights are unmetered** — no unit test renders each density or the
   40px toolbar; only surfaces that happen to be measured are covered. Proposed scope: one
   `Row`/`SurfaceToolbar` geometry test.
9. **The Agent half is outside the drift gate** (`src/agent/**` in `OUT_OF_SCOPE`) and carries 38
   off-scale rem literals and the older pill switch. Owned by the Agent epic (XTRM-620), not by this
   document; recorded so the exclusion is not read as coverage.
10. **Contrast** — the token comments record the measured ratios but nothing computes them. Proposed
    scope: a token-contrast test over the two theme blocks.
11. **A dead gate exclusion** — `scripts/units-gate.ts` `OUT_OF_SCOPE` still names
    `src/components/reui`, a directory XTRM-945 deleted. It excludes nothing, so it is harmless today
    and misleading tomorrow; the exclusion list should stop naming a path with no files.
12. **Eight source comments cite the retired proposal numbering** (`src/ui/icon.tsx`,
    `src/ui/github-mark.tsx`, `src/ui/pr-key.tsx`, `scripts/units-gate.ts`,
    `src/project/ProjectShell.tsx`, `src/project/timeline/NowMarker.tsx`,
    `src/project/workers/{WorkerRow,WorkersSurface,WorkersTree,model}.ts(x)`,
    `src/project/followups/FollowUpsSurface.tsx`, `e2e/project-timeline.spec.ts`). §1.1 maps each to
    its target, but a reader has to know the table exists. Proposed scope: re-anchor the comments to
    this file's numbers in one sweep, then delete §1.1.

### 15.3 Named limits (what the gate cannot prove)

Carried from `scripts/units-gate.ts` `HOLES`, because a document that hides them is read as coverage:

- a rendered assertion cannot tell "the prop was honoured" from "the prop rendered the same value"
  (`prop-path`, XTRM-951);
- a wrapper whose only child is always first silently defeats `first:border-t-0`
  (`structural-suppression`, XTRM-951);
- a class assembled through a module-level constant is invisible to the scanner
  (`constant-indirection`, XTRM-949);
- `labelWidth={PAGE_LABEL_COLUMN}` passes by design; the gate closes the set, it cannot size a member
  (`label-width-constant`, **XTRM-940** — this document is the record it names);
- `src/agent/**` is outside the walk (`agent-outside-the-walk`, XTRM-620).

## 16. Validation of this document

- Every rule above names the file and the export or class string that implements it, read at
  `xtrm-sp-worker-xtrm-940` on 2026-11-23.
- Every number that is a token value is quoted as the token's definition in `src/styles.css`, not as a
  computed pixel, so a retune of a scale does not falsify the rule. Rendered figures are labelled with
  the measurement that produces them.
- The restraint rulings are the operator's 2026-11-18 text, verbatim; the five rulings R1–R5 are
  recorded as resolved (§2.4) rather than as open questions.
- The migration table (§17) traces each removed idiom to the closed child that removed it.
- Doc-only change: `cd packages/xtrm-app && npx vitest run src/ui` is green and unchanged (17 files,
  147 tests at `3f0cb76d`).

### Supersession of the XTRM-853 design page (dated ruling, 2026-11-23)

`docs/design/mocks/console-ui-system.html` renders the 2026-11-18 **proposal**. It is retained as
history: it is a static page, it predates the convergence pass, and several of its specimens (the
chip-like toolbar controls, the bordered panels, the pre-convergence row anatomy) are exactly what the
epic removed. It is not authority, it is not regenerated, and a disagreement between it and this file
resolves to this file. Screenshot evidence for the shipped tree lives under `docs/screenshots/` and is
owned by the e2e spec named in each set's README.

## 17. Migration table — every removed idiom and its replacement

Each row traces to the closed child that removed it. "Removed" was measured in the XTRM-933 problem
statement at `xt/1qkh`/`e9a4a6da`; "replacement" is the export in the shipped tree.

| # | removed idiom | replacement now | closed issue |
|---|---|---|---|
| 1 | five section-header idioms: uppercase+tracking eyebrow, mono caps on `bg-control`, sentence-case `text-xs` at four insets, semibold sidebar label, `FieldLabel` | `SectionHeader` (insets `list`/`drawer`/`none`, `level`, `mono`) and `FieldLabel` delegating to it; the sidebar's collapsible group keeps its own disclosure button because it is a control, not a heading | XTRM-934, XTRM-935 |
| 2 | five selected-state idioms: `bg-hover` tab fill, `bg-pressed` view switch, `aria-pressed`+`font-medium`, `IconButton active`, underline tab | `ToolbarTabs` underline for a view switch; `aria-pressed` + `font-medium text-ink` in `TOOLBAR_CONTROL` for a filter toggle | XTRM-934, XTRM-936, XTRM-937 |
| 3 | five label/value grids (3.5/6.5/7.5/8/10rem) and two value sizes | `Fields` + `labelWidth` from the five-step ladder + `size` `xs`/`sm` | XTRM-934, XTRM-948, XTRM-971 |
| 4 | inline `gridTemplateColumns` on a label/value grid | `Fields labelWidth={STEP}`; the gate refuses the literal forms | XTRM-948, XTRM-971 |
| 5 | five row heights: 32 list, 36 (`JiraRow` `h-9`), 36 (`other.tsx` `rowHeight`), 44 (`Activity` `min-h-11`), auto (`QuestionRow`) | `Row density="list"` 32px everywhere; `JiraRow`/Repositories/Activity converged; a two-line row keeps 32px with a `text-2xs` detail line | XTRM-936 |
| 6 | px indent literal (`paddingLeft: depth * 14`) invisible to the gate | `INDENT_REM` + `--row-indent`; the gate refuses every px/multiplier indent spelling | XTRM-936, XTRM-947 |
| 7 | 54 off-scale micro text literals (0.6–0.95rem) | `text-2xs` / `text-xs` tokens; `Badge xs` is `text-2xs`, `Kbd` is `text-2xs` | XTRM-934, XTRM-907 |
| 8 | `IconButton` defaulting to a 16px glyph beside 11.5px text | `text` default in the 28px control, `md` in the 36px control; `iconSize` is an explicit opt-in | XTRM-934 |
| 9 | 38 `rounded-md`/`rounded-lg` border cards around lists and field groups | `Card` for a record box, `Section`/hairline for a section, no box around a list | XTRM-935, XTRM-938, XTRM-942, XTRM-943, XTRM-989, XTRM-990 |
| 10 | `EmptyState`'s 36px rounded icon tile | a bare `Icon size="md"` in faint ink | XTRM-934 |
| 11 | `.tabular` (108) versus `tabular-nums` (5) for one concept | `.tabular` utility; 2 raw usages remain (§15.2 item 5) | XTRM-936 (partial) |
| 12 | three dialog chromes: `bg-black/30` vs `/20`, three `top` offsets, three widths, one string per call site | one `DialogFrame` with `tone`, `frameWidth`, `top`, `maxHeight`, slots, one scrim | XTRM-944 |
| 13 | `src/components/reui/*` parallel component kit (own design language, zero importers) | deleted; `src/ui` is the only kit. The gate still lists a now-absent `src/components/reui` in `OUT_OF_SCOPE`; removing that dead exclusion is a follow-up (§15.2 item 11) | XTRM-945 |
| 14 | six Research `rounded-md border` card panels and `h-11 px-4` panel headers | hairline-separated sections, `SectionHeader` at the console gutters, the console table idiom | XTRM-938 |
| 15 | a bare `<table>` in Research | a grid row template with a header row | XTRM-938 |
| 16 | Settings' private `actionButton` (fifth bordered-button style) and its `px-4 py-4` `Section` | `ToolbarButton`; `Section` (which owns `px-5 py-4`) | XTRM-937, XTRM-990 |
| 17 | inspector header's bordered Attach/Open buttons | `ToolbarButton` (ghost) | XTRM-937 |
| 18 | `PullPanel`'s hand-rolled header, plus bordered description and review bodies | `DetailTitle`; `.xtrm-prose` on a hairline | XTRM-937 |
| 19 | `IssueView`'s `bg-hover` fill tab row | `ToolbarTabs` underline | XTRM-937 |
| 20 | `IssueView`'s fourth label/value grid (6.5rem) | `Fields labelWidth={PART_LABEL_COLUMN}` | XTRM-937 |
| 21 | `text-[0.68rem]` in `PullRequestsBlock` and its local sub-labels | `SectionHeader` at `inset="none"` | XTRM-987 |
| 22 | `NewIssueDialog`'s local label span | `FieldLabel` | XTRM-988 |
| 23 | `PriorityGlyph`'s `rounded-[1px]` | `rounded-full` | XTRM-987 |
| 24 | five board columns as five `rounded-lg border` cards | lanes separated by one hairline; the card is the shared `Card` with the canonical caps lane heading | XTRM-943 |
| 25 | hand-rolled GitHub chips (`rounded-sm bg-control px-1.5 py-px`) | `Badge` with an explicit `size` | XTRM-942 |
| 26 | a solid pill in a header (`GithubPill` in `PullPanel`, auth notice buttons) | `GithubPill variant="ghost"`; `ToolbarButton` | XTRM-990 |
| 27 | `ContextSidebar` `text-[0.65rem]`/`[0.68rem]`, `shadow-[…]` literals, `rounded-[4px]`, source names as badges, and a half switch drawn from raw colours | tokens (`text-2xs`, `shadow-float`, the radius tokens) and source facts as `StatusDot` + plain text. The half switch **kept its segmented shape** and moved onto tokens only; that shape is not a sanctioned toggle (§5.2, §15.2 item 3) | XTRM-939 |
| 28 | `AppShell` search control's `bg-hover` resting fill | ghost resting state, fill on hover/focus | XTRM-939 |
| 29 | Research outline starting at level 3 (no level-2 anywhere) | page section at level 2, group 3, leaf 4, depth 4 terminal | XTRM-954 |
| 30 | a chart title rendered without `font-medium` while the card rendered it with | one weight, `text-sm font-medium text-ink` for a name above its content | XTRM-955 |
| 31 | comparison header not truncating a long run id inside a fixed-height row | one-line ellipsis with the full id in `title` | XTRM-950 |
| 32 | Activity expanded body at `px-6` and a `max-w-[16rem]` refs cap | the shared indent step (`pl-5`, 1.25rem) and a token cap | XTRM-947 |
| 33 | `Badge` forcing `shrink-0` so a caller could not let a chip truncate (measured 142px overflow) | `shrink` opt-in that swaps `shrink-0` for `min-w-0 shrink` | XTRM-952 |
| 34 | five labelled card dialects for a record box (issue board, provenance, issue details) | one `Card` / `CARD_FRAME`, with a test that refuses a caller override per axis | XTRM-989, XTRM-998 |
| 35 | `Kbd`'s `text-[0.68rem]` literal | `text-2xs`, the smallest ladder step | XTRM-934 |

## 18. Motion (added 2026-11-25, XTRM-1034)

Source: `packages/pi-viewer/docs/design/t3code-chat-audit.md` §1.5 and §4.4 (external to this
document's gate, as in §4.2.1). Before this section the
document named one motion only (the toolbar filter, §5.3: 150ms, instant under reduced motion). The
rules below are the ones the chat thread ships; any surface may use them, none must.

1. **Opacity plus a short translate, nothing else.** Content may fade and may move by at most 4px
   while it fades. A floating control that enters and leaves (the scroll pill) may translate by its own
   height and scale 0.95 to 1 with its opacity. No animation of `width`, `height`, `top`, `margin`,
   `padding` or any property that changes layout. The one existing exception is the filter widen in §5.3.
2. **Hover reveal: 200ms opacity.** Secondary metadata (timestamps, copy) appears on hover and on
   `:focus-within`, so it stays reachable by keyboard. A coarse pointer shows it always. The last row
   of a thread keeps it visible.
3. **Stream fade: 600ms, `ease-out`.** A block that arrives after the first paint fades from 0 to 1.
   Rows present at mount never animate, so reopening a thread never replays it.
4. **Stepped loops, paused off-screen.** A continuous animation (the label shimmer, 2.2s `steps(30)`)
   steps rather than eases, and pauses while its element is outside the viewport
   (`IntersectionObserver`). A thread of many live rows must cost nothing off-screen. Never a spinner,
   a bouncing dot or a pulsing avatar.
5. **Every animation has a `prefers-reduced-motion: reduce` branch**: transitions drop to none, loops
   stop, and the element shows its final state (the shimmer text keeps its muted colour).
6. **Smooth scrolling is the scroller's job.** A thread follows new content smoothly only while an
   agent works and the reader is at the end; it never moves a reader who scrolled up, and a reader's
   own input (wheel, touch, key, pointer) ends any follow at once.

Implementation: `.xtrm-shimmer`, `.xtrm-fade-in`, `.xtrm-meta` and the `@media (prefers-reduced-motion)`
block at the foot of `packages/pi-viewer/src/styles.css` ("Chat restyle (XTRM-1034)").
Enforcement: **review only**, except the follow rule, which `npm run test:follow` and
`npm run test:anchor` in `packages/pi-viewer` assert.
