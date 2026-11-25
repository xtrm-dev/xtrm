# Palette switch: Threads and Console (XTRM-1046)

The header has a Colours control (palette glyph, 16px): **Colours: Threads | Console**. Default Threads,
persisted in `localStorage` under `pi-viewer-palette`, applied as `data-palette` on `<html>` (set before
first paint by `index.html`). Switching rewrites CSS variables only; no component forks, no reload, no scroll change.
The operator decides which palette stays; this document records what each one is.

## Source of the console values

`packages/xtrm-app` on `xt/thread-lead` (f20d42ba). The refactor previewed on :5179 is not running on this
host and no other worktree holds a different console source: `xtrm-xt-pi-console-c` differs from this tree in
`src/styles.css` only by two scrollbar lines. This tree is the refactor in the respects that matter here
(`src/ui/icon.tsx:139` `sm: "size-4"`, the 16px glyph step). All `file:line` below are in `packages/xtrm-app/src/`.

## What differs

Every `--x-*` colour token in the viewer already equals the console's, with one exception: the dark sidebar
(`#181818` in Threads by operator ruling 2026-11-25, `#232323` in the console). The rest of the difference is
**which plane each region wears**. The viewer gained region-role tokens so the two assignments swap by variable.

### Region assignment

| Region | Threads | Console | Console source |
|---|---|---|---|
| Page canvas, thread, presence line, composer margin, header bar | `deep` | `surface` | `shell/AppShell.tsx:82` (`bg-surface`); the top bar has no fill, `shell/AppShell.tsx:25` |
| Sidebar plane | `sidebar` | `sidebar` | `shell/AppShell.tsx:93` (`bg-sidebar`) |
| Composer fill | `surface`, `raised` on focus | `surface`, unchanged on focus | `agent/Composer.tsx:279` |
| Composer edge | none | `border`, `border-strong` on focus | `agent/Composer.tsx:279` (`border-border`, `focus-within:border-border-strong`) |
| Composer input | transparent | transparent | `agent/Composer.tsx:296` (`bg-transparent`) |
| Rendered code frame | `surface`; hairline in light only | `deep`; `border-muted` in both | `styles.css:302-303` (`.xtrm-prose pre`) |
| Quiet panels in the thread (activity detail, intercom card) | `surface` at 40 / 70% | `control` at 40 / 70% | no console counterpart; chosen so the panel stays visible when canvas = surface |
| Popovers, presence panel, tooltips | `raised` + `shadow-float` | unchanged | `shell/ContextSidebar.tsx:54`, `shell/InspectorDock.tsx:122` (`bg-raised`) |

### Tokens, dark

| Token | Threads | Console | Console source |
|---|---|---|---|
| `--x-canvas` | `var(--x-deep)` = `#0d0d0d` | `var(--x-surface)` = `#151515` | `styles.css:78`, `:80` |
| `--x-sidebar` | `#181818` | `#232323` | `styles.css:79` |
| `--x-surface` | `#151515` | `#151515` | `styles.css:80` |
| `--x-raised` | `#1e1e1e` | `#1e1e1e` | `styles.css:81` |
| `--x-control` | `#262626` | `#262626` | `styles.css:82` |
| `--x-composer-focus` | `var(--x-raised)` = `#1e1e1e` | `var(--x-surface)` = `#151515` | `agent/Composer.tsx:279` |
| `--x-composer-edge` | `transparent` | `var(--x-border)` = `rgb(255 255 255 / .12)` | `styles.css:90` |
| `--x-composer-edge-focus` | `transparent` | `var(--x-border-strong)` = `rgb(255 255 255 / .18)` | `styles.css:91` |
| `--x-inset` | `var(--x-surface)` | `var(--x-control)` = `#262626` | viewer role |
| `--x-code` | `var(--x-surface)` | `var(--x-deep)` = `#0d0d0d` | `styles.css:302` |
| `--x-code-edge` | `transparent` | `var(--x-border-muted)` = `rgb(255 255 255 / .08)` | `styles.css:88`, `:303` |

### Tokens, light

| Token | Threads | Console | Console source |
|---|---|---|---|
| `--x-canvas` | `var(--x-deep)` = `#f4f4f5` | `var(--x-surface)` = `#ffffff` | `styles.css:16`, `:18` |
| `--x-sidebar` | `#f4f4f5` | `#f4f4f5` | `styles.css:17` |
| `--x-surface` | `#ffffff` | `#ffffff` | `styles.css:18` |
| `--x-raised` | `#ffffff` | `#ffffff` | `styles.css:19` |
| `--x-control` | `#efeff1` | `#efeff1` | `styles.css:20` |
| `--x-composer-focus` | `var(--x-raised)` = `#ffffff` | `var(--x-surface)` = `#ffffff` | `agent/Composer.tsx:279` |
| `--x-composer-edge` | `transparent` | `var(--x-border)` = `rgb(15 15 20 / .11)` | `styles.css:29` |
| `--x-composer-edge-focus` | `transparent` | `var(--x-border-strong)` = `rgb(15 15 20 / .2)` | `styles.css:30` |
| `--x-inset` | `var(--x-surface)` | `var(--x-control)` = `#efeff1` | viewer role |
| `--x-code` | `var(--x-surface)` | `var(--x-deep)` = `#f4f4f5` | `styles.css:302` |
| `--x-code-edge` | `var(--x-border-muted)` | `var(--x-border-muted)` = `rgb(15 15 20 / .07)` | `styles.css:26`, `:303` |

The text, border, accent, danger and success tokens are identical in both palettes and in the console
(`styles.css:21-45`, `:83-103`), so no text or border token is swapped.

## Where the viewer reads them

`src/styles.css` (`:root` Threads roles, `:root[data-palette="console"]` overrides, `.xtrm-composer-box`,
`.xtrm-code`); `bg-canvas` on the shell roots, the composer margin, the presence wrapper and the All events
sticky header; `bg-inset` on the four quiet panels; `xtrm-composer-box` on the composer.

## Contrast

`npm run test:contrast` resolves the tokens for all four sets (Threads and Console, dark and light) and checks
ink, ink at 90%, ink-muted, accent-ink and danger against deep, surface, raised, control, canvas, sidebar,
composer-focus, code and inset: every pair is at least 4.5:1. `ink-faint` stays a glyph role (INFO lines).
