# Conar (`wannabespace/conar`) — UI craftsmanship and primitive adoption audit

> **Console v2 / ISSUE-140 audit artifact.** Read-only source inspection at a pinned revision.
> Audited source: `wannabespace/conar` @ `d50f1d12790a5e3e32b16baaae46c732bd36ff35` — **AGPL-3.0**
> Every load-bearing claim carries a `path:line` reference and is tagged `VERIFIED` (read in source), `INFERENCE` (derived from cited facts), or `UNKNOWN`.
> Conar-owned source is REFERENCE-ONLY. Only permissively licensed underlying dependencies are DEPEND candidates. No Conar source may be vendored.
> Consumed by `adoption-audit.md`, `console-v2-migration-plan.md`, and `xtrm-gui-prd.md`.

---

## 1. Header

| Field | Value | Evidence |
|---|---|---|
| Repository | `https://github.com/wannabespace/conar` (clone at `/tmp/audit-ext/conar`) | — |
| Audited SHA | `d50f1d12790a5e3e32b16baaae46c732bd36ff35` | `git rev-parse HEAD` → `VERIFIED` |
| License | **AGPL-3.0** (GNU AFFERO GENERAL PUBLIC LICENSE, Version 3, 19 Nov 2007) | `LICENSE:1-4` → `VERIFIED` |
| Product identity | Database client (`Postgres, MySQL, MSSQL, Clickhouse`); package scope `@tamery`; product name **"Tamery"**, marketing site `tamery.app`; author Wannabe Space, LLC | `package.json:1-10`, `packages/shared/constants.ts:9-19` → `VERIFIED` |
| Runtime / PM | Bun `>=1.3.0`, `pnpm@11.25.0`, Turborepo, Vite + TanStack Start/Router, React 19.2.8 | `package.json:60-72`, `turbo.json` → `VERIFIED` |
| Workspace shape | `packages: ['packages/*','apps/*']`, `catalogMode: prefer`, catalogs inline, `overrides` from `pkg.pr.new` (better-auth), 1 `patchedDependencies` entry | `pnpm-workspace.yaml:1-20` → `VERIFIED` |
| Apps | `api`, `app` (the desktop/web client — the UI of interest), `cli`, `desktop` (Electron), `main` (marketing site), `proxy` | `ls apps/` → `VERIFIED` |
| Packages | `ai`, `configs`, `connection`, `db`, `infisical`, `query-proxy`, `shared`, `table`, `ui`, `vite-prerender` | `ls packages/` → `VERIFIED` |
| UI kit | `packages/ui` → `@tamery/ui`, private, **no build step** (raw TS/TSX consumed via `exports` map), component count ≈ 60 + subfolders `aceternity/`, `brand/`, `custom/`, `icons/`, `react-flow/`, `tanstack-form/` | `packages/ui/package.json:4-22`, `ls packages/ui/src/components` → `VERIFIED` |

Notable environment constraint: **`node_modules` is not installed** in the clone. Every dependency version below is resolved from `pnpm-lock.yaml` (deterministic, `lockfileVersion` pinned), and every licence is resolved from the publishing registry's per-version metadata, not from assumption.

---

## 2. Double-sidebar analysis (key deliverable)

### 2.1 Structural verdict first

Conar does **not** have a persistent global icon rail. `VERIFIED`.

The application shell is a **top title bar + left contextual sidebar + workspace + collapsible bottom panel + right contextual panel**, all inside one `motion-panels` resizable group.

Definitive negative evidence:

- The entire left-to-right shell is composed in `apps/app/src/routes/_protected/connection/$resourceId.tsx:115-179`. It renders exactly three panel slots: navigator, workspace (with nested vertical logger), chat. No fourth, narrow, icon-only slot exists.
- The navigator is **route-scoped, not global**: it is rendered only inside the `/connection/$resourceId` route. The dashboard route renders no sidebar at all (`apps/app/src/routes/_protected/index.tsx:9-15`).
- Repo-wide search for `icon-rail|rail|activity-bar|navbar|nav-rail|thumbbar|dock` in `apps/**` and `packages/**` returns only marketing-site `Navbar*` hits and Electron `app.dock` calls — no rail component. `VERIFIED`
- The product's own minimum-window copy confirms the real layout intent: *"Tamery needs at least {MIN_WINDOW_WIDTH} × {MIN_WINDOW_HEIGHT} points to show **the navigator, tabs and chat side by side**"* (`apps/app/src/components/window-too-small.tsx:39-42`), with `MIN_WINDOW_WIDTH = 900`, `MIN_WINDOW_HEIGHT = 600` (`packages/shared/constants.ts:11-12`). So the "double sidebar" the operator noticed is **navigator (left) + chat (right)**, not rail + sidebar. `VERIFIED`

Therefore the operator's framing "persistent global icon rail + contextual collapsible sidebar" is a **mis-attribution**: Conar has a **double contextual sidebar (left navigator, right chat) around a tabbed workspace**, and a **third** contextual collapsible surface at the bottom (query logger). See §6.

### 2.2 Left contextual sidebar — the Navigator

| Property | Value | Evidence |
|---|---|---|
| Container | `motion-panels` `<ResizableGroup orientation="horizontal" className="p-2">` | `…/$resourceId.tsx:116` |
| Panel declaration | `<ResizablePanel size={navigatorWidth} onSizeChange=… defaultSize={SIDEBAR_DEFAULT_WIDTH} minSize={SIDEBAR_MIN_WIDTH} maxSize={SIDEBAR_MAX_WIDTH} collapsed={!navigatorOpened} onCollapsedChange=…>` | `…/$resourceId.tsx:117-128` |
| Width | default **280px**, min **220px**, max **50%** | `apps/app/src/lib/constants.ts:5-7` |
| Resize handle | sibling `<ResizableSeparator aria-label="Resize navigator" />` | `…/$resourceId.tsx:131` |
| Collapse behaviour | `collapsed` is passed straight to `motion-panels`; the library animates panel extent to **0** | `…/$resourceId.tsx:126`; `motion-panels@0.4.0 dist/core-BulrhmUL.js:400,413` (`const value = next.collapsed ? 0 : measured`) → `VERIFIED` |
| Reopen affordance | **Not a rail.** Two paths only: (a) toolbar button `aria-label="Toggle sidebar"` with `SidebarLeftIcon` + tooltip + `Mod+B` hint, living in the *workspace* tab bar (`…/-components/tab-bar.tsx:914-932`); (b) keyboard `Mod+B` (`…/-components/tab-bar.tsx:863-866`) | `VERIFIED` |
| Drag-to-reopen | Dragging the 1px separator right from a collapsed state reopens; the library's collapse trigger is `pixels < min / 2`, so the drag must first jump the clamp to `minSize` (220px) | `motion-panels dist/core-BulrhmUL.js:334-335` → `VERIFIED` |
| Keyboard on the separator | `role="separator"`, `tabIndex=0`, `aria-valuenow/valuetext/valuemin/valuemax`; `Enter` toggles collapse, `Arrow/Home/End/PageUp/PageDown` resize; RTL-aware | `motion-panels dist/core-BulrhmUL.js:355-377,524-528,597` → `VERIFIED` |
| Separator visual | 1px strip, gradient fill on `hover`/`focus-visible`/`active`, plus a `hit-area-1` pseudo-element that expands the hit region ~4px each side; honours library state attributes `data-resizing` (100% opacity) and `data-crossing` (40%) | `packages/ui/src/components/custom/resizable.tsx:13-27`; `packages/ui/src/styles/globals.css:338-348`; `motion-panels dist/core-BulrhmUL.js:513-514` |
| Collapse-state persistence | `seitu` web-storage value, `localStorage`, key `navigator-open`, default `true` | `…/-components/navigator/constants.ts:6-11` |
| Width persistence | `localStorage` key `navigator-width` | `apps/app/src/lib/constants.ts:4`; `…/$resourceId.tsx:65-68,119` |
| Enter animation | Panel gets `initial={{scale:0.85}} animate={{scale:1}}` plus `className="origin-left"` | `…/$resourceId.tsx:122-124` |

Navigator internals (`…/-components/navigator/navigator.tsx:157-182`):

