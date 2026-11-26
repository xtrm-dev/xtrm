# Palettes: Threads, Console, Desktop and the soft-text versions (XTRM-1046, XTRM-1051, XTRM-1053)

The header has a Colours control (palette glyph, 16px): **Colours: Threads | Threads · soft text | Console | Console · soft text | Desktop**. Default Threads,
persisted in `localStorage` under `pi-viewer-palette`, applied as `data-palette` on `<html>` (set before
first paint by `index.html`). Switching rewrites CSS variables only; no component forks, no reload, no scroll change.
Operator ruling (XTRM-1024 seq 17): all five palettes stay as the base for theming, and Threads is the default.
This document records what each one is. Console and Threads are described first, Desktop (XTRM-1051) and the soft-text versions (XTRM-1053) in their own sections below.

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
| Composer fill | `--x-composer-fill` = `surface`, one step up from the canvas; focus rises to `raised` | `--x-composer-fill` = `raised` (the canvas is `surface` here, so the box steps up); focus keeps that fill and deepens the shadow | `styles.css:104-110`, `:171-172`; `.xtrm-composer-box` `styles.css:749-765` (Desktop dark focus takes `control`, `styles.css:201`) |
| Composer elevation (XTRM-1087) | no border and no ring in any palette, preset, theme or state; a slight drop shadow (`--x-composer-shadow`) sets the box above the canvas, and focus deepens it (`--x-composer-shadow-focus`) | same | `styles.css:107-110`, `:157-160`; `.xtrm-composer-box` `styles.css:749-765`. The console's own composer (`agent/Composer.tsx:279`) still carries a border; the viewer no longer mirrors it |
| Composer box | `rounded-lg`; the input is 52px high at one line (24px line plus 14px padding above and below) | same | `components/Composer.tsx:154` (box), `:234` (`min-h-[calc(1lh+1.75rem)]`, `leading-6`) |
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
| `--x-composer-fill` | `var(--x-surface)` = `#151515` | `var(--x-raised)` = `#1e1e1e` | `styles.css:84`, `:151` |
| `--x-composer-focus` | `var(--x-raised)` = `#1e1e1e` (focus rises one plane) | `var(--x-raised)` = `#1e1e1e` (no plane left: the shadow deepens) | `styles.css:105`, `:172` |
| `--x-composer-shadow` | `0 1px 2px rgb(0 0 0 / .4), 0 10px 24px -18px rgb(0 0 0 / .72)` | same | `styles.css:159` |
| `--x-composer-shadow-focus` | `0 2px 6px rgb(0 0 0 / .5), 0 14px 32px -18px rgb(0 0 0 / .88)` | same | `styles.css:160` |
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
| `--x-composer-fill` | `var(--x-surface)` = `#ffffff` | `var(--x-raised)` = `#ffffff` | `styles.css:84`, `:151` |
| `--x-composer-focus` | `var(--x-raised)` = `#ffffff` (white is the ceiling: focus deepens the shadow) | `var(--x-raised)` = `#ffffff` (no fill step on white: the shadow deepens) | `styles.css:105`, `:172` |
| `--x-composer-shadow` | `0 1px 2px rgb(15 15 20 / .05), 0 8px 20px -16px rgb(15 15 20 / .16)` | same | `styles.css:109` |
| `--x-composer-shadow-focus` | `0 2px 4px rgb(15 15 20 / .07), 0 12px 28px -16px rgb(15 15 20 / .22)` | same | `styles.css:110` |
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

