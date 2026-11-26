## 1. How t3code structures settings

Read at `~/dev/t3code` revision `da36859cb`.

### 1.1 Entry points: one modal route, four ways in

| Entry point | Where | Evidence |
| --- | --- | --- |
| Modal route over the chat shell | the settings tree is `/_chat/settings`, rendered inside `AppRouteModal` | `apps/web/src/routes/_chat.settings.tsx:217`, `apps/web/src/components/AppRouteModal.tsx:24-27` |
| Sidebar footer icon | icon-only utility row at the bottom of the sidebar | `apps/web/src/components/sidebar/SidebarChrome.tsx:279-283`, `:315-324` |
| Desktop menu item with accelerator | macOS app menu and the Windows/Linux File menu, `CmdOrCtrl+,` | `apps/desktop/src/window/DesktopApplicationMenu.ts:251-256`, `:276-282` |
| Command palette | a dedicated "Open settings" action, plus every individual setting as a searchable row | `apps/web/src/components/CommandPalette.tsx:1834-1842`, `CommandPaletteSettingsItems.tsx:16-49` |
| Direct URL / deep link | `/settings` redirects to `/settings/general`; old paths and old section anchors redirect to their new home | `apps/web/src/routes/_chat.settings.tsx:217-228`, `settingsSearch.ts:1580-1589` |

Two properties are worth naming, because most applications get them wrong.

First, settings is a **modal over the workspace, not a page that replaces it**. The
docblock states the contract: "Large modal for the Settings and Usage routes. Esc, the
close button, or a press on the backdrop returns to the page that opened it. Keyboard
guards that skip dialogs exempt `[data-app-modal]`, because these pages own their
shortcuts." (`AppRouteModal.tsx:24-27`). Closing returns the user to what they were
looking at, and focus returns to the opener only after a keyboard close, so a pointer
close does not paint a focus ring (`AppRouteModal.tsx:41-43`).

Second, the tree **moves without breaking links**. `movedSettingsPath` maps a renamed
section path and a moved section anchor onto its new location, and the route redirects
with `{to, search: true, hash: true, replace: true}` (`settingsSearch.ts:1580-1589`,
`_chat.settings.tsx:222-228`). Old bookmarks, old documentation links and old in-app links
keep working. The constants that feed it are explicit about what happened: sections were
both renamed and split (`RENAMED_SETTINGS_PATHS` at `settingsSearch.ts:1560`,
`SPLIT_SETTINGS_PATHS` at `:1565`, `MOVED_SECTION_ANCHORS` at `:1573`).

### 1.2 Information architecture: 23 sections, five groups, one label record

Sections are routes under `apps/web/src/routes/_chat.settings.*.tsx`; there are 27 such
files, of which 23 appear in the label record (the remainder are reached from a labelled
page rather than from the nav). The label record is the single source for the sidebar,
the breadcrumb and the search:

```ts
// apps/web/src/components/settings/settingsSearch.ts:99-122
export const SETTINGS_SECTION_LABELS = {
  "/settings/diagnostics": msg("Diagnostics"),
  "/settings/projects": msg("Projects"),
  "/settings/general": msg("General"),
  "/settings/appearance": msg("Appearance"),
  "/settings/chat": msg("Chat"),
  "/settings/diffs": msg("Diffs & pull requests"),
  ...
```

A second record exists only so a translator can shorten a nav label without changing the
page title (`SETTINGS_NAV_LABELS`, `settingsSearch.ts:126-131`; overrides for
`source-control` and `access`). That is a small decision with a large payoff: navigation
labels and page titles are allowed to differ, and both are translatable.

The nav groups settings by *the kind of thing being configured*, not by alphabet:

```text
Preferences (heading hidden)   General · Appearance · Chat · Diffs & pull requests ·
                              Keybindings · Voice · SnapShots
Agents                        Providers · Threads · Browser · Devices · Scheduled tasks
Code                          Projects · Source control & issues · Worktrees
Connections                   Environments · Sharing & access · Secrets
More (heading hidden)         Maintenance · Labs · About · Archive
```

Groups and their membership: `ALL_SETTINGS_NAV_GROUPS` at `settingsSearch.ts:140-177`.
The set is computed, not static: `settingsNavGroups(hasSecretProvidersEnvironment)`
removes the Secrets section when no environment serves secret providers
(`settingsSearch.ts:180-190`). Two headings are deliberately hidden, so "Preferences" and
"More" read as plain lists rather than as categories.

Inside a page, sections are addressable blocks with stable ids that double as search
anchors. `GeneralSettingsPanel` renders nine of them, in this order: notifications,
sidebar, confirmations, display, composer, follow-ups, subagents and side chats, activity,
screen reader (`SettingsPanels.tsx:846`, sections at `:861, :881, :990, :1138, :1250,
:1354, :1416, :1473, :1477`).

| Primitive | Evidence | Job |
| --- | --- | --- |
| `SettingsSection` | `settingsLayout.tsx:214` | titled block with an anchor id |
| `SettingsRow` | `settingsLayout.tsx:314` | label, description, control, provenance note |
| `SettingsPageContainer` | `settingsLayout.tsx:624` | page width and vertical rhythm |
| `SettingsGroup` | `SettingsGroup.tsx:5` | grouped or plain variant of a row set |
| `PolicyTooltip` | `settingsLayout.tsx:193` | explains a policy that overrides the user |
| `SettingsUnavailableGroup` | `settingsLayout.tsx:268` | shows what a scope does not allow, instead of hiding it |
| `FoldedSettingsSection` | `FoldedSettingsSection.tsx` | progressive disclosure for advanced blocks |
| `SettingResetButton` | `settingsLayout.tsx:584` | per-row reset, disabled on default |
| `scrollToSettingsTarget` | `settingsLayout.tsx:670` | hash deep-link with a highlight |

### 1.3 Persistence and scope: four layers, one facade, per-key provenance

| Layer | Store | Scope | Evidence |
| --- | --- | --- | --- |
| Device | `t3code:client-settings:v1` in `localStorage`, one validated document | browser profile, or Electron user data | `apps/web/src/clientPersistenceStorage.ts:5`, schema `packages/contracts/src/settings.ts:416` |
| Host | `settings.json` in the agent state directory | the agent host | `apps/desktop/src/app/DesktopEnvironment.ts:205`, schema `packages/contracts/src/settings.ts:1410` |
| Project | `resolvedProjectSettings` over `environment`/`project`/`t3.json` | one project, one checkout | `packages/shared/src/projectSettings.ts:21-29`, `:55`, `:73` |
| Desktop shell | `desktop-settings.json`, read before the window exists | one desktop install | `DesktopEnvironment.ts:202`, `apps/desktop/src/app/DesktopEarlyElectronStartup.ts:51`, `:68` |

