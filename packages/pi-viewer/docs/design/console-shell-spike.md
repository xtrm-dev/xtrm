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
| top switcher | `ContextSidebar.tsx` `HalfSwitch` | A `radiogroup` "Workspace": **Work** and **Agent**, in a `bg-pressed` track, 28px high. Agent is the half that holds the agents. |
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
| top switcher | `src/shell/HalfSwitch.tsx` | **copy** of `HalfSwitch`. Agent is selected; Work is inert (no route to it from the viewer yet), with a title that says so. |
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
| switcher | Work / Agent, 28px track | same, Agent selected |
| persistence | `xtrm.console.layout.v1` | same key, same fields |

## Deviations and decisions for the operator

1. **The icon rail is gone on desktop.** The viewer had a 44px rail of status dots when collapsed. The console
   has none (collapsed is 0), and the brief says the same collapse behaviour. The reopen button is in the top bar.
   The rail code was removed from the sidebar; `railNext` stays in `lib/tree.ts` with its test.
2. **The plane is 264px by default, not 240.** An earlier ruling narrowed it to 240 because the indent read too
   wide. The brief asks for the console's width, and the operator can drag to 220. The indent (0.5rem), the row
   heights and the dots are unchanged.
3. **Dark plane colour stays `#181818`** (operator ruling), the console's is `#232323`. The screenshots show the step.
4. **Narrow (390):** the console has no mobile pattern. The viewer keeps its overlay: closed by default, never
   persisted, opened from the reopen button, closed by Escape, a click outside, or choosing a row. It is 264px
   wide and at most 85vw.
5. **Work is inert.** The console's other entries do not exist in the viewer. The second radio says so in its title.
6. **Not adopted:** the console's search pill, command button, account control, settings button, inspector
   drawer and source footer. The viewer has no data behind them.
7. **A dependency change:** `motion-panels` 0.5.2 and `motion` ^13.4.0 in `package.json` and the lockfile.

## Checks

`typecheck`, `npm test`, `npm run build`, and `scripts/sidebar-gate.mjs` (the gate gained the console-shell
checks: width, drag limits, persistence, collapse and reopen focus, Ctrl+B, reload, narrow overlay; the
"collapse to a 44px rail" and "expand to 240px" expectations became "collapse to 0" and "264px").