`npm run test:contrast` resolves the tokens for all ten sets (Threads, Threads · soft, Console, Console · soft and Desktop, dark and light)
and checks ink, ink at 90%, read (thread prose), ink-muted, accent-ink and danger against deep, surface,
raised, control, canvas, sidebar, composer-fill, composer-focus, code, inset, the sidebar's selected row and the segmented
track: every pair is at least 4.5:1. Thread prose is also held to 7:1 on the canvas in every palette.
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
| surface | `#333333` | `--x-surface` and `--x-raised` (cards, composer fill, quiet panels, popovers) |
| selected | `#454545` | `--x-selected` (sidebar row) and `--x-segment` (selected segment of the two switches) |
| input | `#383838` | `--x-control`, and the focused composer fill (`--x-composer-focus`) |
| composer | `#333333` | `--x-composer-fill` on the `#1f1f1f` base: one step up, no border (XTRM-1054) |
| text primary | `#e4e4e4` | `--x-ink` (names, titles, selected rows) |
| text secondary | `#c8c8c8` | `--x-read` (thread prose, operator bubble text); also the "icon primary" value |
| text muted | `#8e8e8e`, ruled up to `#a1a1a1` (see below) | `--x-ink-muted` (meta, time, unselected labels, resting icons); inside a selected row `--x-ink-muted-selected` = `#c8c8c8` |
| border | `#383838` | `--x-border` (and the code frame edge) |
| icon primary / muted | `#c8c8c8` / `#8e8e8e` (muted ruled up to `#a1a1a1`) | icons use `ink-muted` at rest and `ink` on hover; no separate token |

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
| `--x-ink-muted` | `#a0a0a8` | `#a0a0a8` | `#a1a1a1` (inside a selected row: `#c8c8c8`) |
| `--x-border` | `rgb(255 255 255 / .12)` | same | `#383838` |
| `--x-composer-fill` | surface `#151515` | raised `#1e1e1e` | surface `#333333` |
| `--x-composer-focus` | raised `#1e1e1e` | raised `#1e1e1e` | control `#383838` |
| `--x-composer-shadow` | dark pair | dark pair | dark pair (no border, no ring) |
| `--x-inset` | surface | control `#262626` | surface `#333333` (at 40 / 70%) |
| `--x-code` / `--x-code-edge` | surface / none | deep / border-muted | deep `#1f1f1f` / border `#383838` |
| `--x-danger` | `#f07171` | `#f07171` | `#f58f8f` (inferred, see below) |

Light: Desktop equals the Threads light column of the light table above.

**Muted ruling (operator, 2026-11-26).** The supplied muted `#8e8e8e` was below 4.5:1 on the lighter planes
(3.86 on `#333333`, 3.58 on `#383838`, 2.93 on `#454545`). The operator ruled `#a0a0a0`; the viewer uses
`#a1a1a1`, one step up, because `#a0a0a0` is 4.48:1 on the input fill `#383838` (below 4.5) and `#a1a1a1` is
4.54:1. Reverting is one token (`--x-ink-muted`). On the selected row and segment (`#454545`, 3.7:1 at best
with any muted grey) muted text reads in the secondary colour through a scoped rule
(`[aria-selected="true"]` redefines `--x-ink-muted` as `--x-ink-muted-selected`).

Not supplied, so left as in Threads and **inferred**: `border-muted`, `border-subtle`, `border-strong`,
`ink-faint`, `hover`, `pressed`, `accent`, the role chips, the success and diff colours. `danger` is the one
inferred change: `#f07171` is 4.1:1 on the focused composer fill, so Desktop uses `#f58f8f` (5.1:1). The code
frame is a well cut into the canvas (deep plus the border), as in Console.

The adapter's two segmented controls and the sidebar need no Desktop rule: their `in-data-[palette=console]`
classes do not match, so they take the Threads behaviour with the Desktop planes (pill `#454545` on the
pressed track).

### Contrast, Desktop dark (`npm run test:contrast`)

| Pair | Ratio |
|---|---|
| prose `#c8c8c8` on canvas `#1f1f1f` | 9.85 (7:1 required) |
| prose on surface / control (user bubble) / selected row | 7.55 / 7.01 / 5.73 |
| ink `#e4e4e4` at 90% on canvas / surface / control / selected | 10.69 / 8.36 / 7.83 / 6.47 |
| muted `#a1a1a1` on canvas / sidebar / code / inset | 6.38 / 6.01 / 6.38 / 5.78 |
| muted on surface and raised / control and the focused composer | 4.89 / 4.54 |
| muted on the segmented pressed track | 5.41 |
| muted in a selected row (`#c8c8c8` on `#454545`) | 5.73 |

