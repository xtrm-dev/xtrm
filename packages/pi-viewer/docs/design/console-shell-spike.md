# Console shell spike (XTRM-1044)

Question: what does the viewer look like and how does it behave if it already lived inside the xtrm-app
console? This is a spike. The operator decides after looking whether it stays. `packages/xtrm-app` was read
only; nothing in it changed.

Side-by-side screenshots (console `/agent` on a private vite server, viewer on `:5299`, both 1440 wide):
`docs/design/shots/XTRM-1044/console-{dark,light}-1440.png` and `viewer-{dark,light}-1440.png`.

## How the console shell works (verified by reading the source)

| piece | source | behaviour |
|---|---|---|
| frame | `src/shell/AppShell.tsx` `ShellLayout` | One `motion-panels` `Group`: sidebar panel, 8px resize handle, fill panel. The main column has a 44px top bar (`h-11`). |
| sidebar state | `src/shell/layout.ts` | `SIDEBAR = {default 264, min 220, max 360}`. `sidebar/toggle` keeps `lastExpandedWidth`; `sidebar/resize` clamps. Persisted under `xtrm.console.layout.v1` as `sidebarOpen`, `sidebarWidth`. Motion 250ms, `cubic-bezier(0.32,0.72,0,1)`. |
| collapse | `ContextSidebar.tsx`, `TopBar` | The collapse `IconButton` (`sidebar` icon, label "Collapse sidebar", hint Ctrl B) sits in the 44px sidebar header beside the switcher. **Collapsed is width 0**: there is no icon rail. The reopen button ("Open sidebar") appears at the left of the top bar. The panel is `inert` while collapsed. Ctrl/Cmd+B toggles (`context.tsx`). |
| top switcher | `ContextSidebar.tsx` `HalfSwitch` | A `radiogroup` "Workspace": **Work** and **Agent**, in a `bg-pressed` track, 28px high. Agent is the half that holds the agents. Its other entry has a "Switch to ..." tooltip with the Mod+. hint. |
| resize | `ui/resizable.tsx` | Thin adapter over `motion-panels` 0.5.2. The handle is a labelled `separator` ("Resize sidebar"), 8px hit area, 1px line on hover and focus, keyboard resizable. |
| icons | `ui/icon.tsx` | Lucide registry by name, size ladder `micro 12 / text 13 / xs 14 / sm,nav 16 / md 18 / lg 20` px (rem classes), stroke 2.25 except 2 at `text` and `micro`. |
| button | `ui/primitives.tsx` `IconButton` | 28px square, `text` glyph, `text-ink-muted`, hover and pressed fills, tooltip with the label and a key hint. |
| rows, rails | `ui/sidebar.tsx`, `ui/nav-rail.tsx` | Icon rows and nav rails for the Work half. The viewer's Agent tree is not these rows; it keeps its own (operator rulings), so they are not used. |
| mobile | none | The console shell has no narrow pattern (the panel group is fixed). See deviations. |

## Per piece: import or copy

No piece is imported. Reason, checked in this worktree: `packages/xtrm-app` has no `node_modules` here and
the repository has no workspace root, so a relative import from the viewer resolves `lucide-react`,
`motion-panels`, `@base-ui/react` and `@tanstack/react-router` from the wrong directory, and
`ui/primitives.tsx` pulls the console's adapter types and base-ui tooltip. Making a workspace import work
means a repository-level change (a root `package.json` with workspaces), which is outside this spike.
Each copied file names its source on its first lines.

| piece | viewer file | decision |
|---|---|---|
| icon component, registry subset, size ladder, stroke rule | `src/shell/icon.tsx` | **copy** of `ui/icon.tsx`. The file only imports `lucide-react`, but resolves it from xtrm-app's missing `node_modules`. Only the 7 names the shell uses are registered. |
| `IconButton` | `src/shell/IconButton.tsx` | **copy** of the classes in `ui/primitives.tsx`. The tooltip is Radix (a viewer dependency), not base-ui. |
| resize adapter | `src/shell/resizable.tsx` | **copy** of `ui/resizable.tsx`, with `motion-panels` 0.5.2 (exact pin, as the console) and `motion` ^13.4.0 added to `package.json`. `cx` becomes the viewer's `cn`. |
| limits, clamp, persistence key and shape, motion, Mod+B rule, `isShortcutSuppressed`, `modShortcut` | `src/shell/layout.ts` | **copy** of `shell/layout.ts`, sidebar half only. The reducer is a small hook, since the viewer has no inspector. The stored object keeps unknown fields. |
| top switcher | `src/shell/HalfSwitch.tsx` | **copy** of `HalfSwitch`, including the "Switch to ..." tooltip. The viewer's entry is named **Threads** (operator ruling) and selected; Work looks as in the console and is inert (no route to it from the viewer yet). |
| shell frame | `src/shell/ConsoleShell.tsx` | **copy of the structure** of `ShellLayout`; the console's inspector panel and search are not part of it. |
| sidebar header (44px, switcher, collapse button) | `src/components/sidebar/Sidebar.tsx` | **copy** of the `ContextSidebar` header. |
| top bar 44px, reopen button, theme button | `src/components/ViewerHeader.tsx` | **copy** of the `TopBar` height and reopen rule; the viewer's own scope title and view tabs stay. Theme toggle uses the console's `IconButton` and `sun`/`moon`. |

