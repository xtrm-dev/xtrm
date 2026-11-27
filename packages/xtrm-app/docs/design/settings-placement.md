# Settings placement

Where each setting of the shared model (`src/lib/settings`, XTRM-1101) is shown and changed.
Source: `settings-research.md` sections 3.2 to 3.5 (branch `xt/settings-research`), the thread
lead's acceptance of this table (2026-11-27), and the hosts agreement with XTRM-1077.

Surfaces:

- **Menu**: the console sidebar's System & settings drop-up (XTRM-1100). It holds quick, reversible
  choices and "Go to" rows.
- **Settings**: the `/settings` sections (XTRM-1103 builds the route tree). This is the full editor.
- **Threads**: the threads header popover.

| Setting (model key) | Scope | Menu | Settings | Threads |
| --- | --- | --- | --- | --- |
| Theme: System, Light or Dark (`appearance.theme`) | device | three-way control | appearance | toggle |
| Palette: presets or mix (`appearance.palette`) | device | none (console palettes arrive in XTRM-1105) | appearance | presets and mix |
| Chat width (`appearance.chatWidth`) | device | none | appearance | presets and slider |
| Density, font scale, motion, code wrap | device | none | appearance | none |
| Sidebar open and width, inspector width | device | none | layout: reset only. Direct control stays Mod+B and drag. | none |
| Folded groups (`layout.foldedGroups`) | device | none | layout: reset | none. The tree folds them in place. |
| Last repository (`layout.lastRepository`) | device | none. The repository selector expands from its trigger. | none | none. Scope comes from the URL. |
| Agent scope, thread view | device | none | layout | inline toggle |
| Agent names (`layout.agentNames`) | device | none | none. Renaming happens inline. | none |
| SSH target, remote command, direct URL, device name | host | status block, and a "Change host target…" row that opens the agent host panel | connections (editor) | none |
| Peers, connect-to (`connections.peers`, `connections.connectTo`) | device | Connections row with the current transport | connections (editor) | host picker and per-host status, with a link to connections |
| Host endpoint, Substrate remote | host; the Substrate remote takes a project override | Connections row | connections (editor) | link to connections |
| Project binding overrides (`project.*`) | project, stored on the host | Project integration row | project, with the read-only Integration facts | none |
| Adapters, log level (`advanced.*`) | host | none | advanced | none |

Rules:

1. The menu changes only reversible device choices in place. Today that is the theme. Everything
   else in the menu is a "Go to" row that shows the current value at the end of the row.
2. A "Go to" row whose section does not exist yet opens `/settings`. When XTRM-1103 adds a section,
   it retargets that row.
3. The endpoint token is a secret. It is never a setting and is never served by `GET /settings`.