```tsx
// …/-components/navigator/navigator.tsx:162-181
<div className="text-foreground flex h-full flex-col pr-1.5">
  <div className="shrink-0 pt-0.5 pb-1.5 pl-2"><NavigatorSwitcher /></div>
  <div className="relative flex min-h-0 flex-1 flex-col">
    <AnimatePresence initial={false} mode="popLayout">
      <motion.div key={navigator} initial={{opacity:0,x:…±12}} animate={{opacity:1,x:0}} … />
```

The navigator is a **two-mode contextual sidebar**, not a static tree: `tables` ⇄ `definitions`, switched by `NavigatorSwitcher` (`…/-components/navigator/navigator-switcher.tsx:21-75`) and animated with a directional 12px slide at `duration 0.18, ease [0.32,0.72,0,1]` (`navigator.tsx:170-173`).

### 2.3 Right contextual sidebar — Chat panel

| Property | Value | Evidence |
|---|---|---|
| Declaration | `<ResizablePanel size={chatWidth} defaultSize={CHAT_DEFAULT_WIDTH} minSize={CHAT_MIN_WIDTH} maxSize={CHAT_MAX_WIDTH} collapsed={!chatOpened} initial={{translateX:'100%'}} animate={{translateX:'0'}}>` | `…/$resourceId.tsx:165-177` |
| Width | default **380px**, min **300px**, max **50%** | `apps/app/src/lib/constants.ts:9-12` |
| Resize handle | `<ResizableSeparator aria-label="Resize chat" />` | `…/$resourceId.tsx:164` |
| Reopen affordance | `ChatToggle` button in the tab bar's right cluster, `aria-label="AI chat"`, `aria-pressed`, `Mod+L` | `…/-components/tab-bar.tsx:446-492`, hotkey at `:465-468` |
| Enter animation | `translateX: 100% → 0` (motion) | `…/$resourceId.tsx:169-170` |
| Collapse-state persistence | `chatOpened` inside per-resource `localStorage` key `connection-resource-store-<id>` | `apps/app/src/entities/connection/store/stores.ts:46-84` |

### 2.4 Sidebar ⇄ sidebar relationship

Both sidebars are members of the **same** horizontal `ResizableGroup` (`…/$resourceId.tsx:116-178`). Consequences verified from `motion-panels` semantics:

- The middle workspace is the **fill panel** (`<ResizablePanel className="flex flex-col">` with no `size`, `…/$resourceId.tsx:132`); it absorbs every pixel not taken by the two sized panels. There is no `flex-basis` bookkeeping in Conar itself — the library owns `available()`/`bounds()` arithmetic (`motion-panels dist/core-BulrhmUL.js:265-282`).
- Collapsing either sidebar is **not a width=0 sibling shift only**: the library distinguishes panel `size` (outer) from `content` (inner) motion values and only zeroes both on collapse (`core:400-413`), then anchors the fill (`setFolding`, `core:290-297`). This is what keeps the remaining panel from visually "squishing" during the fold.
- Both sidebars therefore **compete for the same budget**; `maxSize: '50%'` on each (`constants.ts:6,11`) plus `MIN_WINDOW_WIDTH = 900` (`packages/shared/constants.ts:11`) is the whole responsive story. There is no media-query-based rail switching at any breakpoint. `VERIFIED`

### 2.5 Bottom contextual panel — Query logger (third collapsible surface)

`<ResizableGroup orientation="vertical">` nested inside the workspace fill (`…/$resourceId.tsx:133-162`), logger default **240px**, min **120px**, max **60%** (`constants.ts:14-17`), `collapsed={!loggerOpened}`, enter animation `translateY: 100% → 0` (`…/$resourceId.tsx:148-149`), reopened from the title bar (`…/-components/protected-titlebar.tsx:326-364`, `Mod+J` at `:337-340`) or the command palette (`…/actions-center.tsx:332-343`). The runner tab repeats the same vertical-collapse idiom (`…/-tabs/runner/-components/runner/runner.tsx:198,285,292`).

### 2.6 Top bar (breadcrumb + global action cluster)

`ProtectedTitleBar` (`…/-components/protected-titlebar.tsx:436-522`) is 41px tall (`apps/app/src/shell.tsx:4-5`), holds logo → workspace switcher → connection breadcrumb (dropdown → submenu → dropdown, `:64-253`) and a right cluster with auto margin (`ml-auto`, `:473`): version chip, update, open-in-web, query logger toggle, command palette, `UserButton`. Electron drag region is applied conditionally (`apps/app/src/components/title-bar.tsx:31-33`, CSS at `globals.css:185-191`).

### 2.7 Icon family, sizing, alignment

- **Single icon family: Hugeicons.** `@hugeicons/react` `HugeiconsIcon` + `@hugeicons/core-free-icons`; 110 files import it, 444 `HugeiconsIcon` render sites, ~118 distinct icon identifiers. No second icon library exists in the repo. `VERIFIED` (`grep` over `apps/**`,`packages/**`)
- Brand/database glyphs are the only hand-written SVGs (`apps/app/src/icons/{postgres,mysql,mssql,clickhouse,mongo}.tsx`, `packages/ui/src/components/brand/`, `packages/ui/src/components/icons/linux.tsx`).
- Size convention: literal `size-4` on sidebar/nav icons with `shrink-0` (e.g. `…/-components/navigator/definitions-section.tsx:185-194`), `size-3.5` for secondary/chevron glyphs (`navigator-switcher.tsx:68`), `size-4` default enforced centrally by `[&_svg:not([class*='size-'])]:size-4` in `buttonVariants` (`packages/ui/src/components/button.utils.ts:4`) and `[&_svg]:size-4 [&_svg]:shrink-0` in the sidebar row primitives (`…/-components/navigator/primitives.tsx:57,85,142`).
- `strokeWidth={2}` is passed explicitly at essentially every call site (e.g. `definitions-section.tsx:187`, `tab-bar.tsx:926`, `protected-titlebar.tsx:505-509`) — there is no wrapper enforcing it. `INFERENCE`: convention, not a guardrail.

### 2.8 Tooltip implementation

`@base-ui/react/tooltip` wrapper in `packages/ui/src/components/tooltip.tsx`:

- Provider default `delay = 100` (`tooltip.tsx:4-13`).
- `TooltipContent` = Portal → Positioner (`sideOffset = 4`, `align = 'center'`) → Popup, plus an arrow; surface `bg-foreground text-background`, `rounded-xl px-3 py-1.5 text-xs`, `z-50` (`tooltip.tsx:23-57`).
- Trigger is composition-based (`render={…}` prop), which is why icons-only buttons can be wrapped without an extra DOM node (`…/-components/tab-bar.tsx:914-932`).
- Kbd hints are embedded in tooltips via `KbdCtrlLetter` (`tab-bar.tsx:928-931`), and the tooltip popup has dedicated `[data-slot=kbd]` restyling (`tooltip.tsx:47`).

### 2.9 Layout mechanism, z-index, and surface treatment

- **Mechanism: flex, not grid, not CSS resizable.** `motion-panels`' `Group` renders `display:flex; flexDirection:axes.direction; height:100%; width:100%; overflow:clip` (`motion-panels dist/react/index.js`, `Group`). Panels set `flexShrink:0` and animate their own `width`/`height` via a Motion value (`SizedPanel` in the same file). Underneath is **plain DOM + Motion**, explicitly *not* `react-resizable-panels` (`motion-panels/README.md`: "no layout library underneath").
- **z-index:** the kit's overlays are all `z-50` (tooltip positioner/popup `tooltip.tsx:42,47`; dialog content `dialog.utils.ts:4`; drawer overlay `drawer.tsx:108`; drawer viewport/popup `drawer.tsx:147,155`; command dialog `command.tsx:64`). In-app stacking above that: `z-60` (sonner wrapper, `packages/ui/src/components/sonner.tsx:22`), `z-100` (window-too-small full-screen block, `window-too-small.tsx:30`), `z-1000` (custom drag overlay, `custom/resize-handle.tsx:10`). Resize separators get `z-30` (`custom/resizable.tsx:20`). `VERIFIED`
- **Panel surface:** every workspace panel uses `resourcePanelClassName = 'bg-background ring-foreground/4 … rounded-xl ring-[0.5px]'` (`apps/app/src/shell.tsx:7-8`), i.e. a 0.5px hairline ring, not a border — the same device is reused by cards (`packages/ui/src/components/card.tsx:13`) and dialogs (`dialog.utils.ts:4`).