The facade that the UI actually talks to is a single composed type:

```ts
// packages/contracts/src/settings.ts:1847-1848
export type UnifiedSettings = Omit<ServerSettings, keyof ModelPreferences> & ClientSettings;
export const DEFAULT_UNIFIED_SETTINGS: UnifiedSettings = { ... };
```

A patch is routed to the right store by key membership, not by call site:

```ts
// apps/web/src/hooks/useSettings.ts:271-273
const SERVER_SETTINGS_KEYS = new Set<string>(Struct.keys(ServerSettings.fields));
const splitPatch = (patch: Partial<UnifiedSettings>) => ({ serverPatch, clientPatch });
```

Which means a settings screen never asks "which store am I in". It writes a patch to one
hook and the hook splits it. That is the property our two apps lack today: the console has
no appearance setting at all, and the threads app has no host setting.

Scope is carried in the URL, not in a React context that can drift:

```ts
// apps/web/src/routes/_chat.settings.tsx:192-213 (abridged)
<SettingsScopeProvider
  project={search.project}
  machine={search.machine}
  checkout={search.checkout}
  singleEnvironment={pathname === "/settings/providers" || pathname === "/settings/secrets"}
  deviceOnly={SETTINGS_DEVICE_ONLY_PATHS.has(pathname)}
  onChange={(patch) => navigate({ to: pathname, search: { ...search, ...patch }, hash: "" })}>
```

`SETTINGS_DEVICE_ONLY_PATHS` has eight members and is deliberately data, not a condition
sprinkled through pages (`SettingsScopeSentence.tsx:51-60`), with one telling comment:
"Access picks its environment on the page itself." The gate that applies it is three lines
(`:75`). Device-scoped pages therefore render no scope control and no scope sentence;
scope-scoped pages render the sentence that names the scope
(`SettingsScopeNotice.tsx:34`).

The last layer is the one worth copying wholesale: **provenance is returned per key**.

```ts
// packages/shared/src/projectSettings.ts:21-29
export type ProjectSettingSource = "environment" | "project" | "t3.json";
export interface ResolvedProjectSettings {
  settings; sources; overrides;
}
```

A value is not just a value; it arrives with the layer it came from, so a row can say
"set by the project file" and a reset can say what it would fall back to. Our
`IntegrationSurface` already speaks this vocabulary once, for `resolvedBy`
(`packages/xtrm-app/src/project/settings/IntegrationSurface.tsx:26-32`, rendered at
`:118-160`). The proposal in section 3 generalises that single case.

### 1.4 One model, one UI, two hosts

The first pass of this report described t3code as "one model, two apps". At `da36859cb`
that framing is wrong and the correction matters for our decision.

t3code has **one renderer**: `apps/web`. The desktop application is an Electron shell
around that same renderer (`apps/desktop`), and the browser build is the same bundle. The
two "apps" differ in *host*, not in *surface*: what differs is where a document is read
and written. That difference is confined to one seam:

```ts
// apps/web/src/localApi.ts:69-81 (abridged)
export const persistence = {
  getClientSettings: () =>
    window.desktopBridge?.getClientSettings() ?? readBrowserClientSettings(),
  setClientSettings: (patch) =>
    window.desktopBridge ? request(ipc.setClientSettings, patch) : writeBrowserClientSettings(patch),
};
```

Everything above that seam is identical. There is no second settings UI, and no component
is imported from one app into another, because there is no second app to import into.

Consequence for us: t3code does not answer the question "how do two different UIs share
settings", because it does not have two. It answers the easier, and more relevant,
question — how does one model stay authoritative across two persistence hosts — and it
answers it with the shared-package split described next. Section 3.9 returns to what that
means for console and threads.

What *is* shared across packages is pure model:

| Package | Content | Evidence |
| --- | --- | --- |
| `packages/contracts` | `ClientSettingsSchema`, `ServerSettings`, `UnifiedSettings`, defaults, patches | `packages/contracts/src/settings.ts:416, :623, :1410, :1847, :1848, :1859` |
| `packages/shared` | project resolution, provenance, keybinding defaults | `packages/shared/src/projectSettings.ts:21-81`, `packages/shared/src/keybindings.ts:89-95` |

### 1.5 Keyboard access

| Action | Binding | Evidence |
| --- | --- | --- |
| Open settings | `CmdOrCtrl+,` | `DesktopApplicationMenu.ts:253`, `:278` |
| Focus the settings search | `Cmd/Ctrl+F` or `/` | `SettingsSidebarNav.tsx:162-198`, `:332` |
| Move through results | `ArrowUp`/`ArrowDown`, `Enter`, `Escape` | `SettingsSidebarNav.tsx:219`, `:229` |
| Leave settings | `Escape` via the modal | `AppRouteModal.tsx:24-27` |
| Toggle the command palette | `mod+k` | `packages/shared/src/keybindings.ts:89` |
| Open the palette's settings rows | type any setting name | `CommandPaletteSettingsItems.tsx:16-49` |

Two details are better than the norm. The search shortcut is matched on **logical keys**,
not on a characters string: `resolveEventKeys(event)` yields the key identity so that a
`/` on a German keyboard, typed as `Shift+7`, still opens search, while `Shift+/` on a
physical slash key does not (`SettingsSidebarNav.tsx:162-198`). And the "is the user
typing?" guard exempts `[data-app-modal]`, so the settings surface keeps its own
shortcuts while it is open over the chat (`:186-194`) — the exception is by element, not
by a global boolean.

Notably absent: there is no `settings.open` keybinding *command*, so `Cmd+,` is a menu
accelerator rather than a rebindable command (`packages/contracts/src/keybindings.ts:58`,
`:133`). Settings cannot be rebound. Our proposal should not copy that omission.

### 1.6 Patterns worth copying, and what to leave behind

Copy:

1. **One validated document per scope**, never a bare key per toggle
   (`clientPersistenceStorage.ts:5`, `settings.ts:416`).
2. **One facade type, split by key membership** (`settings.ts:1847`, `useSettings.ts:271`).
3. **Scope in the URL**, with a declared device-only set and a scope sentence
   (`_chat.settings.tsx:192-213`, `SettingsScopeSentence.tsx:51-75`).
