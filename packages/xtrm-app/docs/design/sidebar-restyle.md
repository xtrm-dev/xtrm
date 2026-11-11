# Sidebar restyle and icon system — scope

Status: proposal for operator selection. Not implemented.
Companion mock: [`../mocks/sidebar-restyle-proposals.html`](../mocks/sidebar-restyle-proposals.html) (open in a browser; light/dark toggle in the page header).
Scope owner: Console v2 shell. Authority remains the PRD, `console-v2-shell-architecture.md`, and the active Substrate issue.

## 1. Goal

1. Replace every navigation and surface icon with a lucide icon chosen for meaning, not for availability.
2. Rebuild the contextual sidebar into three groups — Workspace, Github, System — with Program keeping its four nested rows and gaining an always-visible chevron.
3. Increase visual weight for both icons and text, and fix sizing so the sidebar reads like Linear rather than like a default Tailwind list.
4. Dim every not-yet-developed destination without inventing placeholder UI.

## 2. Current state (verified in this worktree)

| Element | Today | Location |
| --- | --- | --- |
| Icon set | 46-name lucide registry, one global `strokeWidth={1.6}` | `src/ui/icon.tsx:51-98`, `src/ui/icon.tsx:106` |
| Icon sizes | `xs 14 · sm 16 · md 18 · lg 20` | `src/ui/icon.tsx:102` |
| Sidebar row | `h-8` (32 px), `gap-2.5` (10 px), `px-2` (8 px) | `src/ui/sidebar.tsx:52-65` |
| Row icon | `size="xs"` (14 px), faint | `src/ui/sidebar.tsx:60` |
| Row label | 13 px, weight 500 (`font-medium`) | `src/ui/sidebar.tsx:61` |
| Section header | `h-7`, 11.5 px, weight 500, faint; chevron appears on hover/focus only | `src/ui/sidebar.tsx:14-17` |
| Nested indent | `paddingLeft: 1.75rem` (28 px) | `src/ui/sidebar.tsx:57` |
| Groups | `Work` / `Code` / `System`; modes nested under `Work` | `src/app/destinations.ts:77-99` |
| Modes | Work, Agents, Program, Research, Observability | `src/app/destinations.ts:18-24` |
| Keyboard | `Mod+1..5` indexes `MODES[n - 1]` | `src/shell/AppShell.tsx:46-62` |
| Palette hints | group label from `REPO_SECTIONS` | `src/shell/GlobalSearch.tsx:42,78` |
| Sidebar width | `264` default (min 220, max 360) | `src/shell/layout.ts:33` |
| Palette | sidebar `#f4f4f5` light / `#1e1e1e` dark; ink `#18181b`/`#ececef`; faint `#94949c`/`#6a6a72`; accent `#4f46e5`/`#818cf8` | `src/styles.css:17-70` |

## 3. Target information architecture

```
Workspace
  Activity            mixed feed: Substrate · GitHub · Jira/Linear, with filters
  Issues              Substrate issues (count)
  Program             chevron, always visible
    Workstreams
    Assignments
    Decisions
    Recent changes
  Agents              deferred
  Observability       deferred
  Research            deferred

Github
  Pull requests
  Github Issues
  Releases
  Repository content
  CI / CD             deferred

System
  Specialists         deferred
  Skills              deferred
```

Changes against today:

| Row | Today | Target |
| --- | --- | --- |
| Activity | `Code` group, git-only | `Workspace`, first row |
| Issues | `Work` group | `Workspace` |
| Program | mode row inside `Work`, children only when active | `Workspace` row, chevron, children under it |
| Agents / Observability / Research | modes inside `Work` | top-level `Workspace` rows, deferred |
| Pull requests, Github Issues, Releases, Repository content | `Code` group | `Github` group, same order |
| Graph | `System`, deferred | removed from navigation |
| Repository observability | `System`, deferred | removed from navigation |
| Specialists, Skills | absent | `System`, deferred |

Removed rows still resolve: `/rep/:owner/:repo/system/graph` and `/system/observability` remain routed (`src/app/router.tsx`), only the sidebar entries disappear.

## 4. Icon selection

All names verified present in `lucide-react@1.70.0` (the pinned dependency). Registry *values* change; registry *keys* stay stable so the 20+ call sites outside the sidebar keep compiling and gain the new glyphs consistently.