### 2.10 Focus, keyboard and a11y discipline in the shell

Plainly better than average, and cheaply transferable:

| Concern | Implementation | Evidence |
|---|---|---|
| Icon-only controls | Every icon-only button carries an explicit `aria-label` (`"Toggle sidebar"` `TB:920`, `"Query logger"` `PTB:349`, `"Command palette"` `PTB:500`, `"AI chat"` `TB:477`, `"New tab"` `TB:380`) and toggles expose `aria-pressed` (`PTB:350`, `TB:478`) | `VERIFIED` |
| Focus visibility | One shared utility `focus-ring` = `ring-ring/50 ring-3` (`GLOBALS:334-336`), applied via `focus-visible:focus-ring` on every row/button variant (`button.utils.ts:4`, `NAV/primitives.tsx:57,85,142`, `item.utils.ts:4`) | `VERIFIED` |
| Resize separators | `role="separator"` + `tabIndex=0` + `aria-label` per separator + `aria-valuenow/valuetext/valuemin/valuemax` injected by `motion-panels`; visible feedback via `data-resizing` / `data-crossing` attributes rather than JS state | `UID/resizable.tsx:13-27`; `motion-panels dist/core-BulrhmUL.js:513-528` |
| Decorative SVG | Breadcrumb chevrons marked `aria-hidden` (`PTB:455-460,462-467`) | `VERIFIED` |
| Presentational chrome | The prerender skeleton is `aria-hidden` and `pointer-events-none` (`apps/app/src/shell.tsx:20-25,78-86`) | `VERIFIED` |
| Dialog fallback | `CommandDialog` renders an `sr-only` `DialogHeader` with title + description so the palette always has an accessible name (`UI/command.tsx:42-60`) | `VERIFIED` |
| Skeleton realism | Sidebar skeletons derive their bar width from a seeded pseudo-random function instead of a fixed width (`NAV/primitives.tsx:100-130`, `@tamery/shared/utils/helpers` `pseudoRandom`) | `VERIFIED` |
| Reduced motion | Global `@media (prefers-reduced-motion: reduce)` kill-switch for animation/transition durations (`GLOBALS:143-152`), and `motion-panels` itself subscribes to `reducedMotion` (`dist/react/index.js`, `useStore(reducedMotion.subscribe, reducedMotion.get)`) | `VERIFIED` |
| Known gap | Tooltip content is `pointer-events-none` (`tooltip.tsx:42`) — correct for hints, but it means no tooltip in the shell is interactive (no action buttons inside tooltips). `INFERENCE`: deliberate constraint, relevant if XTRM plans actionable tooltips on a rail. | `VERIFIED` (CSS), `INFERENCE` (intent) |

### 2.11 Electron-only surfaces that must not be mistaken for the web shell

The shell branches on `window.electron` in several places, and two global CSS blocks only apply under `.electron`:

- Translucent window surfaces: `--surface-alpha` becomes `0.4` (light) / `0.5` (dark) on macOS non-fullscreen without an open overlay (`GLOBALS:125-131`), and `body`/`--body`/`--background` consume it (`GLOBALS:72,101-102,222`).
- Title-bar inset for traffic lights / window controls: `apps/app/src/components/title-bar.tsx:31-33` plus `GLOBALS:185-191` (`pl-20` on macOS, `pr-34` elsewhere).
- Select-none and app-region rules (`GLOBALS:193-238`) with `-webkit-app-region: drag` on the title bar and `no-drag` on every interactive element.
- Window-blurred primary-colour desaturation (`GLOBALS:133-141`).
- Electron-gated controls: window history back/forward (`TB:305-350`, returns `null` on web), open-in-web (`PTB:372-434`), update badge (`PTB:474-490`), and the minimum-size gate is a media query rather than an Electron API (`window-too-small.tsx:15-17`).

`INFERENCE`: an XTRM rail designed from these surfaces will need an explicit equivalent for three states Conar handles — blurred window, non-fullscreen macOS, and sub-minimum window size.

---

## 3. Primitive / adoption matrix

Path shorthand used in the table (each expands to an exact path):

- `RES` = `apps/app/src/routes/_protected/connection/$resourceId.tsx`
- `NAV` = `apps/app/src/routes/_protected/connection/$resourceId/-components/navigator/`
- `TB` = `apps/app/src/routes/_protected/connection/$resourceId/-components/tab-bar.tsx`
- `PTB` = `apps/app/src/routes/_protected/-components/protected-titlebar.tsx`
- `ACT` = `apps/app/src/routes/-components/actions-center.tsx`
- `UI` = `packages/ui/src/components/`
- `UID` = `packages/ui/src/components/custom/`
- `GLOBALS` = `packages/ui/src/styles/globals.css`