4. **Per-key provenance** returned to the UI (`projectSettings.ts:21-29`).
5. **Sections as routes with stable anchor ids**, plus redirects for moved and split paths
   (`settingsSearch.ts:1560-1589`).
6. **One label record** feeding nav, breadcrumb and search, translatable, with a separate
   nav-label override (`settingsSearch.ts:99-131`).
7. **Computed nav membership** — a section disappears when its backing feature is absent
   (`settingsSearch.ts:180-190`).
8. **A modal surface with a return contract**, exempt by element from global shortcuts
   (`AppRouteModal.tsx:24-27`).
9. **Settings as palette rows while searching**, deep-linking to the setting itself
   (`CommandPaletteSettingsItems.tsx:16-49`).
10. **Device scope as a data set**, not as conditionals inside pages
    (`SettingsScopeSentence.tsx:51-60`).

Leave behind:

- 23 top-level sections. It is a rational tree for a product with this many axes, and too
  much for a console that has six kinds of setting. Six sections with anchors is the
  right size for us (section 3.5).
- A `Settings...` accelerator that is not a command (`keybindings.ts:58`).
- A modal-only surface. A console user wants to watch the sidebar change while adjusting
  appearance; a route with live preview is better for us, and the existing console sidebar
  already updates live. (The modal is right for t3code because its settings are mostly
  forms about agents, not visual preferences.)
- `t3.json`-style committed project files. We have no committed project configuration
  today, and the binding is derived (open question 1 is now decided: host only).

---

## 2. Inventory: settings in the two xtrm apps

### 2.1 Console (`packages/xtrm-app`)

There are three places a person can change something, and they do not agree on what
"settings" means.

| # | Surface | Route / mount | Editable? | Content |
| --- | --- | --- | --- | --- |
| 1 | `SettingsSurface` | `/settings` (`src/app/router.tsx:106`) | yes | GitHub identity only: Connection, Identity, Installations, pending sign-in (`src/settings/SettingsSurface.tsx:63`, `:94`, `:118`, `:164`) |
| 2 | `IntegrationSurface` | `/project/settings` (`src/app/destinations.ts:85`) | **no** | read-only facts about the project binding and its health (`src/project/settings/IntegrationSurface.tsx:118-235`); every unverified fact prints `unverified` with its reason (`:113-116`) |
| 3 | `HostConnection` | inline in the *agent* sidebar (`src/agent/AgentSidebar.tsx:227` toggle, `:252` panel; that sidebar is rendered by `src/shell/ContextSidebar.tsx:342`) | yes | SSH target, remote command, direct-device pairing (`src/agent/HostConnection.tsx:63-108`, `:271-319`) |

Plus two settings that are *only* reachable as controls, with no page that lists them:
the theme toggle in the top bar (`src/shell/AppShell.tsx:39-44`) and the repository
selector (`src/shell/ContextSidebar.tsx:21-107`).

Storage keys (complete for `src`; tests excluded):

| Key | Store | Written | Read | Scope | Notes |
| --- | --- | --- | --- | --- | --- |
| `xtrm.console.repo.v1` | localStorage | `src/shell/context.tsx:102` | `router.tsx:46`, `context.tsx:98` | device | value `owner/name`; declared **twice**, `context.tsx:18` and `router.tsx:40` |
| `xtrm.console.theme.v1` | localStorage | `context.tsx:108` | `context.tsx:64-70` | device | `"light" \| "dark"`; falls back to `prefers-color-scheme`; applied via `document.documentElement.dataset.theme` |
| `xtrm.console.layout.v1` | localStorage | `src/shell/layout.ts:266-276` | `layout.ts:278-292` | device | `{sidebarOpen, sidebarWidth, inspectorWidth}`; validated and clamped on restore |
| `xtrm.agent.names.v1` | localStorage | `src/adapters/agent/live.ts:94` | same module | device | agent session-name map |
| `xtrm.agent.scope.v1` | **sessionStorage** | `src/agent/AgentSidebar.tsx:199` | `:27-33` | tab | `"all" \| "repository"`; lost on reload |
| host connection (`target`, `remoteCommand`, direct pairing) | **agent host** | `src/adapters/agent/host-connection.ts:92` (`POST /settings`) | `:19-29` `agentHost.status()` | host | the only genuinely host-scoped store we have |
| drawer state | URL search params | `src/shell/layout.ts:230-247` | same | link | `inspect`, `drawer` |

Shortcuts exist only as string constants inside modules: `INSPECTOR_MAXIMIZE_KEY = "Shift Enter"`
(`src/shell/layout.ts:85`), `modShortcut()` label rendering (`:64-71`), and the
`useModeShortcuts` table `Mod+1..5` plus `Mod+.`
(`src/shell/AppShell.tsx:47-74`). There is no keybinding registry, so no keybinding
settings page is possible today; the palette lists commands
(`src/shell/GlobalSearch.tsx:31-37`, `:46`) but not one for settings.

### 2.2 Threads viewer (`packages/pi-viewer`, on `origin/xt/thread-lead`)

The viewer has no settings page at all. Its entire settings story is two header
popovers plus two implicit states.

| Surface | Evidence | Content |
| --- | --- | --- |
| `PaletteControl` | `src/components/PaletteControl.tsx:29-…`, mounted at `src/components/ViewerHeader.tsx:194` | icon-only trigger `aria-label="Colours: <label>"`; a `w-64` popup with five presets as radios, then "Mix" with three segmented planes (Sidebar, Chat, Text) and the note "Desktop and Soft change the dark theme only." |
| `ChatWidthControl` | `src/components/ViewerHeader.tsx:73-…`, mounted at `:193` | three presets plus a slider bounded by `availableRem()` (`:58-71`); hidden below 640px (`hidden sm:flex`) |
| Theme button | `src/components/ViewerHeader.tsx:195` | toggles light/dark |

Storage keys:

| Key | Evidence | Scope | Notes |
| --- | --- | --- | --- |
| `pi-viewer-theme` | `src/App.tsx:95-96`, written `:129`; read pre-paint at `packages/pi-viewer/index.html:9-13` | device | dark unless the saved value is exactly `"light"` |
| `pi-viewer-palette` | `src/lib/palette.ts:16` (`PALETTE_KEY`), `:54-67` | device | `threads \| threads-soft \| console \| console-soft \| desktop` (`:10`) |
| `pi-viewer-colours` | `src/lib/palette.ts:92` (`COLOURS_KEY`), `:136-156` | device | `{sidebar, chat, text}`; falls back to the preset; `presetOf()` returns `"custom"` when mixed (`:110-118`) |
| `pi-viewer-chat-width` | `src/lib/chat-width.ts:19`, `:90-105` | device | `comfortable \| wide \| full \| custom:<rem>` |
| `pi-viewer-sidebar` | `src/components/sidebar/Sidebar.tsx:12`, `:13-49` | device | folded session/window/pane group ids |
| `xtrm-viewer:last-seen:` | `src/lib/readstate.ts:3`, `:6-8`, `:10-19` | device | one key per thread, keyed by tmux server id; unbounded growth |
| `xtrm.console.layout.v1` | `src/shell/layout.ts:13`, `:41-71` | device | **deliberately the console's key and shape** (`:12`: "a different origin… so the values never collide"); the viewer merges so the console's `inspectorWidth` survives |
| `pi-viewer-design-theme` | `docs/design/site/index.html:1013` | docs only | not app state |

Two structural observations:

1. **Palette semantics live in three places.** The same preset table and the same
   `pi-viewer-colours` override are implemented in
   `packages/pi-viewer/index.html:7-30` (a blocking pre-paint script), in
   `src/lib/palette.ts:10-165`, and described in `docs/design/palette-console.md:4`.
   A fourth surface must copy the boot script or flash the wrong colours.
2. **The viewer already reuses a console artefact on purpose** — the layout key — so
   "shared settings" is an existing intent, executed once, by hand, with a comment.

### 2.3 Duplicates and near-duplicates

| Setting | Console | Viewer | Verdict |
| --- | --- | --- | --- |
| Theme | `xtrm.console.theme.v1`, default from `prefers-color-scheme` (`context.tsx:64-70`) | `pi-viewer-theme`, default dark (`App.tsx:95-96`, `index.html:9-13`) | **duplicate with different defaults**; no "system" option in either |
| Sidebar layout | `xtrm.console.layout.v1` (`layout.ts:266-292`) | same key, same shape (`shell/layout.ts:41-71`) | already shared by copy; the viewer's clamps are hard-coded duplicates of the console's `SIDEBAR` bounds |
| Repository selection | `xtrm.console.repo.v1` | none (the viewer scopes by URL) | console-internal duplicate: the constant is declared in two modules (`context.tsx:18`, `router.tsx:40`) |
| Colours / palette | none (theme only) | `pi-viewer-palette`, `pi-viewer-colours` | viewer-only concept, described as console-facing (`palette.ts:10`) but not shared |
| Chat width | fixed widths (`max-w-3xl` page column at `src/settings/SettingsSurface.tsx:63`; `w-[96%]` main region at `src/shell/AppShell.tsx:102`) | `pi-viewer-chat-width` + slider | viewer-only; the console has no equivalent control |
| Host connection | server-side via the agent host | none | console-only, correctly scoped |
| Agent scope (`all` / `repository`) | `sessionStorage`, lost on reload (`AgentSidebar.tsx:23`) | none | a real preference that is not persisted at all |

### 2.4 Gaps that a settings model should close

1. No console command-palette entry and no shortcut for settings.
2. No console appearance page: theme is a toggle, density and chat width do not exist.
3. No project-scope settings UI: `IntegrationSurface` reports the binding but cannot
   override it, so the only way to change it is the environment.
4. `xtrm.agent.scope.v1` resets on every reload because it lives in `sessionStorage`.
5. Nothing is searchable; the only discovery path is the gear icon.
6. Pi-viewer design docs already reference console palettes
   (`docs/design/palette-console.md:4`), so the vocabulary drift is documented, not
   accidental.

---

## 3. Proposal: one model, three layers, one surface

### 3.1 Principles

1. **One schema, three layers, provenance always visible.** Any row can answer "which
   layer supplies this value", the way t3code's `ResolvedProjectSettings.sources` does.
2. **Store per scope, not per app.** Device values belong to a screen, host values to an
   agent host, project values to a repository. An app does not own a setting and does
   not get a copy.
3. **A setting is either device-scoped or scope-scoped, and the page says which** — the
   `SETTINGS_DEVICE_ONLY_PATHS` pattern.
4. **Settings sections are routes.** Nothing configurable lives inside the sidebar
   beyond quick, reversible toggles.
5. **Every key is defaulted and validated.** A missing or old value can never break a
   boot, including the pre-paint path.
6. **Migrate by read-through, never by rewrite.** Old keys stay readable; the new key
   is written on the first change.

### 3.2 The model

```text
AppSettings  (one TypeScript type, one defaults object, one validator per key)
├── appearance     theme: "system"|"light"|"dark"   density: row heights
│                  palette: preset | {sidebar, chat, text}          [device]
│                  chatWidth: comfortable|wide|full|custom           [device]
│                  fontSizeScale, reducedMotion, codeWordWrap        [device]
├── layout         sidebarOpen, sidebarWidth, inspectorWidth         [device]
│                  lastRepository, agentScope, view ("channel"|"events")
├── connections    hostMode: ssh|direct, sshTarget, remoteCommand,
│                  directUrl, deviceName                              [host]
│                  githubAccount (display facts only)                 [host]
├── integration    explicit binding overrides: pmProject, jiraSite,
│                  jiraProject, boardSite, boardStateDir, credentialFile
│                  each with `resolvedBy` provenance                  [project]
└── advanced       protocol version, mock adapters, log verbosity     [host]
```

Layer precedence, lowest to highest:

```text
 default (compiled DEFAULT_APP_SETTINGS)
   < device   (per surface; localStorage)
     < host   (per agent host; served over the bridge)
       < project (committed overrides; only where an explicit override is legal)
```

Each resolved key carries provenance:

```ts
type Source = "default" | "device" | "host" | "project";
type Resolved<T> = { value: T; source: Source };
```

The settings UI renders `SettingsRow` with a small "from project" / "inherited from the
host" hint. This is the single most valuable idea in t3code's settings system and it
costs one field.

A caution that keeps this honest: the integration binding is currently **derived**, not
stored — `IntegrationSurface` reports `resolvedBy` as `explicit | env | repo_slug | repo_name`
(`src/project/settings/IntegrationSurface.tsx:26-32`). The project layer must therefore
hold *explicit overrides only*, and must keep reporting the same `resolvedBy` vocabulary,
or we would create a second source of truth for the same fact.

### 3.3 Storage