Kept as the viewer's own, inside the console's container: the session > window > pane tree, scope selection
and URL, role text (Lead and Manager bold and coloured), static status dots, two-line pane rows, the `#181818`
dark plane, the `border-r border-border-subtle` edge, and the `Sessions` section label.

## Measured against the console

| | console | viewer |
|---|---|---|
| expanded width | 264 | 264 (`sidebar-gate`: panel width) |
| drag minimum / maximum | 220 / 360 | 220 / 360 |
| collapsed width | 0 | 0 |
| header height (sidebar and top bar) | 44 | 44 |
| switcher | Work / Agent, 28px track | Work / Threads, 28px track, Threads selected |
| header icon button | main: 28px box, 13px glyph. Refactor: 28px box, 16px glyph (`sm`) | refactor: collapse, reopen, theme and chat-width, 28px box, 16px glyph |
| persistence | `xtrm.console.layout.v1` | same key, same fields |

## Icon ladder (operator ruling: match the refactor, not main)

The console on `main` is the old one. The refactor that has not shipped (previewed on :5179) uses a larger
ladder, and the viewer follows it. Values below are the refactor's sources, as reported by the thread lead
(`src/ui/primitives.tsx`, `src/shell/AppShell.tsx:35`, `src/ui/sidebar.tsx:20,85,100`, `src/ui/row-action.tsx:62`).
`main` still shows 13px chrome: its `IconButton` default glyph is `text`, 13px, and my earlier measurement of
28px boxes with 13px glyphs was correct for `main` only.

| use | box | glyph step | px | viewer |
|---|---|---|---|---|
| top-bar Commands, theme, settings (`IconButton` default) | 28px (`size-7`) | `sm` | 16 | sidebar collapse, reopen, theme, chat width |
| search magnifier | | `sm` | 16 | not in the viewer |
| sidebar destination rows, section chevrons | 28-32px rows | `xs` | 14 | tree chevrons (`SessionTree`), status dot cell, disclosure |
| list row kind glyph, expand chevron; 24px toggle (`size-6`) | | `xs` | 14 | same |
| row hover action | 20px | `text` | 13 | message Copy and Reply |
| inline count marks beside 13px text | | `micro` | 12 | existing `size-3` marks |

`src/shell/icon.tsx` carries the same names: micro 12, text 13, xs 14, sm and nav 16, md 18, lg 20 (stroke 2.25,
2 at `text` and `micro`). The sidebar-gate asserts the 28px box and 16px glyph on the header buttons.

## Decisions (operator, 2026-11-25) and remaining deviations

1. Collapse is the console's: width 0, reopened by the top-bar button or Ctrl/Cmd+B. No dot rail. (Done.)
2. Default width 264, drag 220 to 360. (Done.)
3. The switcher shows Work and Threads, complete as in the console, Threads selected, Work inert. (Done.)
4. Header icon buttons match the refactored console: 28px box, 16px glyph; 14px in rows, 13px hover actions, 12px inline marks (ladder above).

Still different from the console, on purpose: the `#181818` dark plane (the console's is `#232323`); at 390 wide the sidebar is an
overlay (the console has no narrow pattern); no search pill, command button, account control, settings, inspector drawer or source footer
(no data behind them); `motion-panels` 0.5.2 and `motion` ^13.4.0 are added to `package.json`.

## Checks
`typecheck`, `npm test`, `npm run build`, and `scripts/sidebar-gate.mjs` (the gate gained the console-shell
checks: width, drag limits, persistence, collapse and reopen focus, Ctrl+B, reload, narrow overlay; the
"collapse to a 44px rail" and "expand to 240px" expectations became "collapse to 0" and "264px").
