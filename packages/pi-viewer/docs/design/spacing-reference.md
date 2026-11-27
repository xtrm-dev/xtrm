# Spacing reference (operator, 2026-11-26)

Approximate visual estimates of Claude Code desktop, **not extracted CSS**. A density guide only;
`console-ui-system.md` stays the authority. Saved from the operator's reference as given (XTRM-1055
journal, seq 1), with light markdown formatting.

## Spacing scale (8px system)

| Token | Value | Use |
|---|---|---|
| space-1 | 4px | icon-to-text gap |
| space-2 | 8px | inline elements, compact rows |
| space-3 | 12px | row padding, text grouping |
| space-4 | 16px | component padding |
| space-5 | 20px | larger separation |
| space-6 | 24px | between sections |
| space-8 | 32px | major separation |
| space-10 | 40px | large blocks |
| space-12 | 48px | sparse structure |

Mostly used: 8, 12, 16, 24, 32.

## Sidebar

Width ~386; header ~42; nav row ~32; session row ~48-52; horizontal padding ~12-18; gap between session
rows ~4-8; section spacing ~16-24.

## Chat

Message column ~820; content-to-content gap ~16-24; paragraph gap ~12-16; list item gap ~4-8; code block
padding ~16, radius ~8; composer height ~40; composer horizontal padding ~12-16.

## Typography (size / line height)

| Role | Size / line height |
|---|---|
| header | 16/20 |
| main message | 14/20-21 |
| secondary | 12-13/16-18 |
| session title | 13/18 |
| session subtitle | 12/16 |
| code | 12-13/16-18 |
| small metadata | 11-12/16 |

## Icons

| Use | Size |
|---|---|
| sidebar nav | 16 |
| inline actions | 14-16 |
| header controls | 16-18 |
| status indicators | 8-12 |
| avatar | 20-24 |
| icon button hit area | 28-32 |
| larger toolbar button | 32-36 |

Icons are smaller than their hit areas: a 16px icon in a 32px target.

## Defining characteristics

Compact 20px body line height, 16px icons, 32px control hit areas, 48px session rows, 8px component gaps,
16px content padding.

## Composer under-row (operator screenshot of Claude Code desktop)

Below the prompt box, outside it, right-aligned on one line: model, effort, permission mode, muted text
close to body size, no chips or borders, ~12-16px between items. The prompt box is a slightly raised fill,
rounded, no visible border; its inner bottom row has attach (+) on the left and send/voice on the right.

## How XTRM-1055 uses it

- The fold control sits inside the bubble or card, 8px under the clipped content (`mt-2` in the bubble, `mt-1`
  in the card), within the bubble's 12px padding (`px-3 py-3`).
- The fold control and the action row are 12px type on a 16px line (secondary 12-13/16-18).
- The body stays 14px on a 1.625 line: a deliberate step above the reference's 14/20-21 for long transcript
  reading (console-ui-system section 3.3 is the authority).
- The fold line "Worked for ..." has no hairline; the parent's 6px gap plus 2px bottom padding give the 8px
  (`space-2`) to the message below.
- The "New" divider is grayscale (border and muted text), with 12px (`gap-3`) between line and label.