Three stages. Each is shippable alone; later stages do not rewrite earlier ones.

**Stage 1 — shared schema and vocabulary, no store change.**
One module, for example `packages/xtrm-app/src/lib/settings/schema.ts` (the viewer
imports the same file through the workspace, the way both apps already share
`layout.ts` primitives by hand):

- `AppSettings`, `DEFAULT_APP_SETTINGS`, `SETTINGS_SCOPE: Record<keyof AppSettings, Scope>`,
  `parseSettings(raw): AppSettings` with per-key defaults, and the section label record
  that nav, breadcrumb and search all consume.
- Console keys become `xtrm.console.settings.v1` (one document, one write path,
  replacing the four keys in 2.1 with a read-through migration).
- Viewer keys become `pi-viewer.settings.v1` for its device subset, with read-through
  from `pi-viewer-theme` / `-palette` / `-colours` / `-chat-width`.
- Theme gains `"system"`; both apps resolve it at boot through the shared helper. The
  viewer's pre-paint script (`packages/pi-viewer/index.html:7-30`) is replaced by a
  generated inline snippet from the same defaults, so the third copy disappears.
- Cost: no new endpoint, no protocol change. This stage alone removes the
  different-defaults theme bug and the duplicated layout clamps.

**Stage 2 — host-authoritative document for cross-surface values.**
`connections` and `advanced` already live on the agent host
(`src/adapters/agent/host-connection.ts:92`). Extend that store to hold the whole host
and device layer as one document, for example `~/.xtrm/console/settings.json`, with:

```text
GET  /settings        -> { settings, sources, revision }
PATCH /settings       -> { patch } -> { settings, sources, revision }
```

Both apps read it through the bridge they already have, and keep localStorage as a
**cache for first paint only** (exactly t3code's `client-settings.json` +
`localApi.ts:59-72` split, where the server document is authoritative and the browser
copy is a mirror).

This is what actually makes console and viewer read the same values: the two apps are
served from different origins (`packages/pi-viewer/src/shell/layout.ts:12` says so
explicitly), so `localStorage` cannot be shared. Options considered:

| Option | Verdict |
| --- | --- |
| Serve both apps from one origin | cleanest for storage, but a deployment change, not a settings change; list as an alternative, not a dependency |
| Server-authoritative document over the existing bridge | **chosen**; matches t3code, needs one endpoint |
| `BroadcastChannel` / `storage` events | same-origin only, so it solves live sync inside one app, not between the two |
| Copy values at build time | stale by construction |

**Stage 3 — live sync and cross-surface propagation.**
Same-origin: `storage` events refresh the cache. Cross-origin: the bridge already has a
stream for agent state; a settings revision in that stream is enough to refresh without
polling. Not required for the first two stages.

### 3.4 Where each current setting moves

| Current | New home | Layer | Action |
| --- | --- | --- | --- |
| `xtrm.console.theme.v1` | `appearance.theme` | device | migrate; add `"system"` |
| `pi-viewer-theme` | `appearance.theme` (viewer subset) | device | migrate; same default as console |
| `pi-viewer-palette`, `pi-viewer-colours` | `appearance.palette` | device | migrate; keep the five preset ids |
| `pi-viewer-chat-width` | `appearance.chatWidth` | device | migrate; console gains the same control |
| `xtrm.console.layout.v1` | `layout.*` | device | migrate; **one** clamp table used by both apps |
| `pi-viewer-sidebar` (folded groups) | `layout.foldedGroups` | device | migrate; cap the list length |
| `xtrm.console.repo.v1` | `layout.lastRepository` | device | migrate; one constant, not two |
| `xtrm.agent.scope.v1` (sessionStorage) | `layout.agentScope` | device | promote to persistence |
| `xtrm.agent.names.v1` | `layout.agentNames` | device | migrate as-is |
| `xtrm-viewer:last-seen:*` | leave as a prefix map | device | keep out of `AppSettings`; read state is a log, not a setting |
| host connection (`/settings` on the host) | `connections.*` | host | same store, wider document |
| integration binding (derived) | `integration.*` as *explicit overrides only* | project | new page; keeps `resolvedBy` |
| `view` (channel/all events), not persisted | `layout.view` | device | persist |

### 3.5 The surface

**Information architecture.** Six sections. Two of them are device-scoped, two are
scope-scoped, two are informational.

```text
/settings                       redirects to /settings/general
├── general      Who you are, what this console is attached to (read-mostly)
├── appearance   theme (system/light/dark), palette, density, chat width, motion   [device]
├── layout       sidebar, inspector, folded groups, reset to defaults              [device]
├── connections  agent host (ssh | direct), GitHub account, board, substrate       [host]
├── project      binding overrides + the existing read-only Integration facts      [project]
└── advanced     protocol, adapters (mock/live), logs, versions                    [host]
```

Rules:

- Sections are routes with anchor ids; the label record feeds nav, breadcrumb and search
  (pattern 1.2). Search with `/` or `Cmd/Ctrl+F`, deep-linking to `#anchor`.
- `appearance` and `layout` are declared device-scoped and show no project scope control.
  `connections`, `project`, `advanced` show the scope chips.
- Reset to defaults is per section and per row, shown only when the resolved value
  differs from `DEFAULT_APP_SETTINGS` (pattern: `SettingResetButton`,
  `settingsLayout.tsx:584`).

**The sidebar drop-up, redesigned.** Today it is a read-only status panel
(`src/shell/ContextSidebar.tsx:109-177`) with four rows, a transport line and no
actions. Keep that job, add a job: it becomes the *system and quick-settings* panel — the
one place where the state of the machine and the three reversible preferences meet. The
connection facts do not move out of the sidebar: the trigger keeps the summary and the
panel keeps the rows at the top.

**It must not float.** The operator's requirement, and the better design: the panel is not
a detached popover, it is the trigger *unfolded*. Same surface, same border, same
background, no gap, no portal, no drop shadow floating over unrelated content. The card's
bottom edge stays pinned to the bottom of the sidebar; the header rides the top edge as
the card grows upward; the chevron rotates; the health summary line stays visible in the
header while open, so the panel never hides the thing it is about.

The console already owns the exact idiom. `SidebarSection` collapses and expands in place
with `aria-expanded`, a `grid-template-rows` transition and `inert` (`src/ui/sidebar.tsx:9-29`):

