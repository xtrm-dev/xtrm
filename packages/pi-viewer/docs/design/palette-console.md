# Palettes: Threads, Console and Desktop (XTRM-1046, XTRM-1051)

The header has a Colours control (palette glyph, 16px): **Colours: Threads | Console | Desktop**. Default Threads,
persisted in `localStorage` under `pi-viewer-palette`, applied as `data-palette` on `<html>` (set before
first paint by `index.html`). Switching rewrites CSS variables only; no component forks, no reload, no scroll change.
The operator decides which palette stays; this document records what each one is. Console and Threads are
described first, Desktop (XTRM-1051) in its own section below, with a token table across all three.

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

`npm run test:contrast` resolves the tokens for all six sets (Threads, Console and Desktop, dark and light)
and checks ink, ink at 90%, read (thread prose), ink-muted, accent-ink and danger against deep, surface,
raised, control, canvas, sidebar, composer-focus, code, inset, the sidebar's selected row and the segmented
track: every pair is at least 4.5:1, except the six Desktop dark muted-text pairs listed under Desktop
(printed WARN, not waived silently). Thread prose is also held to 7:1 on the canvas in every palette.
`ink-faint` stays a glyph role (INFO lines).

## Desktop palette (XTRM-1051)

Source: the operator's values, extracted from Claude Desktop (2026-11-25, as supplied; the viewer shows only
the label "Desktop"). Dark only. In the light theme `data-palette="desktop"` matches no rule, so the light
theme is the **Threads light set**; the control says so ("dark only", tooltip "Dark theme. In the light theme
it uses the Threads colours."). The point is a dimmer reading colour: prose reads in secondary, names, titles
and selected rows in primary, meta in muted. Two new tokens carry it: `--x-read` (class `text-read`: the
Markdown body and the operator's bubble text) and `--x-selected` (class `bg-selected`: the selected sidebar
row). Both equal `ink` and `hover` in Threads and Console, so nothing changes there.

### Operator value to viewer token (dark)

| Operator value | Hex | Viewer token |
|---|---|---|
| base | `#1f1f1f` | `--x-deep` (so `--x-canvas`: page, header, thread, presence line) |
| sidebar | `#242424` | `--x-sidebar` |
| surface | `#333333` | `--x-surface` and `--x-raised` (cards, composer, quiet panels, popovers) |
| selected | `#454545` | `--x-selected` (sidebar row) and `--x-segment` (selected segment of the two switches) |
| input | `#383838` | `--x-control`, and the focused composer fill (`--x-composer-focus`) |
| text primary | `#e4e4e4` | `--x-ink` (names, titles, selected rows) |
| text secondary | `#c8c8c8` | `--x-read` (thread prose, operator bubble text); also the "icon primary" value |
| text muted | `#8e8e8e` | `--x-ink-muted` (meta, time, unselected labels, resting icons) |
| border | `#383838` | `--x-border` (and the code frame edge) |
| icon primary / muted | `#c8c8c8` / `#8e8e8e` | icons use `ink-muted` at rest and `ink` on hover; no separate token |

### Tokens, dark: Threads, Console, Desktop

| Token | Threads | Console | Desktop |
|---|---|---|---|
| `--x-deep` | `#0d0d0d` | `#0d0d0d` | `#1f1f1f` |
| `--x-canvas` | deep `#0d0d0d` | surface `#151515` | deep `#1f1f1f` |
| `--x-sidebar` | `#181818` | `#232323` | `#242424` |
| `--x-surface` | `#151515` | `#151515` | `#333333` |
| `--x-raised` | `#1e1e1e` | `#1e1e1e` | `#333333` |
| `--x-control` | `#262626` | `#262626` | `#383838` |
| `--x-segment` | `#4d4d4d` | `#4d4d4d` | `#454545` |
| `--x-selected` | hover wash | hover wash | `#454545` |
| `--x-ink` | `#ececef` | `#ececef` | `#e4e4e4` |
| `--x-read` | ink `#ececef` | ink `#ececef` | `#c8c8c8` |
| `--x-ink-muted` | `#a0a0a8` | `#a0a0a8` | `#8e8e8e` |
| `--x-border` | `rgb(255 255 255 / .12)` | same | `#383838` |
| `--x-composer-focus` | raised `#1e1e1e` | surface `#151515` | control `#383838` |
| `--x-composer-edge` | none | border | none (as Threads) |
| `--x-inset` | surface | control `#262626` | surface `#333333` (at 40 / 70%) |
| `--x-code` / `--x-code-edge` | surface / none | deep / border-muted | deep `#1f1f1f` / border `#383838` |
| `--x-danger` | `#f07171` | `#f07171` | `#f58f8f` (inferred, see below) |

Light: Desktop equals the Threads light column of the light table above.

Not supplied, so left as in Threads and **inferred**: `border-muted`, `border-subtle`, `border-strong`,
`ink-faint`, `hover`, `pressed`, `accent`, the role chips, the success and diff colours. `danger` is the one
inferred change: `#f07171` is 4.1:1 on the focused composer fill, so Desktop uses `#f58f8f` (5.1:1). The code
frame is a well cut into the canvas (deep plus the border) because muted text on `#333333` is below 4.5:1.

The adapter's two segmented controls and the sidebar need no Desktop rule: their `in-data-[palette=console]`
classes do not match, so they take the Threads behaviour with the Desktop planes (pill `#454545` on the
pressed track).

### Contrast, Desktop dark (`npm run test:contrast`)

| Pair | Ratio |
|---|---|
| prose `#c8c8c8` on canvas `#1f1f1f` | 9.85 (7:1 required) |
| prose on surface / control (user bubble) / selected row | 7.55 / 7.01 / 5.73 |
| ink `#e4e4e4` at 90% on canvas / surface / control / selected | 10.69 / 8.36 / 7.83 / 6.47 |
| muted `#8e8e8e` on canvas / sidebar / code / inset | all at least 4.5 (PASS) |
| muted on surface and raised | 3.86 (WARN) |
| muted on control and the focused composer | 3.58 (WARN) |
| muted on the selected sidebar row | 2.93 (WARN) |
| muted on the segmented pressed track | 4.26 (WARN) |

The six WARN pairs come from the operator's own values and are not tuned away. Rule for builders: in Desktop,
do not put muted text on surface, control or a selected row without a decision; the second line of a
selected sidebar row is the live case (2.93:1). Candidates, for the operator: read text (`#c8c8c8`) on those
planes, or a lighter muted (`#a0a0a0` is 4.8:1 on `#333333` and 4.5:1 on `#383838`).

## Presence pill edge (XTRM-1047)

The monogram pills in the presence line above the composer wear a 2px ring (`ring-2 ring-canvas`,
`src/components/presence/PresenceLine.tsx`). The ring equals the surrounding background, the console's
cut-out trick, so a pill reads as a cut-out and overlapping pills separate without an outline. It follows
the canvas token, so each combination uses its own surround (asserted by `npm run test:palette`):

| Palette / theme | Canvas, so the pill edge |
|---|---|
| Threads dark | `#0d0d0d` |
| Threads light | `#f4f4f5` |
| Console dark | `#151515` |
| Console light | `#ffffff` (it was `#f4f4f5`, the deep token, which outlined the pill) |
| Desktop dark | `#1f1f1f` |
| Desktop light | `#f4f4f5` (the Threads light set) |

The edge does not follow the line's hover fill (`bg-hover`, a translucent wash), so on hover the ring is
a hair lighter than the wash. The cut-out effect holds at rest, which is the state the operator compared.

## One-line action rows (XTRM-1047)

Rows marked `data-action-row` (`user`, `agent`, `code`) never take two lines. The user row puts the fold
control on the left and the meta actions (time, "to agent", delivery, Reply/Copy) on the right. Labels
shorten first ("Show full message" becomes "Show more" below 640px), then truncate (agent name, delivery
text, code language); icons and the time never shrink. `npm run test:rows` asserts it at 390 and 1440.