| primitive | Conar source ref (path:line) | underlying dependency | exact dep version | dep license | disposition | reason | XTRM consumer surface |
|---|---|---|---|---|---|---|---|
| Persistent icon-only global rail | *(no such component)* — absence proven by `RES:115-179`, `apps/app/src/routes/_protected/index.tsx:9-15`, repo-wide `rail/activity-bar` grep | n/a | n/a | n/a | **REJECT** | Pattern does not exist in Conar; nothing to adopt, and the operator's premise is unmet by the product | XTRM must build its own rail; Conar supplies no evidence for it |
| Contextual collapsible sidebar (navigator) | `RES:117-131`; widths `apps/app/src/lib/constants.ts:5-7`; persistence `NAV/constants.ts:6-11` | `motion-panels` (+`motion`) | 0.4.0 (motion 13.2.0) | MIT | **DEPEND** | Exactly the mechanism XTRM needs: sized panel, `collapsed`/`onCollapsedChange`, pixel/percent sizes, real fold animation, keyboard + drag on the separator, RTL | XTRM contextual sidebar collapse/expand and resize, with `minSize`/`maxSize`/`defaultSize` |
| Sidebar ⇄ sidebar relationship (left navigator, right chat, single group) | `RES:116-178` (one `ResizableGroup`, three panels, middle fill) | `motion-panels` fill panel + `available()`/`bounds()` | 0.4.0 | MIT | **DEPEND** | Proves multi-sidebar arbitration with a fill center; XTRM gets the same for rail-adjacent and inspector-adjacent panels without writing width math | XTRM workspace layout with left + right panels sharing one budget |
| Collapse-to-rail (narrow rounded reopen handle) | Collapse target is extent 0: `motion-panels dist/core-BulrhmUL.js:400,413`; reopen is a toolbar button: `TB:914-932` | `motion-panels` (mechanism) + Conar's own button (affordance) | 0.4.0 | MIT | **ADAPT** | Library gives the animation and the 1px focusable separator; it does **not** reserve a rounded rail. XTRM must supply the rail element itself as a fixed-size panel (or a sibling of the group) instead of `collapsed` | XTRM "collapse to narrow rounded reopen rail" — library + ~30 lines of XTRM-owned chrome, not Conar's code |
| Drag-to-collapse threshold / drag-to-reopen | `motion-panels dist/core-BulrhmUL.js:319-353` (`pixels < session.min / 2` ⇒ collapse; drag out ⇒ reopen) | `motion-panels` | 0.4.0 | MIT | **DEPEND** | Behavioural affordance XTRM wants (rail reappears by dragging the hairline), already implemented and pointer-capture-safe | XTRM sidebar drag-to-collapse gesture |
| Sidebar separator (visible + accessible + hit area) | `UID/resizable.tsx:13-27`; hit-area utility `GLOBALS:338-348`; state attrs consumed: `data-resizing`, `data-crossing` | `motion-panels` `Separator` (renders `role="separator"`, `tabIndex=0`, `aria-*`) | 0.4.0 | MIT | **DEPEND** | Small, high-value wrapper: 1px gradient strip + hit-area trick + `z-30`; a11y/ARIA comes free from the library | XTRM panel splitter with hover/focus affordance and a11y |
| Menu hierarchy (top-level → submenu → items, radio/checkbox groups, labels, separators) | `PTB:64-253` (nested `DropdownMenuSub`); kit `UI/dropdown-menu.tsx:1`; `UI/context-menu.tsx:1`; app wrapper `apps/app/src/components/app-context-menu.tsx:1-30` | `@base-ui/react/menu`, `@base-ui/react/context-menu` | 1.7.0 | MIT | **DEPEND** | `@base-ui/react` is the MUI Base UI primitive layer; menu/submenu/checkbox semantics are upstream, Conar only styles | XTRM menus, submenus, context menus, native-bridge menus |
| Sidebar row/list row primitives (button, action-on-hover, group label, menu, content) | `NAV/primitives.tsx:12-152` (`SidebarContent`, `SidebarMenu`, `SidebarMenuItem`, `SidebarMenuButton:43-69`, `SidebarMenuAction:71-98`, `SidebarMenuSkeleton:100-130`, `SidebarGroupLabel:132-152`) | local (built on `@base-ui/react/use-render` + `merge-props`) + `cn` | base-ui 1.7.0; `cn` 0.2.4 | MIT; MIT | **REFERENCE** | These are Conar-owned AGPL files lifted in shape from shadcn's `sidebar` block. Behaviour is generic; the code is not usable as-is | XTRM can re-derive the same slot/class shape from shadcn's MIT sidebar source or write its own |
| Second, conflicting sidebar-row primitive (`h-7 rounded-md` vs `h-8 rounded-xl`) | `apps/app/src/components/sidebar-link.tsx:7-46` (used only by `…/table/…/seed-panel.tsx:631`) vs `NAV/primitives.tsx:57` | local + `cn` | `cn` 0.2.4 | MIT | **REJECT** | Duplicate row primitive with different heights/radii in the same product; adopting either would bake in an inconsistency. `UNKNOWN` whether intentional per-surface | XTRM should pick one row spec; neither Conar variant is normatively better |
| Icon family / sizing / alignment | 444 sites; e.g. `NAV/definitions-section.tsx:185-194`, `TB:926`, `PTB:505-509`; central default `UI/button.utils.ts:4` | `@hugeicons/react` + `@hugeicons/core-free-icons` | 1.1.10 / 4.3.0 | MIT | **DEPEND** | Single-family icon policy with a thin `HugeiconsIcon` wrapper, `IconSvgElement` typing for icon props, and a `[&_svg]:size-4` default — a clean, licence-clean substitute for a bespoke icon layer | XTRM icon layer, icon prop typing (`IconSvgElement`-style), size defaults |
| Selected / hover / focus states | `NAV/primitives.tsx:57` (`hover:bg-accent … data-active:bg-accent data-active:font-medium focus-visible:focus-ring`); `sidebar-link.tsx:12-16,41` (active = `bg-primary text-primary-foreground`); focus util `GLOBALS:334-336` (`ring-ring/50 ring-3`) | local Tailwind v4 + token set | tailwindcss 4.3.3 | MIT | **REFERENCE** | Token names (`accent`, `primary`, `muted-foreground`) and the `focus-ring` utility are generic ideas; the concrete class strings are Conar's | XTRM focus/hover/active conventions; do not copy strings verbatim |
| Section hierarchy (grouped lists with group labels) | `NAV/definitions-section.tsx:76-116` (`schemaGroups`) → `:158-203` renders `SidebarMenu` + `SidebarGroupLabel` + rows; tables variant `NAV/tables-list.tsx:116-145,573-641` | local + `@tanstack/react-router` links | — | MIT | **REFERENCE** | Data-driven grouping (`{label, items}` → grouped `<ul>`) is a shape, not a component | XTRM grouped-nav data model |
| Buttons + button variants | `UI/button.utils.ts:3-32` (cva: `default/destructive/ghost/link/outline/secondary/warning` × `default/icon/icon-lg/icon-sm/icon-xs/lg/sm/xs`) | `class-variance-authority` | 0.7.1 | **Apache-2.0** | **REFERENCE** | Variant/size matrix is the standard shadcn shape; the class strings are Conar-specific (incl. `active:translate-y-px`, `aria-invalid:ring-3`) | XTRM should own its own button cva; CVA itself is `DEPEND` (Apache-2.0, attribution + NOTICE obligations apply) |
| Menus (dropdown) | `UI/dropdown-menu.tsx:1-5`, consumed `PTB:143-206`, `TB:374-443` | `@base-ui/react/menu` | 1.7.0 | MIT | **DEPEND** | As above; also proves render-prop composition (`<DropdownMenuTrigger render={<Button …/>}>`) | XTRM dropdowns and submenus |
| Popovers | `UI/popover.tsx:1-3`; used at `…/-tabs/runner/…/runner.tsx:43-62` (saved-queries popover) | `@base-ui/react/popover` | 1.7.0 | MIT | **DEPEND** | Upstream positioning/dismiss semantics; Conar adds only surface classes | XTRM popovers, inline pickers |
| Tooltips | `UI/tooltip.tsx:4-57`; provider mounted app-wide at `apps/app/src/routes/__root.tsx:49` | `@base-ui/react/tooltip` | 1.7.0 | MIT | **DEPEND** | `delay=100` default, arrow, render-prop trigger, `[data-slot=kbd]` styling — directly reusable design decision | XTRM tooltips on icon-only controls, with hotkey hints inside |
| Command palette / autocomplete | `ACT:404-461` (`CommandDialog` + `Command` + `CommandList` + `CommandGroup` + `defaultFilter` manual scoring `:377-402`); kit `UI/command.tsx:1-72` | `cmdk` (and Conar's own `UI/dialog.tsx` = Base UI dialog) | cmdk 1.1.1 | MIT | **DEPEND** | `cmdk` is used for list/keyboard/filter only; the dialog shell is Conar's. Conar also demonstrates `shouldFilter={false}` + custom score sort, which is the non-obvious part | XTRM command palette / fuzzy list |
| Tabs | `UI/tabs.tsx:1-5`, `UI/tabs.utils.ts:3-17` (`default`/`bar`/`line` variants) | `@base-ui/react/tabs` + cva | 1.7.0; 0.7.1 | MIT; Apache-2.0 | **DEPEND** (tabs) / **REFERENCE** (variant matrix) | Tab semantics upstream; the variant list is Conar styling | XTRM tab strips and segmented controls |
| Dialogs | `UI/dialog.tsx:1-8`, `UI/dialog.utils.ts:3-16` (`default`/`panel` variants) | `@base-ui/react/dialog` | 1.7.0 | MIT | **DEPEND** | Removes the need to write focus-trap/portal/Escape logic | XTRM modal dialogs |
| Sheets / drawers / inspector | `UI/drawer.tsx:36-67` (Root with `modal`, `snapPoints`, `swipeDirection`), overlay `:101-108`, viewport `:144-147`, popup `:149-176`; consumer `…/-tabs/table/-components/table/drafts-review-drawer.tsx:135-146` | `@base-ui/react/drawer` | 1.7.0 | MIT | **DEPEND** (primitive) / **REJECT** (Conar's overlay scoping — see §6) | Supports non-modal drawers and snap points, which XTRM needs for an inspector that must not block the rail; but Conar mounts it in a `fixed inset-0 z-50` viewport | XTRM inspector/drawer primitive; XTRM must scope its host element per §6 |
| Cards / panels | `UI/card.tsx:4-18` (+`card.motion.tsx`); app panel class `apps/app/src/shell.tsx:7-8` (`rounded-xl ring-[0.5px]`); dialog/drawer radius `min(var(--radius-4xl),24px)` | local (Tailwind v4 utilities only) | tailwindcss 4.3.3 | MIT | **REFERENCE** | Surface recipe (hairline ring, no border, capped radius) is the strongest *visual* lesson here; it is a few class strings, not code | XTRM panel/card surface spec |
| Row/list primitives (content rows) | `UI/item.tsx:1-7`, `UI/item.utils.ts:3-39` (cva: `default/muted/outline` × `default/sm/xs`, media variants `default/icon/image`) | cva + `@base-ui/react/use-render` | 0.7.1; 1.7.0 | Apache-2.0; MIT | **REFERENCE** | Generic row-with-media layout; no unique mechanism | XTRM list rows (connections list uses its own `ConnectionCard`, `apps/app/src/routes/_protected/-components/connections-list.tsx:359,498`) |
| Sidebar row badge/indicator/count chips | `UI/badge.utils.ts` (via badge.tsx), `custom/indicator.tsx`, count chip at `…/runner.tsx:55-57` | cva | 0.7.1 | Apache-2.0 | **REFERENCE** | Styling only | XTRM nav counters |
| Spacing + typography scale | `GLOBALS:20-68` (`@theme inline`): `--text-2xs: 0.6875rem`/`0.875rem`, `--font-sans: Geist Variable`, `--font-mono: Geist Mono Variable`, radius scale `--radius: 0.4rem` with `sm/md/lg/xl/2xl/3xl/4xl` multipliers, shadow scale `2xs…2xl`; prose layer `packages/ui/src/styles/typography.css:1-45` | tailwindcss v4 + `@fontsource-variable/geist{,-mono}` + `@tailwindcss/typography` | 4.3.3; 5.3.0; 0.5.20 | MIT; **OFL-1.1**; MIT | **REFERENCE** (scale values) / **DEPEND** (fonts) | The scale is opinionated and clean but is Conar's; the fonts are freely redistributable (OFL-1.1) if XTRM wants the same look | XTRM type/space/radius scale design; font packages directly |
| Dark/light surface hierarchy | `GLOBALS:70-98` (`:root`) vs `:100-123` (`.dark`) with `--body/--background/--card/--popover` in OKLCH; `--surface-alpha` for Electron translucency `:125-141`; theme persistence `packages/ui/src/theme-store.ts:11-44`; FOUC guard `theme-observer.tsx:6-19` | `seitu` (`createWebStorageValue`, `createMediaQuery`, `createComputed`) + Tailwind v4 `.dark` variant `GLOBALS:18` | 0.16.1 | MIT | **DEPEND** (seitu + approach) / **REFERENCE** (values) | Four-tier surface ladder (`body < background < card < popover`) plus a single `--surface-alpha` knob is a genuinely reusable pattern; the OKLCH values are Conar's | XTRM surface tokens + theme persistence + no-flash bootstrapping |
| Motion / panel transitions | `motion-panels` for folds (`RES:117-177`); `motion/react` for mode switches (`NAV/navigator.tsx:167-178`), tab reorder (`TB:940-971`, `Reorder.Group`/`Reorder.Item:658-756`), overlay fades (`window-too-small.tsx:23-31`); shared easing `[0.32,0.72,0,1]` | `motion` (+ `motion-panels` built on it) | 13.2.0 (panels 0.4.0) | MIT | **DEPEND** | Same library XTRM would pick; Conar proves the layout-animation integration (Motion values driving panel extent, `layout="position"` on reorderable tabs) | XTRM panel transitions, list reorder, overlay motion |
| Virtualization | `packages/ui/src/hooks/use-virtualizer.ts:1-27`; consumers `NAV/tables-list.tsx:23,485`; `packages/table/src/provider.tsx:1,33,44` | `@tanstack/react-virtual` | 3.14.10 | MIT | **DEPEND** | Thin, opinionated re-export (`measure`, `scrollToIndex`, `totalSize`, `virtualItems`) used for both sidebar tree lists and the data grid — proof the same hook serves a 220px rail and a full grid | XTRM virtualized lists/tables |
| Keyboard navigation / hotkeys | 13 `useHotkey` call sites, e.g. `TB:863-866` (`Mod+B` sidebar), `PTB:337-340` (`Mod+J` logger), `ACT:235-238` (`Mod+P` palette), `TB:465-468` (`Mod+L` chat), `runner-alert-dialog.tsx` (`Mod+Shift+Enter`); motion-panels separator keys (see §2.2) | `@tanstack/react-hotkeys` (+ `motion-panels` for separator) | 0.10.0; 0.4.0 | MIT | **DEPEND** | Central hotkey registration with `enabled` gating and `e.preventDefault()` idiom; plus library-provided separator keyboard semantics | XTRM global hotkeys and panel keyboard control |
| Kbd chips | `UI/kbd.tsx:3-20`; variants `UID/shortcuts.tsx:12-60` (OS-aware Ctrl/Cmd swap) | local + `@tamery/shared/utils/os` | — | MIT | **REFERENCE** | Generic `kbd` element + OS-aware modifier rendering; a few class strings | XTRM shortcut hint chips |
| Scroll areas + scroll affordances | Two coexisting: native wrapper `UID/scroll-area.tsx:4-13` (tailwind-scrollbar) and Base UI wrapper `UI/scroll-area.tsx:1-2`; `scroll-fade` / `no-scrollbar` utilities | `tailwind-scrollbar`, `@base-ui/react/scroll-area`, `shadcn` preset CSS | 4.0.2; 1.7.0; 4.20.1 | MIT; MIT; MIT | **DEPEND** (shadcn CSS + tailwind-scrollbar) / **REFERENCE** (which wrapper to use) | `scroll-fade` (mask + `@property` + `scroll()` timeline) and `no-scrollbar` are shipped by the MIT `shadcn` package, reusable directly; Conar's dual wrappers are an inconsistency | XTRM scroll containers, fade masks, hidden scrollbars |
| Toasts | `UI/sonner.tsx:1-22` (custom icons, `z-60` wrapper) | `sonner` | 2.0.8 | MIT | **DEPEND** | Standard toaster, restyled; `z-60` above overlay stack is the useful detail | XTRM notifications |
| Inspector / side panel (right rail) | `RES:165-177` + `…/-components/chat/chat-panel.tsx:27-60` | `motion-panels` | 0.4.0 | MIT | **DEPEND** | Proves an inspector-style right panel with independent size/collapse in the same group as the left sidebar | XTRM inspector rail |
| Drag overlay during resize | `UID/resize-handle.tsx:5-91` (`z-1000` fixed overlay, `document`-level listeners, no pointer capture) | local | — | — | **REJECT** | Superseded in the same repo by `motion-panels` separators (pointer capture, ARIA, keyboard, RTL). Keep as a cautionary artifact only | Do not port; use separator primitives |
| Decorative overlays (dither/blur backgrounds, animated logo, hover text) | `UID/dither-background.tsx`, `UID/blur-gradient.tsx`, `custom/` brand motion | `@paper-design/shaders-react` | 0.0.80 | **Apache-2.0** | **REJECT** | Marketing-funnel identity weight; Apache-2.0 adds NOTICE obligations | XTRM has no product need |
| Aceternity-derived effects | `UI/aceternity/flip-words.tsx:1-6`, `UI/aceternity/text-hover-effect.tsx:1-6` (no licence header, folder named after Aceternity UI) | `motion` (+ local SVG masks) | 13.2.0 | MIT (motion) | **REJECT** | Procedural/marketing effects, zero shell relevance, and the folder name implies third-party ancestry with no header → provenance risk, see §7 | none |

Supporting version/licence provenance (all `VERIFIED` from per-version registry metadata; versions from `pnpm-lock.yaml`):

`@base-ui/react 1.7.0 MIT` · `motion-panels 0.4.0 MIT` · `motion 13.2.0 MIT` · `@hugeicons/react 1.1.10 MIT` · `@hugeicons/core-free-icons 4.3.0 MIT` · `cmdk 1.1.1 MIT` · `class-variance-authority 0.7.1 Apache-2.0` · `cn 0.2.4 MIT` · `@tanstack/react-virtual 3.14.10 MIT` · `@tanstack/react-hotkeys 0.10.0 MIT` · `sonner 2.0.8 MIT` · `seitu 0.16.1 MIT` · `@shadcn/react 0.3.1 MIT` · `shadcn 4.20.1 MIT` · `tailwindcss 4.3.3 MIT` · `tailwind-scrollbar 4.0.2 MIT` · `tw-animate-css 1.4.0 MIT` · `@fontsource-variable/geist 5.3.0 OFL-1.1` · `react-day-picker 9.14.0 MIT` · `input-otp 1.5.0 MIT` · `@number-flow/react 0.6.2 MIT` · `@xyflow/react 12.11.6 MIT` · `@tiptap/react 3.31.0 MIT` · `arktype 2.2.3 MIT` · `blobatar 2.7.0 MIT` · `@streamdown/code 1.1.1 Apache-2.0` · `streamdown 2.6.0 Apache-2.0` · `use-stick-to-bottom 1.1.6 MIT` · `@paper-design/shaders-react 0.0.80 Apache-2.0` · `memoza 1.3.1` **no `license` field and no `LICENSE` file in the tarball** → `UNKNOWN`.

Transitive note: `@radix-ui/react-dialog@1.1.19` (MIT) enters only via `cmdk@1.1.1` (`pnpm-lock.yaml:12318-12329`); no `@radix-ui/*` is a direct dependency and no Radix component is imported anywhere in `apps/**` or `packages/**`. `react-resizable-panels`, `vaul`, `lucide-react`, `headlessui`, `reka-ui`, `ark-ui`, `@ariakit` are all **absent** from the lockfile. `VERIFIED`

### 3.1 Verified kit inventory (scope of what was inspected)

`packages/ui/src/components/` (57 files + 5 subfolders) — base-ui wrappers: `accordion`, `alert-dialog`, `alert`, `avatar`, `badge`, `bubble`, `button-group`, `button`, `calendar`, `checkbox`, `collapsible`, `combobox`, `command`, `context-menu`, `dialog`, `drawer`, `dropdown-menu`, `empty`, `field`, `group`, `input-group`, `input-otp`, `input`, `item`, `kbd`, `label`, `marker`, `message-scroller`, `message`, `number-field`, `popover`, `response`, `scroll-area`, `select`, `separator`, `skeleton`, `sonner`, `spinner`, `switch`, `table`, `tabs`, `textarea`, `toggle`, `tooltip`, plus `.utils.ts` variant files for `alert/badge/button-group/button/dialog/drawer/field/group/input-group/item/marker/tabs/toggle/attachment/bubble`. Subfolders: `aceternity/` (2), `brand/` (3), `custom/` (19 — incl. `resizable`, `resize-handle`, `scroll-area`, `shortcuts`, `highlight`, `indicator`, `code-block`, `dither-background`, `blur-gradient`, `number-flow`, `content-switch`, `copy-button`, `refresh-button`, `search-input`, `theme-toggle`, `user-avatar`, `loading-content`, `elapsed-seconds`, `password-input`), `icons/` (1), `react-flow/` (1), `tanstack-form/` (7). Hooks: `hooks/use-virtualizer.ts`; `hookas/{use-mounted-effect,use-is-in-viewport,use-debounced-memo}.ts`; `lib/{utils,render,function-once,copy}.ts(x)`; `theme-{store,observer,constants}.ts(x)`; styles `globals.css`, `typography.css`, `monaco.css`. `VERIFIED`

This inventory matters for disposition: the vast majority of it is *wrapping and styling* of `@base-ui/react`, i.e. the reusable value sits in the dependency, and Conar's own contribution is the CSS/token layer — which is precisely the part that is AGPL and must not be copied.

---

## 4. Directly consumable dependency list (XTRM could `DEPEND` today)

Only permissive, product-neutral packages. Version = the exact version Conar resolved; licence = verified per-version registry metadata.

| # | Package | Version | License | Conar usage proving fitness |
|---|---|---|---|---|
| 1 | `motion-panels` | `0.4.0` | MIT | `RES:116-178` builds the entire three-region shell (sized sidebar, fill workspace, sized inspector) with `collapsed`/`onCollapsedChange`, pixel+percent sizes, drag thresholds, keyboard resize, RTL. README documents folding/collapsing/pinning; "no layout library underneath". This is the single highest-value dependency in the audit. |
| 2 | `motion` | `13.2.0` | MIT | `NAV/navigator.tsx:167-178` mode-switch slide, `TB:940-971` `Reorder.Group` tab reordering with `layout="position"`, `window-too-small.tsx:23-31` overlay fade. |
| 3 | `@base-ui/react` | `1.7.0` | MIT | Direct imports for tooltip/popover/menu/context-menu/dialog/drawer/tabs/select/switch/checkbox/avatar/separator/scroll-area/collapsible/number-field/toggle/combobox + `merge-props`/`use-render` across `packages/ui/src/components/*.tsx`. Replaces Radix for XTRM. |
| 4 | `@hugeicons/react` + `@hugeicons/core-free-icons` | `1.1.10` / `4.3.0` | MIT | 444 icon render sites, 110 files, single icon family, `IconSvgElement` typing for icon props. |
| 5 | `cmdk` | `1.1.1` | MIT | `UI/command.tsx:12-15` re-exports `Command`, `CommandPrimitive`, `defaultFilter`; `ACT:377-402` shows manual scoring with `shouldFilter={false}`. |
| 6 | `@tanstack/react-virtual` | `3.14.10` | MIT | `packages/ui/src/hooks/use-virtualizer.ts:1-27`; used for sidebar tree (`NAV/tables-list.tsx:485`) *and* grid (`packages/table/src/provider.tsx:33,44`). |
| 7 | `@tanstack/react-hotkeys` | `0.10.0` | MIT | 13 call sites incl. `Mod+B`/`Mod+J`/`Mod+P`/`Mod+L` with `enabled` gating. |
| 8 | `cn` | `0.2.4` | MIT | `packages/ui/src/lib/utils.ts:1` is literally `export { cn } from 'cn'` — a zero-dependency `clsx`+`tailwind-merge` replacement by Aiden Bai + shadcn. |
| 9 | `shadcn` (CSS preset only) | `4.20.1` | MIT | `GLOBALS:6` imports `shadcn/tailwind.css`, which ships `no-scrollbar`, `scroll-fade*` (mask + `@property` + `scroll()` timeline), `shimmer*`. Used at `NAV/primitives.tsx:19`, `TB:938`, `ACT:430`. |
| 10 | `seitu` | `0.16.1` | MIT | `theme-store.ts:11-44`, `NAV/constants.ts:6-11`, `apps/app/src/entities/connection/store/stores.ts:28-84`, `window-too-small.tsx:15-17`. Gives persisted `localStorage` values, media queries, and computed stores with React subscription — the exact primitive for persisting rail collapse state. |
| 11 | `tailwind-scrollbar` | `4.0.2` | MIT | `GLOBALS:11` plugin registration; used by `UID/scroll-area.tsx:8`. |
| 12 | `sonner` | `2.0.8` | MIT | `UI/sonner.tsx:8-22` restyled toaster with custom icons. |
| 13 | `@shadcn/react` | `0.3.1` | MIT | `UI/message-scroller.tsx:3-12` imports `@shadcn/react/message-scroller` (`MessageScroller`, plus exports) — an unstyled scroller for conversational panels. |
| 14 | `class-variance-authority` | `0.7.1` | Apache-2.0 | Variant matrices in `button.utils.ts`, `item.utils.ts`, `tabs.utils.ts`, `field.tsx`, `group.utils.ts`, `badge.utils.ts`, `input-group.utils.ts`, `drawer.utils.ts`, `dialog.utils.ts`, `toggle.utils.ts`, `alert.utils.ts`. Apache-2.0 is permissive (attribution/NOTICE only). |
| 15 | `tailwindcss` + `tw-animate-css` + `@tailwindcss/typography` | `4.3.3` / `1.4.0` / `0.5.20` | MIT | `GLOBALS:1-16`; `tw-animate-css` powers `data-open:animate-in`-style popup transitions (`tooltip.tsx:47`). |
| 16 | `@fontsource-variable/geist` (+ `-mono`) | `5.3.0` | OFL-1.1 | `GLOBALS:8-9,24-25`. Font redistribution is explicitly permitted under OFL-1.1. |
| 17 | `arktype` | `2.2.3` | MIT | Schema-validated persisted UI state (`NAV/constants.ts:8`, `stores.ts:11-26,46-62`) — pairs with `seitu`. |
| 18 | `react-day-picker` | `9.14.0` | MIT | `UI/calendar.tsx:7-8` wraps `DayPicker`/`getDefaultClassNames` with Hugeicons chevrons. |
| 19 | `input-otp` | `1.5.0` | MIT | `UI/input-otp.tsx`. |
| 20 | `@number-flow/react` | `0.6.2` | MIT | `UID/number-flow.tsx`; used for animated counters (`apps/main/src/routes/account.tsx:88`). |
| 21 | `@xyflow/react` | `12.11.6` | MIT | `packages/ui/src/components/react-flow/edge.tsx`; schema visualizer at `…/-tabs/visualizer/visualizer-tab.tsx:241,248`. |
| 22 | `use-stick-to-bottom` | `1.1.6` | MIT | Chat transcript auto-scroll. |
| 23 | `@tiptap/react` + `starter-kit` + `placeholder` | `3.31.0` | MIT | `apps/app/src/components/tiptap.tsx`, `tiptap.css`. |
| 24 | `blobatar` / `@blobatar/react` | `2.7.0` | MIT | Deterministic avatar generation (`UID/user-avatar.tsx`). |

Not recommended despite MIT: `memoza` (`1.3.1`) — see §7 (`UNKNOWN` licence). `@paper-design/shaders-react`, `streamdown`, `@streamdown/code` are Apache-2.0 and usable, but Apache-2.0 adds NOTICE/attribution file obligations and none of the three addresses a rail/sidebar/inspector requirement.

---

## 5. Reject list

| Rejected thing | Type | Reason |
|---|---|---|
| All `@tamery/**` workspace source (`packages/ui`, `apps/app`, `packages/table`, `packages/shared`) | Licence | AGPL-3.0 (`LICENSE:1-4`). No per-file headers exist (`grep -rn "SPDX-License-Identifier\|Copyright (c)" packages apps` → 0 hits), so the whole tree reads as Conar-owned AGPL. Copying any of it into a non-AGPL product is contamination. |
| `packages/ui/src/components/aceternity/*` | Provenance | `flip-words.tsx` and `text-hover-effect.tsx` live in a folder named after Aceternity UI, carry **no** licence or attribution header, and are Apache/MIT-style upstream effects Conar reworked. Upstream terms must be checked independently before reuse; do not launder them through Conar. |
| `apps/app/src/components/sidebar-link.tsx` row primitive | Coupling/inconsistency | Duplicate of `NAV/primitives.tsx:57` with different metrics (`h-7 rounded-md` vs `h-8 rounded-xl`), used only by one table-toolbar panel. Adopting it propagates an unresolved product inconsistency. |
| `UID/resize-handle.tsx` | Superseded | Global `mousemove`/`mouseup` listeners, `z-1000` drag overlay, no pointer capture, no keyboard, no ARIA. Conar itself migrated to `motion-panels` separators for the shell (`UID/resizable.tsx`). |
| "Collapse to zero width" as the sidebar's hidden state | Product behaviour | Satisfies neither XTRM requirement: not a rounded reopen rail, and the affordance is relocated into the workspace tab bar (`TB:914-932`), i.e. exactly the "second icon menu / toolbar" pattern the requirement excludes. |
| `UI/drawer.tsx` viewport/overlay scoping (`drawer.tsx:108,147,155,161`) | Behaviour | `fixed inset-0 z-50` viewport + `z-50` popup at 75% width on the x-axis means a maximized drawer covers the entire window, including any global rail. Direct contradiction of the XTRM requirement (see §6). The Base UI drawer *primitive* is fine; Conar's mounting is not. |
| Marketing/decorative layers (`dither-background`, `blur-gradient`, animated brand logo, `@paper-design/shaders-react`) | Product-identity leakage + licence | Product-funnel identity and Apache-2.0 NOTICE overhead with no shell value. |
| `data-mask` attribute as a UI convention | Non-primitive | Not CSS, not a primitive: it is a PostHog session-replay masking selector (`apps/app/src/lib/posthog.ts:11  maskTextSelector: '[data-mask]'`) applied on truncating elements. Do not mistake it for a styling hook. |
| `window.shell` preview classes | Dead-ish surface | `GLOBALS:154-191` (`.shell-connection`, `--shell-navigator-width`, `[data-shell-navigator]`) render a static, non-interactive skeleton used for prerender/screenshot parity (`apps/app/src/shell.tsx:13-95`). Useful idea for prerendering, not a primitive. |

---

## 6. Shell hypothesis evaluation

Hypothesis under test: **`persistent global icon rail` + `contextual collapsible sidebar` + `primary workspace` + `inspector rail / global drawer`**, with the constraints that (a) the contextual sidebar collapses to a narrow **rounded reopen rail** — not zero width, not a second icon menu — and (b) a maximized drawer must never cover the global rail.

| Hypothesis element | Conar reality | Verdict |
|---|---|---|
| Persistent global icon rail | Does not exist. Shell = title bar + navigator + workspace(+logger) + chat, all inside one `ResizableGroup` (`RES:115-179`). Navigator is route-scoped and absent on the dashboard (`apps/app/src/routes/_protected/index.tsx:9-15`). | **Not supported — element absent; Conar offers no evidence either way.** `VERIFIED` (absence) |
| Contextual collapsible sidebar | Exists and is well-built: `RES:117-131`, 280/220/50%, persisted open + width, focusable separator, motion fold. | **Supported.** `VERIFIED` |
| Primary workspace | Exists as the fill panel plus a tab bar: `RES:132-139` + `TB:760-990` (reorderable, closable, renameable tabs with per-tab refresh and history nav). | **Supported.** `VERIFIED` |
| Inspector rail | Exists as the right chat panel in the same group (`RES:164-177`), independently sized/collapsed/persisted, reopened from the tab bar (`TB:446-492`). | **Supported (as a sibling panel, not as an overlay rail).** `VERIFIED` |
| Global drawer | `@base-ui/react/drawer` used only for the table "Review changes" flow (`drafts-review-drawer.tsx:135-146`, `swipeDirection="right"`, `max-w-2xl`). | **Partially supported.** `VERIFIED` |
| Constraint (a): collapse to a **narrow rounded reopen rail**, not zero width, not a second icon menu | Conar collapses to **0**: `motion-panels` sets panel extent to `0` when `collapsed` (`dist/core-BulrhmUL.js:400,413`), and `RES:126` passes `collapsed={!navigatorOpened}`. Reopen is a **toolbar button** (`TB:914-932`, `SidebarLeftIcon`, tooltip "Toggle sidebar", `Mod+B` hint) living in the workspace tab bar, plus `Mod+B` (`TB:863-866`). A secondary, gesture-only reopen path exists: dragging the 1px separator (`UID/resizable.tsx:13-27`) out of the collapsed state via the library's `min/2` threshold (`core:334-335`). | **Contradicted by Conar's choice; not contradicted by its stack.** `VERIFIED` for behaviour, `INFERENCE` that XTRM's requirement is a deliberate divergence. The reusable half is `motion-panels` + a focusable separator; the rail itself, its rounded shape, and its reserved width must be XTRM-owned (e.g. a fixed-size panel sibling, or `collapsedSize`-style styling inside the rail element). Conar offers **no** rounded-rail precedent — the only rounded affordances in the shell are `hit-area-1` on a 1px strip. |
| Constraint (b): maximized drawer must never cover the global rail | Conar contradicts it. `DrawerContent` portals into a viewport styled `pointer-events-none fixed inset-0 z-50` (`drawer.tsx:147`); the popup is `fixed z-50` (`drawer.tsx:155`) with x-axis width `75%` and `sm:` `24rem` (`drawer.tsx:161`); the modal backdrop is `fixed inset-0 z-50` (`drawer.tsx:108`). `modal={false}` only removes the backdrop — the viewport is still `fixed inset-0`, and the popup still covers whatever sits underneath it laterally. | **Contradicted.** `VERIFIED` from CSS. XTRM must scope the drawer portal/host to the workspace container (portal `container` prop, or `absolute` inside a `relative` region) and must keep rail z-index above the drawer's own layer. Conar provides no precedent for that scoping; treat Conar's drawer only as a demonstration of the Base UI **primitive** surface (`snapPoints`, `modal`, `swipeDirection`, `Viewport`/`Backdrop`/`Popup` decomposition). |
| Additional divergence worth recording | Conar's global actions (palette, logger toggle, chat toggle, sidebar toggle) live in the **title bar + tab bar**, i.e. chrome around the workspace, not in a rail. If XTRM's rail is meant to host global navigation, Conar offers zero evidence about rail interaction patterns (selection ring, tooltip placement, rail-width budget interaction with a 900px minimum window: `packages/shared/constants.ts:11`). | `INFERENCE` |

Summary: **Conar validates the mechanism (a Motion-animated, keyboard- and ARIA-correct resizable panel stack with real per-panel collapse) and contradicts both XTRM behavioural constraints.** Adopt `motion-panels` + `@base-ui/react`; design the rail and the drawer scoping in XTRM.

---

## 7. Legal / provenance risks

1. **AGPL-3.0 is the effective licence of every Conar-owned file.** `LICENSE:1-4` is unmodified AGPL-3.0 text; there is no separate `LICENSE` in `packages/ui`, no dual-licence file, and **no per-file notice** anywhere (`grep -rn "SPDX-License-Identifier\|Copyright (c)" packages apps` → 0 hits). `package.json` declares `"private": true` for the workspace root and `@tamery/ui`. `VERIFIED`
2. **What "reference only" means here, stated precisely.** Reading Conar to learn structure, dimensions, interaction sequencing, state-persistence choices, and library selection is the permitted activity in this audit. Copying, translating, paraphrasing-with-substitution, or mechanically reformatting Conar-owned source (TSX, CSS class strings including the token/utility names it defines such as `focus-ring`/`hit-area-*`, or the `@theme`/`:root`/`.dark` token blocks) into a non-AGPL XTRM codebase is what creates a derivative-work and contamination exposure. There is no threshold at which "small enough" makes a copied CSS class recipe safe to assert; treat any byte-level or near-byte-level reuse as prohibited. `INFERENCE` (legal characterisation; not legal advice)
3. **Do not vendor Conar source under any circumstance.** This audit produced no case where vendoring was even tempting: every mechanism XTRM actually needs is upstream and permissively licensed (`motion-panels`, `motion`, `@base-ui/react`, `cmdk`, `@tanstack/*`, `seitu`, `cn`, `shadcn` CSS). Vendoring AGPL Conar code would import AGPL obligations for zero capability gain. `VERIFIED` (capability coverage), `RECOMMENDATION`
4. **Notice requirements for the dependencies XTRM would actually take.** MIT/ISC-style: retain the copyright notice and permission text for `motion-panels` ("MIT © Valerii Strilets", `motion-panels@0.4.0 LICENSE:1-3`), `motion`, `@base-ui/react` (MUI), `cmdk`, `sonner`, `seitu`, `cn`, `shadcn`, `tailwindcss`, `@tanstack/*`, `@hugeicons/*`, `tailwind-scrollbar`, `tw-animate-css`, `input-otp`, `react-day-picker`, `@xyflow/react`, `@tiptap/*`, `arktype`, `blobatar`, `use-stick-to-bottom`. `Apache-2.0` (`class-variance-authority 0.7.1`, `@paper-design/shaders-react`, `streamdown`, `@streamdown/code`): include the licence text, retain attribution, and propagate any `NOTICE` file — the stricter obligation in this set. `OFL-1.1` (`@fontsource-variable/geist{,-mono} 5.3.0`): permitted for embedding/redistribution; do not sell the fonts alone and do not use the Reserved Font Name if modified. `VERIFIED` (licence identity), `RECOMMENDATION` (process)
5. **Unresolved licence: `memoza@1.3.1`.** The published tarball contains no `LICENSE` file and `package.json` has no `license` field; the registry's `latest` (1.3.1) also reports no licence. Conar uses it (`apps/app/src/entities/connection/store/stores.ts:3,28,77,86`). Do not adopt it until the author states a licence. `UNKNOWN`
6. **`@shadcn/react 0.3.1` provenance.** Its registry metadata points at `github.com/shadcn-ui/ui` and the licence is MIT; the package is described as "Unstyled components for React" exporting `./message-scroller` and `./questionnaire`. Low risk, but verify the actual repository path at adoption time rather than trusting Conar's lockfile `.  UNKNOWN` (repo-vs-package mapping not independently confirmed)
7. **`@radix-ui/*` transitive footprint.** `cmdk@1.1.1` pulls `@radix-ui/react-dialog@1.1.19` and friends (`pnpm-lock.yaml:12318-12329`, MIT). No Radix code is imported directly by Conar (Conar's `CommandDialog` uses its own Base UI dialog: `UI/command.tsx:3-9,42-72`). If XTRM takes `cmdk`, an unused Radix dialog ships in the dependency graph — an audit-surface cost, not a licence problem. `VERIFIED`
8. **The `aceternity/` folder is the one real third-party-provenance wrinkle in Conar's own kit.** `packages/ui/src/components/aceternity/` (`flip-words.tsx`, `text-hover-effect.tsx`) contains no attribution or licence header, and the file/API names match Aceternity UI's published effects. Conar's AGPL covers Conar's expression of them, but the underlying upstream terms are a separate question. This is also a reason not to treat Conar's `packages/ui` as a clean-room reference for effects. `INFERENCE`
9. **Rejected-risk items carry no AGPL contact at all.** Everything in the §4 consumable list is obtainable from npm/registry directly, with the licence verified per-version. Nothing on that list required reading Conar source to acquire. `VERIFIED`

---

## 8. Open questions (`UNKNOWN`)

1. `UNKNOWN` — Does the operator's "double-sidebar" reference come from Conar screenshots of a **different revision** than `d50f1d1`? At this SHA there is no global icon rail; if a rail exists on another branch/tag, this audit's §2.1 absence finding is scoped to `d50f1d1` only.
2. `UNKNOWN` — Whether XTRM's "contextual sidebar collapses to a narrow rounded reopen rail" must **reserve** rail width (so the workspace never reflows) or may overlay it. `motion-panels` has no `collapsedSize` prop (`dist/react/index.d.ts`, `SizedPanelProps`) — collapse is always to `0` — so a reserved rail requires either a separate rail element or an XTRM-owned panel that is never `collapsed`. Which of those XTRM wants changes the implementation materially.
3. `UNKNOWN` — Which z-index the XTRM global rail must sit at. Conar's overlay stack is `z-30` (separators) < `z-50` (tooltips, dialogs, drawers, command palette) < `z-60` (toasts) < `z-100` (window-too-small) < `z-1000` (legacy drag overlay). A rail that must survive a maximized drawer needs either a z-index above `50` inside the same stacking context as the drawer, or the drawer must be portalled into the workspace container.
4. `UNKNOWN` — Whether Base UI's Drawer supports a `Portal` `container`/host override in `1.7.0`. Conar always portals to `document.body` (`UI/drawer.tsx:140` `DrawerPortal`) and never overrides the container, so this requirement cannot be validated from this repo; it must be checked against `@base-ui/react` docs or source.
5. `UNKNOWN` — Intent behind the two divergent sidebar-row primitives (`apps/app/src/components/sidebar-link.tsx:7-16` vs `NAV/primitives.tsx:57`). Could be legacy drift or deliberate per-context density; no comment or commit evidence was located in the audit window.
6. `UNKNOWN` — `memoza@1.3.1` licence (see §7.5).
7. `UNKNOWN` — Whether `@shadcn/react@0.3.1`'s declared repository (`github.com/shadcn-ui/ui`) actually contains the published `message-scroller` source, or whether the package is redistributed from elsewhere.
8. `UNKNOWN` — Whether Conar's `sidebar` primitives were generated by the `shadcn` CLI's MIT `sidebar` registry entry (`shadcn@4.20.1` is a devDependency of `packages/ui`). The slot names (`data-slot="sidebar-content"`, `sidebar-menu-button`, `sidebar-group-label`) and the `state: { sidebar: 'menu-button' }` pattern in `NAV/primitives.tsx:12-152` strongly suggest it (`INFERENCE`), but no generator config or registry provenance file was found to confirm it, and the heights/radii differ from upstream shadcn.
9. `UNKNOWN` — Whether the `packages/ui` kit is intended to become a public package. `package.json` declares `"private": true` and `@tamery/ui` is `workspace:*` only; there is no publish script, unlike `apps/cli` (`package.json:38-39` `publish:cli`). This matters for how far Conar's own styling conventions could ever be treated as a distributable artifact.