```tsx
// packages/xtrm-app/src/ui/sidebar.tsx:20-27 (current code, unchanged)
<div className={cx("grid transition-[grid-template-rows] duration-150",
                   open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
  <div className="flex min-h-0 flex-col gap-px overflow-hidden" inert={!open}>
```

The proposal is to lift that pair into one primitive — `UnfoldPanel` — and use it for both
triggers in the sidebar. No new animation library, no popover positioning, no portal, and
the reduced-motion behaviour is already handled by `SHELL_MOTION`
(`src/shell/layout.ts`).

Closed, in the sidebar (today's anatomy, unchanged):

```text
+--------------------------------------------+
|  Overview                                  |
|  Integration                               |
|  +--------------------------------------+  |
|  | * All sources live      ssh 12 ms  ^ |  |  <- trigger: status + transport + latency
|  +--------------------------------------+  |
+--------------------------------------------+
```

Opening, second frame of the transition (the card grows upward, header on its top edge):

```text
+--------------------------------------------+
|  Overview                                  |
|  +--------------------------------------+  |
|  | * All sources live      ssh 12 ms  v |  |
|  |--------------------------------------|  |
|  | DATA SOURCES                 4 / 4   |  |  <- first section revealed
|  +--------------------------------------+  |
+--------------------------------------------+
```

Open (`Mod+,`; `max-h-[60vh]`, header pinned, body scrolls):

```text
+--------------------------------------------+
|  Overview                                  |
|  +--------------------------------------+  |
|  | * All sources live      ssh 12 ms  v |  |
|  |--------------------------------------|  |
|  | DATA SOURCES                 4 / 4   |  |
|  |   * Board          agent-host   8 ms |  |
|  |   * Agent host     live (ssh)        |  |
|  |   * GitHub         live              |  |
|  |   * Substrate      live              |  |
|  |   * Research       mock              |  |
|  |   ssh dev@box · sb 0.9.3 · proto 3   |  |
|  |--------------------------------------|  |
|  | APPEARANCE                           |  |
|  |   Theme    [ System | Light | Dark ] |  |
|  |   Palette  [ Threads v ]   (threads) |  |
|  |--------------------------------------|  |
|  | GO TO                                |  |
|  |   Appearance                      >  |  |
|  |   Connections                 ssh >  |  |
|  |   Project integration     2 gaps  >  |  |
|  |   All settings              Cmd , >  |  |
|  +--------------------------------------+  |
+--------------------------------------------+
```

Behaviour:

- Trigger keeps its meaning and its width (`w-full`, one row, `h-7`); it gains
  `aria-expanded`, `aria-controls`, and `Mod+,`. Collapsed it is exactly today's bar, so
  the sidebar gains no height while closed.
- The panel is the sidebar's own width minus the same `px-2` inset, not `w-72`. A panel
  that is wider than its trigger cannot look like the trigger unfolding, so the content
  reflows to the sidebar width: two-line rows, trailing values right-aligned.
- Quick settings are reversible in place: a three-way theme segmented control and the
  palette preset. Anything with a Save/Cancel form does **not** live here. The SSH target
  form (`src/agent/HostConnection.tsx:63-108`) moves to `/settings/connections`, and the
  panel offers "Change host target..." as a navigation row. A form with a save button
  inside a disclosure has no place to report a validation failure; a route does.
- Navigation rows carry the current value as trailing text (`ssh`, `2 gaps`), so the
  panel answers "what is it now" without a round trip.
- Disclosure semantics, not menu semantics: the panel contains a radiogroup and links, so
  `role="menu"` would lie. `Tab` moves within the panel; `Escape` collapses and returns
  focus to the trigger; clicking elsewhere does not collapse it (a disclosure is not
  modal), and the header row is always the collapse control.
- The panel is bounded (`max-h-[60vh]`) and scrolls internally, so a long source list
  cannot push the sidebar navigation off screen.
- Reduced motion: the transition honour `SHELL_MOTION` and becomes instantaneous.

**The same primitive serves the repository selector.** `RepositorySelector`
(`src/shell/ContextSidebar.tsx:21-107`) is the other floating surface in the sidebar: a
two-line trigger and a detached `w-72` popover with a filter field and a `role="listbox"`.
It becomes an unfolding panel with identical mechanics, growing *downward* because it
sits at the top:

```text
Closed                                   Open
+----------------------------+           +----------------------------+
| Repository            v    |           | Repository            ^    |
| xtrm/xtrm                  |           | xtrm/xtrm                  |
+----------------------------+           |----------------------------|
                                         | [ filter repositories... ] |
                                         |  * xtrm/xtrm      2h ago   |
                                         |    xtrm/console   1d ago   |
                                         |    xtrm/board     3d ago   |
                                         |----------------------------|
                                         |   All repositories      >  |
                                         +----------------------------+
```

Both panels then share one primitive, one transition, one focus contract and one
`aria-expanded` convention, which is why this belongs in `src/ui/` rather than in the
sidebar. The console-v3 lane (agent 25nn) is reworking these components; the primitive is
the piece to hand over, so v3 adopts it instead of inventing a third popover.

Settings page frame, for reference:

```text
+-------------------------------------------------------------------------------+
| Console                                                    theme  account  gear |
+-------------------------------------------------------------------------------+
| Settings                                                    /  search settings  |
|--------------------------------------------------------------------------------|
| General        | Theme                                        [ System  Light  Dark ]|
| Appearance     |   Follows the operating system unless you choose.          reset |
| Layout         |--------------------------------------------------------------|
| Connections    | Palette preset          Sidebar  Chat  Text                  |
| Project        |   [ Threads v ]         [ dark v ][ dark v ][ soft v ]          |
| Advanced       |--------------------------------------------------------------|
|                | Chat width              [ Comfortable | Wide | Full ]  ----o--  |
|                |   Applies to the threads viewer and the console transcript.   |
|                |--------------------------------------------------------------|
|                | Rod height          [ Compact | Comfortable ]                |
|                |   Derived from project: xtrm (set in t3-style project file)   |
+-------------------------------------------------------------------------------+
```

(Third-party project-file naming intentionally not decided here; see open question 1.)

### 3.6 Keyboard map

| Action | Binding | Notes |
| --- | --- | --- |
| Expand or collapse the system panel | `Mod+,` or the header row | supplements the existing gear; `Mod+,` is the platform convention for settings |
| Open full settings | the palette action, or the last row of the panel | palette gains an `Open settings` action with the same search terms t3code uses |
| Focus settings search | `/` or `Mod+F` | ignored while typing or in a dialog |
| Move inside the expanded panel | `Tab` / `Shift+Tab`; `Left`/`Right` inside a segmented row | disclosure semantics, not menu semantics, because the panel contains a radiogroup and links |
| Collapse | `Esc` | returns focus to the header row; already the app-wide pattern (`src/shell/layout.ts:73-82` suppression rules) |
| Leave settings | `Esc` | same suppression rules as the rest of the shell |

`Mod+,` must not collide: the current tables are `Mod+.`, `Mod+1..5`
(`src/shell/AppShell.tsx:47-74`), `Mod+B`/`Mod+I`/`Shift+Enter` in the shell, `Mod+K`
palette. `Mod+,` is free.

### 3.7 Migration

1. Ship the schema module and both apps' read-through (`old key ?? new document`), write
   only the new key.
2. Ship the new surface reading the schema, keeping old pages reachable until the new
   sections exist (`/settings` already redirects; `IntegrationSurface` stays mounted at
   `/project/settings` until `/settings/project` renders the same component).
3. Delete the old keys and the duplicated `index.html` boot script one release later,
   with a test that the pre-paint theme matches the resolved document.

### 3.8 Rejected alternatives

- **One giant `localStorage` document shared by both apps.** Impossible across origins
  (`packages/pi-viewer/src/shell/layout.ts:12`), and it would put host-scoped facts on a
  device.
- **Host store only, no device layer.** Every operator gets the same theme and the same
  sidebar width on every machine; the sidebar state would need a save round trip to
  toggle.
- **A settings modal instead of routes.** Cheap to build, but nothing is linkable, the
  palette and the native menu cannot target a section, and deep links from the drop-up
  disappear.
- **Copy t3code's twenty-three sections.** Sections we cannot fill become dead ends; six
  is what the data supports (2.1, 2.2).
- **A floating popover for the sidebar drop-up.** It detaches the panel from the control
  that owns it, needs positioning and collision logic, and cannot be wider than its
  trigger without looking unrelated. The in-place unfold reuses an idiom the console
  already ships (`src/ui/sidebar.tsx:9-29`); see 3.5.
- **Import the console's settings components into threads.** Different token layer,
  different router, and a surface mid-rework; see 3.9 for the split that does work.

---

### 3.9 Shared code between console and threads: the model, not the components

The lead relayed the operator's question: is settings going to be the first parity
integration between console and threads, and if we are going to do any work on threads,
should we instead do it in the console and import it?

Short answer: settings can be the first parity integration for the **model and the store**,
not for the **surface**. Do not import console components into threads.

The reason is structural, and section 1.4 is the evidence. t3code looks like a desktop app
and a web app sharing settings; in fact it has one renderer (`apps/web`) hosted twice, and
the only thing that differs between the hosts is a persistence seam
(`apps/web/src/localApi.ts:69-81`). Shared *components* never cross that seam, because
there is nothing to cross. Console and threads are the harder case t3code does not have:
two independently built UIs, two routers, two visual systems, two dependency graphs.

What t3code shares between packages is pure model, and that is the transferable part:

| Shared | Where | Why it survives two UIs |
| --- | --- | --- |
| schema + defaults | `packages/contracts/src/settings.ts:416, :623` | no React, no styling, no router |
| composed facade type | `settings.ts:1847-1848` | one vocabulary for both surfaces |
| project/provenance resolver | `packages/shared/src/projectSettings.ts:21-81` | returns data, not markup |
| keybinding defaults | `packages/shared/src/keybindings.ts:89-95` | declarations, not components |

Everything else stays per app. Importing the console's settings components into threads
would fail on four counts, in order of severity:

1. **Different token layer.** Threads sets `data-palette`, `data-sidebar`, `data-text` and
   the `--chat-lane` variable on the root element
   (`origin/xt/thread-lead:packages/pi-viewer/src/lib/palette.ts:158-165`,
   `src/App.tsx:98-101`). Console components are written against its Tailwind theme
   (`bg-strip`, `text-ink-faint`). A component moved across needs a token translation layer,
   which is more work than writing the surface twice and worse to maintain.
2. **Different navigation model.** The console routes with the TanStack router and a
   sidebar (`src/app/router.tsx`). Threads keeps scope in the query string (`?s=&w=&p=`,
   `origin/xt/thread-lead:packages/pi-viewer/src/lib/scope.ts`) and has no settings route
   at all. A shared settings tree would have to own navigation for both.
3. **The console surface is about to change.** The console-v3 lane (agent 25nn) is
   reworking exactly these components. Importing them into threads would couple threads to
   a surface mid-rework.
4. **The repository already refuses this coupling, deliberately.** Threads re-implements
   the shell primitives by hand and says why:
   `origin/xt/thread-lead:packages/pi-viewer/src/shell/layout.ts:12-13` — "A different
   origin from the console's, so the values never collide" — next to hand-copied
   `SHELL_MOTION`, `modShortcut` and `isShortcutSuppressed` (`:16-30`). That duplication is
   the precedent, and it is the right one for presentation.

So the split is:

```text
share (no UI):    schema · defaults · scope map · validators · migration ·
                  Source/Resolved<T> · provenance resolver · section label keys ·
                  the UnfoldPanel presentational primitive (no tokens, no router)
per app:          routes · panels · rows · triggers · keyboard wiring · local preview
```

Placement: issue 1 starts inside `packages/xtrm-app/src/lib/settings/` and moves to a real
workspace package (`packages/xtrm-settings`) once threads is merged and needs to import it.
Threads has no workspace package today; publishing the model before the second consumer
exists would be a package nobody imports.

Settings is the right first parity integration because it is small, reversible, currently
duplicated in two incompatible shapes, and it exercises the two hard parts of parity — a
shared vocabulary and a shared store — without touching agent execution. The ordering
matters: model and host document first (issues 1 and 6), then the console-v3 surface
consumes them, then threads reads the same document (issue 8). Reversed, the console
rework ships a third copy of the settings shape.

## 4. Follow-up issues (proposed, not filed)

1. **Shared settings schema module** — `AppSettings`, `DEFAULT_APP_SETTINGS`, per-key
   scope map, validators with defaults, the section-label record, and a unit test that
   every key has a default and a scope. Scope: one new module plus tests in
   `packages/xtrm-app/src/lib/settings/`. Size **S** (or **M** if it must be published as
   its own package for the viewer).
2. **Console: settings route tree and section nav** — six routes, anchor ids, the shared
   label record, breadcrumb, reset affordances; `/settings` redirects to
   `/settings/general`; existing `SettingsSurface` becomes `/settings/connections`'s
   account block. Size **M**.
3. **Console: `UnfoldPanel` in-place expansion for the sidebar drop-up and the
   repository selector** — one primitive built on the existing `grid-template-rows` idiom
   (`src/ui/sidebar.tsx:9-29`); `SourceFooter` becomes `SystemMenu` (status block unchanged,
   quick appearance, "Go to" rows with trailing values, `Mod+,`, disclosure semantics);
   `RepositorySelector` loses its floating `w-72` popover and unfolds the same way. Hand the
   primitive to the console-v3 lane (agent 25nn). Tests for closed, opening and open states
   of both panels. Size **M**.
4. **Console: move host connection forms to `/settings/connections`** — SSH target,
   remote command, direct pairing, status ladder and "Open in terminal" move to the
   route; the sidebar keeps status and a navigation row; the inline form and its
   Save/Cancel are deleted. Size **M**.
5. **Console: appearance and layout pages** — theme `system|light|dark`, palette presets
   (adopt the viewer's five ids and three planes), density, chat width, motion; layout
   page for sidebar/inspector sizes and folded groups; promote `agentScope` from
   `sessionStorage` to the device document. Size **M**.
6. **Host-authoritative settings document and bridge endpoint** — one JSON document on
   the agent host (`GET`/`PATCH`, revision, atomic write), console and viewer read it,
   localStorage becomes a first-paint cache, provenance returned per key. Size **L**
   (protocol + both clients + migration).
7. **Settings search with deep links, palette action, and `Mod+,`** — `/` and `Mod+F`
   focus, arrow/`Enter`, `#anchor` targets with highlight, `Open settings` palette
   action, keybinding entry; depends on 2. Size **M**.
8. **Threads: settings surface on the shared schema** — replace `PaletteControl` and
   `ChatWidthControl` popovers with one `/settings`-style popover or route that reads the
   shared document; kill the duplicated pre-paint table in `packages/pi-viewer/index.html`
   in favour of generated defaults; keep the "dark only" preset note as data, not prose.
   Size **M**. Depends on 1; on 6 for live sharing.
9. **Cleanup: duplicated constants and docs** — single repository-key constant (remove
   the second declaration at `src/app/router.tsx:40`); shared clamp table for sidebar
   bounds; update `docs/design/sidebar-restyle.md`, `docs/design/console-ui-system.md`
   and the `docs/research-t3-gui/reuse-inventory.md:22` row that currently defers
   settings. Size **S**.

## 5. Decisions and open questions for the lead

Decided by the operator on 2026-11-27 (relayed through the lead thread):

1. **Project layer storage — decided: host only.** Explicit project overrides live in the
   host settings document, with no committed project file, until the resolver has a real
   override precedence. The model still returns per-key provenance, because the resolver
   already knows three sources and the UI must be able to say which one won.
2. **Product name — decided: "threads".** The product is threads; `packages/pi-viewer` is
   the path of its implementation. This report uses "threads" for the product and the
   package path when citing code. User-facing labels say "Threads".

Still open:

3. **Sequencing against the threads branch.** `packages/pi-viewer` is unmerged
   (`origin/xt/thread-lead`). Issues 1 and 6 land without it; issue 8 needs its merge;
   issues 2, 3, 5 are the console-v3 lane's to absorb.
4. **Endpoint ownership (the question that was unclear).** The shared settings document
   must live somewhere both apps can reach. The natural place is the agent host, reached
   over the bridge the console already uses: `HostConnection` posts its SSH settings to
   `/settings` on the host today
   (`packages/xtrm-app/src/adapters/agent/host-connection.ts:92`). Making that endpoint
   carry the whole settings document (`GET` returns `{settings, sources, revision}`,
   `PATCH` accepts a partial) is a small addition to an endpoint that already exists. The
   open question is only *who owns that change*: the agent-host bridge likely lives
   outside `packages/xtrm-app`, so issue 6 may need to split into a host-side issue and a
   client-side issue, dispatched separately.
5. **Console-v3 coordination.** Issues 2, 3 and 5 touch components the console-v3 lane
   (agent 25nn) is reworking. The lead should decide whether they are dispatched to that
   lane directly, or executed after v3 lands. The `UnfoldPanel` primitive in issue 3 is
   worth handing to v3 regardless, because it replaces two floating popovers with one
   mechanism that already exists in `src/ui/sidebar.tsx:9-29`.

## 6. Evidence index

- t3code (at `da36859cb`): `apps/web/src/routes/_chat.settings.tsx`,
  `apps/web/src/components/{AppRouteModal.tsx,CommandPalette.tsx,CommandPaletteSettingsItems.tsx}`,
  `apps/web/src/components/settings/{settingsSearch.ts,SettingsSidebarNav.tsx,SettingsPanels.tsx,settingsLayout.tsx,SettingsGroup.tsx,FoldedSettingsSection.tsx,SettingsScopeSentence.tsx,SettingsScopeNotice.tsx}`,
  `apps/web/src/components/sidebar/SidebarChrome.tsx`, `apps/web/src/components/AppSidebarLayout.tsx`,
  `apps/web/src/hooks/useSettings.ts`,
  `apps/web/src/localApi.ts`, `apps/web/src/clientPersistenceStorage.ts`,
  `packages/contracts/src/settings.ts`, `packages/contracts/src/keybindings.ts`,
  `packages/shared/src/{projectSettings.ts,keybindings.ts}`,
  `apps/desktop/src/{window/DesktopApplicationMenu.ts,app/DesktopEnvironment.ts,app/DesktopEarlyElectronStartup.ts,settings/DesktopClientSettings.ts,ipc/methods/clientSettings.ts}`.
- Console: `packages/xtrm-app/src/{settings/SettingsSurface.tsx,project/settings/IntegrationSurface.tsx,agent/HostConnection.tsx,shell/ContextSidebar.tsx,shell/context.tsx,shell/layout.ts,shell/AppShell.tsx,app/destinations.ts,app/router.tsx,ui/sidebar.tsx,agent/AgentSidebar.tsx,adapters/agent/live.ts}`.
- Threads app: `packages/pi-viewer/{index.html,src/App.tsx,src/lib/{palette.ts,chat-width.ts,readstate.ts},src/shell/layout.ts,src/components/{PaletteControl.tsx,ViewerHeader.tsx,sidebar/Sidebar.tsx}}` at `origin/xt/thread-lead`.