| Slot | Icon | Link | Registry |
| --- | --- | --- | --- |
| Activity | Activity | https://lucide.dev/icons/activity | `activity` (keep) |
| Issues | CircleDot | https://lucide.dev/icons/circle-dot | `issues` (was ListChecks) |
| Program | Network | https://lucide.dev/icons/network | `program` (was Briefcase) |
| Program → Workstreams | Target | https://lucide.dev/icons/target | `target` (keep) |
| Program → Assignments | UserRoundCheck | https://lucide.dev/icons/user-round-check | `agents` (was Users) |
| Program → Decisions | Gavel | https://lucide.dev/icons/gavel | `done` (was CheckCircle2) |
| Program → Recent changes | GitCommit | https://lucide.dev/icons/git-commit | `commit` (keep) |
| Agents | Bot | https://lucide.dev/icons/bot | `agent` (reuse) |
| Observability | Radar | https://lucide.dev/icons/radar | `observability` (was LineChart) |
| Research | FlaskConical | https://lucide.dev/icons/flask-conical | `research` (keep) |
| Pull requests | GitPullRequest | https://lucide.dev/icons/git-pull-request | `pull` (keep) |
| Github Issues | SquareDot | https://lucide.dev/icons/square-dot | `comment` (was MessageSquare) |
| Releases | Tag | https://lucide.dev/icons/tag | `release` (keep) |
| Repository content | FolderTree | https://lucide.dev/icons/folder-tree | `content` (new; `file` stays for file-level surfaces) |
| CI / CD | Workflow | https://lucide.dev/icons/workflow | `ci` (new) |
| Specialists | UserRoundCog | https://lucide.dev/icons/user-round-cog | `specialists` (new) |
| Skills | Blocks | https://lucide.dev/icons/blocks | `skills` (new) |
| Section + Program chevron | ChevronDown / ChevronRight | https://lucide.dev/icons/chevron-down | `chevronDown` (keep) |

### Reference: Linear's shipped sidebar

Measured from the operator's screenshot of the live Linear sidebar (594 × 2044 at @2x), and rendered as the `Ref` column of the mock.

| Property | Linear | Our baseline | Chosen |
| --- | --- | --- | --- |
| Row height | 30 px | 32 px | 30 px (B) |
| Icon size | 16 px | 14 px | 16 px (B) |
| Icon stroke | 1.5 | 1.6 | 2.0 (B) — deliberately heavier |
| Label | 13 px / 500 | 13 px / 500 | 13 px / 600 (B) |
| Nested indent | 20 px | 28 px | 20 px (B) |
| Section header | 12.5 px / 500, muted, no glyph, small **filled** caret after the label | 11.5 px / 500, stroke chevron on hover | 11 px / 650, stroke chevron always visible |
| Icon colour | all nav icons muted grey; only the label brightens when active | icon becomes ink on the selected row | keep ink lift on selected |
| Group structure | unlabelled rows, then `Workspace` / `Your teams` / `Try` sections with carets | `Work` / `Code` / `System` | `Workspace` / `Github` / `System` |

Two consequences. First, variant B reproduces Linear's geometry exactly; the heavier stroke and label weight are our intentional addition, and they are the only two places where B departs from the reference. Second, Linear's own text weight is **not** heavier than ours — the perceived weight in Linear comes from the larger 16 px icon and from greying every icon so the bright label carries the hierarchy.

Semantics worth borrowing, all present in `lucide-react@1.70.0`:

| Linear slot | Linear glyph | Lucide | Our use |
| --- | --- | --- | --- |
| Issues (team) | two overlapping rounded squares | [square-stack](https://lucide.dev/icons/square-stack) | alternate for Issues |
| Projects | isometric cube with inner Y | [box](https://lucide.dev/icons/box) | alternate for Program |
| Agent | cursor arrow | [mouse-pointer-2](https://lucide.dev/icons/mouse-pointer-2) | alternate for Agents |
| My issues | viewfinder with centre dot | [scan](https://lucide.dev/icons/scan) (no dot variant) | not needed |
| Views | stacked layers | [layers-2](https://lucide.dev/icons/layers-2) | not needed |
| Inbox | tray | [inbox](https://lucide.dev/icons/inbox) | not needed |
| Reviews | pull-request | [git-pull-request](https://lucide.dev/icons/git-pull-request) | confirms our Pull requests glyph |
| Section caret | filled triangle | [triangle](https://lucide.dev/icons/triangle) | alternate to a stroke chevron |

Rationale for the two contested choices:

- **Issues = CircleDot, Github Issues = SquareDot.** `CircleDot` is Linear's issue glyph and matches the app's own status dots. `SquareDot` keeps the GitHub row distinct at 16 px instead of showing two near-identical circles.
- **Program = Network.** Workstreams, assignments and decisions are connected streams, not a briefcase. `Network` survives 16 px better than `Waypoints` or `Milestone`.

Alternates for every slot are rendered in the mock's "Icon candidates by slot" table, each linked to its lucide page.

## 5. Weight and size tokens

The mock renders four panels with identical content so only the tokens differ.

| Panel | Row | Icon | Icon stroke | Label | Section header | Indent |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline (today) | 32 | 14 | 1.6 | 13 / 500 | 11.5 / 500 | 28 |
| A Compact | 28 | 15 | 2.0 | 12.5 / 550 | 10.5 / 650 | 18 |
| B Linear (recommended) | 30 | 16 | 2.0 | 13 / 600 | 11 / 650 | 20 |
| C Heavy | 34 | 17 | 2.25 | 13.5 / 650 | 11.5 / 700 | 24 |

Recommended: **B**, with section headers at weight 650 and labels at 600. It raises weight without the density loss of C and keeps a 30 px row inside a 264 px sidebar, leaving room for counts and a trailing chevron.

Implementation shape if B is chosen:

- `src/ui/icon.tsx`: add `nav: 16` to `SIZES`; default `strokeWidth` 2 (drop the single 1.6); allow an explicit `strokeWidth` prop for callers that need 1.75 (dense tables).
- `src/ui/sidebar.tsx`: row `h-8` → `h-[30px]`, icon `size="nav"`, label `font-semibold`, section header `text-[11px] font-semibold`, chevron always visible at 12 px with `opacity-70`, indent `1.25rem` (20 px measured from the row edge, i.e. a 12 px step past the parent's icon because the row already carries 8 px padding).
- `src/styles.css`: no new tokens required; weights are Tailwind utilities.

## 6. Implementation slices

**S1 — icon tokens and registry.** `src/ui/icon.tsx` only. Add the six new keys, repoint the seven changed values, change the default stroke and add the `nav` size. Validation: `npm run typecheck`, then a browser probe that every `IconName` in use still resolves and that stroke computes to 2.

**S2 — sidebar primitives.** `src/ui/sidebar.tsx`. Row height, icon size, label weight, header weight, always-visible chevron, indent, and deferred styling (colour plus icon opacity 0.5; weight unchanged). Validation: component test for `aria-expanded` and chevron rotation; screenshot pair light/dark.

**S3 — information architecture.** `src/app/destinations.ts` and `src/shell/ContextSidebar.tsx`. Replace `REPO_SECTIONS` with `Workspace / Github / System`; move Program out of `MODES` into a `SidebarRow` with children; add `ci`, `specialists`, `skills` as deferred rows; delete the Graph and Repository observability rows; widen `RepoSection.label` to the new union. Keep `RESEARCH_SECTIONS` unchanged. Validation: `shell.test.tsx` (section membership, Program nesting), palette hints in `GlobalSearch.tsx`, Playwright acceptance specs that address sidebar rows by name (`e2e/acceptance/01-sessions.spec.ts:41,45`).

**S4 — verification and record.** Typecheck, `vitest run`, `playwright test`, one screenshot per variant at 264 px, a11y check that the collapsed state is conveyed by `aria-expanded` and not only by rotation. Record the chosen variant and icon set on the Substrate issue before closing.

## 7. Decisions required before S1

1. **Variant** — A, B (recommended) or C.
2. **Program icon** — `Network` (recommended), `Waypoints`, or keep `Briefcase`.
3. **Github Issues icon** — `SquareDot` (recommended), `MessageSquare` (today), or `CircleDotDashed`.
4. **Chevron placement** — after the label (mock) or pinned to the trailing edge of the row. After the label matches today's hover chevron and the section headers; trailing matches Linear.
5. **Program row behaviour** — the row currently navigates to `/program`. If it also toggles, split hit targets: row click navigates, chevron click toggles, `aria-expanded` on the toggle.
6. **Keyboard numbering** — `Mod+1..5` currently maps to MODES in order. New IA has three sections and no single flat mode list. Options: keep a flat shortcut list of five destinations (Issues, Activity, Program, Pull requests, Research) or drop numeric shortcuts in favour of the palette.
7. **Issues glyph** — `CircleDot` (status semantics, recommended) or `square-stack` (Linear's nav glyph).
8. **Agents glyph** — `bot` (fleet semantics, recommended) or `mouse-pointer-2` (Linear's Agent).
9. **Section caret** — stroke `chevron-down` pinned right with an always-visible treatment (recommended, one glyph language across the app) or Linear's filled `triangle` after the label.
10. **Graph / Repository observability** — confirm removal from navigation (routes stay) rather than moving them under Observability.
11. **URLs** — keep `/code/*` and `/work/*` (recommended, zero churn) or rename to `/github/*` in a separate slice.

## 8. Risks

- **Shared registry.** `issues`, `comment`, `program` and `observability` are also used by empty states and inspector fallbacks (`src/issues/IssuesSurface.tsx:95,111`, `src/github/IssuesSurface.tsx:82`, `src/shell/Inspector.tsx:61,241`). Repointing them changes those surfaces deliberately; review each render.
- **Test coupling.** `e2e/acceptance/01-sessions.spec.ts:41,45` and `src/app/shell.test.tsx:35-45` assert sidebar button names and nesting. The Program rename and the mode flattening will require those assertions to be updated in the same change.
- **Deleted rows.** Removing Graph and Repository observability hides two existing deferred destinations. The routes stay; confirm no docs or screenshots still point at them in navigation.
- **Deferred rows remain navigable.** Today deferred rows still navigate to placeholder surfaces. The restyle keeps that behaviour and only changes appearance; confirm this is still wanted.
- **Impact analysis unavailable.** `.gitnexus/run.cjs` is absent in this worktree, so blast radius came from grep + call-site inventory, not the graph. Run `gitnexus impact` on `Icon`, `SidebarRow`, `SidebarSection` and `ContextSidebar` before S2 when the index is available.

## 9. Out of scope

- Agent-half sidebar (`src/agent/AgentSidebar.tsx`) restyle — follow-up slice; it shares `Row` but has its own density.
- Inspector, drawer and command-palette layout changes. The palette inherits the new glyphs automatically because it reads the same registry.
- Font change, colour-token change, route renames (decision 8), and any new surface for the deferred destinations.

## 10. Approved and implemented (XTRM-632)

The operator approved the plan and resolved every decision. Implemented on branch `feature/XTRM-632-sidebar-restyle`.

| # | Decision | Resolution |
| --- | --- | --- |
| 1 | Variant | **B** — 30 px row, 16 px icon at stroke 2, 13 px label, 11 px header, 20 px indent |
| 2 | Project icon | **`Box`** (`program` key), label renamed from Program to **Project** |
| 3 | GitHub Issues icon | **`SquareDot`** |
| 4 | Chevron placement | Pinned to the trailing edge of the section header, always visible at `opacity-70` |
| 5 | Project row behaviour | Row click navigates to `/program`; the trailing chevron toggles the four nested rows (`aria-expanded`) |
| 6 | Keyboard numbering | Unchanged (`Mod+1..5` still map to `MODES` order); revisit with the next IA change |
| 7 | Issues glyph | **`SquareStack`** (Linear's nav glyph) |
| 8 | Agents glyph | **`MousePointer2`** for both `agent` and `agents` keys |
| 9 | Section caret | Stroke `chevron-down`, trailing, always visible |
| 10 | Graph / Repository observability | Removed from navigation; `/system/*` routes still resolve |
| 11 | URLs | Unchanged (`/code/*`, `/work/*`, `/program`) |

Icon repoints beyond the decision list: `observability` → `Radar`, `content` → `FolderTree`, and new keys `ci` → `Workflow`, `specialists` → `UserRoundCog`, `skills` → `Blocks`, `assignment` → `UserRoundCheck`, `decision` → `Gavel`, `changes` → `History` (Recent changes). `done` stays `CheckCircle2` because generic empty states use it.

Grocery list of deviations from the plan above:

- **Weight 650 is not a Tailwind step.** Headers and labels both use `font-semibold` (600). The visual difference from 650 is negligible at 11 px.
- **Deferred styling** is colour only (`text-ink-faint` on the label, muted icon); the planned icon `opacity-0.5` was not added, since the muted icon already reads as disabled.
- **Research is not deferred.** Its Experiments and Recent Runs surfaces are implemented (`src/surfaces/ResearchSurface.tsx`), so the row renders enabled and reveals its four section rows while the route is active — contrary to the brief's "non developed yet" note.
- **CI/CD, Specialists and Skills** are deferred rows that navigate to `DeferredSurface` placeholders (`/code/ci`, `/specialists`, `/skills`), matching the existing deferred convention.
- **`RepoSection.label`** is now `"Workspace" | "GitHub" | "System"`; `Destination` gained an optional `path` so a row can be mode-level (`/program`, `/agents`) or repository-scoped, with `destinationHref()` resolving either.

## 11. Console chrome is one band (XTRM-636, XTRM-637)

Every surface now opens with the same 40px band: `SurfaceToolbar` renders one row of 28px controls at `px-1.5 py-1.5` with `min-h-10`, so a toolbar with a `SourceBadge` and one without measure the same. Tables keep a 32px header row with a single rule beneath it and flush 32px rows; `SurfaceHeader` (the 48 px title band) is deleted, so the old chrome cannot return by accident.

Toolbar tokens live in `src/ui/primitives.tsx`: `TOOLBAR_CONTROL` (28px geometry), `TOOLBAR_REST` (resting `bg-pressed` fill, brighter on hover), `TOOLBAR_GHOST` (tabs and secondary actions). A surface title no longer repeats in the body — the sidebar row that opened it names it.