Every pair is at least 4.5:1; the contrast check has no waived pairs.

## Soft-text versions (XTRM-1053)

The operator wanted to compare the dimmer **text** alone, and Desktop also changed the surfaces. **Threads · soft
text** and **Console · soft text** are their base palette with Desktop's text colours and nothing else.

Mechanism: a soft choice sets the root to the base's `data-palette` (`threads` or `console`) and adds
`data-text="soft"` (`src/lib/palette.ts`, `index.html`; persisted as `threads-soft` or `console-soft`). In
`src/styles.css` one block holds the text set and is shared with Desktop through a grouped selector
(`:root[data-palette="desktop"][data-theme="dark"], :root[data-text="soft"][data-theme="dark"]`), so no value is
written twice and no surface value appears in it. It matches in dark only; in light nothing matches and each
soft version equals its base. `test/palette.test.ts` proves that the layer sets only the four text variables,
that each soft version differs from its base in no other variable (every non-text variable resolves
byte-identical, including the ones that reference others), that the layer never names the light theme or a
selected row, and that Desktop's own non-text values are unchanged.

### Text tokens (dark)

| Token | Threads | Threads · soft | Console | Console · soft | Desktop |
|---|---|---|---|---|---|
| `--x-ink` (names, titles, selected rows) | `#ececef` | `#e4e4e4` | `#ececef` | `#e4e4e4` | `#e4e4e4` |
| `--x-read` (thread prose, operator bubble) | ink `#ececef` | `#c8c8c8` | ink `#ececef` | `#c8c8c8` | `#c8c8c8` |
| `--x-ink-muted` (meta, time, labels, resting icons) | `#a0a0a8` | `#a1a1a1` | `#a0a0a8` | `#a1a1a1` | `#a1a1a1` |
| `--x-ink-muted-selected` | unused | `#c8c8c8` (unused) | unused | `#c8c8c8` (unused) | `#c8c8c8` (selected row) |

Icons follow the text tokens they already use (`ink-muted` at rest, `ink` on hover). Every other token (canvas,
sidebar, surface, raised, control, selected, segment, borders, accent, danger, pill edge, code frame, composer)
is the base's, as in the tables above. Light theme: each soft version equals its base. The control's tooltip
says so ("Dark theme: ... surfaces with softer text. In the light theme it equals ...").

The selected-row rule (muted text reads `#c8c8c8` inside a selected row) belongs to Desktop's `#454545` fill.
The Threads and Console selected fills are the hover wash, where `#a1a1a1` already passes (6.38 and 5.56), so the
soft versions do not carry the rule.

### Contrast, soft versions, dark (`npm run test:contrast`, all five palettes)

| Pair | Threads · soft | Console · soft |
|---|---|---|
| prose `#c8c8c8` on canvas (7:1 required) | 11.62 | 10.91 |
| ink `#e4e4e4` on canvas / control (lowest) | 15.29 / 11.90 | 14.36 / 11.90 |
| muted `#a1a1a1` on canvas | 7.52 | 7.07 |
| muted on sidebar | 6.87 | 6.08 |
| muted on control (lowest) | 5.86 | 5.86 |
| muted on the selected row | 6.38 | 5.56 |

Every text role is at least 4.5:1 on every plane in both versions; the check prints all pairs.

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
| Soft-text versions | their base's canvas (the layer changes text only) |

The edge does not follow the line's hover fill (`bg-hover`, a translucent wash), so on hover the ring is
a hair lighter than the wash. The cut-out effect holds at rest, which is the state the operator compared.

## One-line action rows (XTRM-1047)

Rows marked `data-action-row` (`user`, `agent`, `code`) never take two lines. The user row puts the fold
control on the left and the meta actions (time, "to agent", delivery, Reply/Copy) on the right. Labels
shorten first ("Show full message" becomes "Show more" below 640px), then truncate (agent name, delivery
text, code language); icons and the time never shrink. `npm run test:rows` asserts it at 390 and 1440.
