# t3code chat view audit (XTRM-1025)

Status: draft 1 (tokens, layout, components, scroll and motion, goodies, conflicts, licence). Draft 2 extends it (see §11, open items).
Audience: a builder who restyles the pi-viewer chat view without opening t3code.
Audited: `pingdotgg/t3code` at commit `dca3ab2025c15cfa5907757229be894cbc04cd80` (HEAD of the default branch on 2026-11-25), shallow clone, read-only.
Compared with: `packages/pi-viewer/src` at `xt/thread-lead` (50d0a74f) and `packages/xtrm-app/docs/design/console-ui-system.md`.

## 0. How to read this document

- **Path convention.** `T3/` means `apps/web/src/` in the t3code repository. `index.css:1146` means `T3/index.css` line 1146. `contracts/settings.ts` means `packages/contracts/src/settings.ts`. Every value cites its file and line.
- **Verified** = read in a t3code source file, cited. **Inferred** = derived from a verified value (for example a Tailwind palette step converted to hex, or a `color-mix` computed by hand). The Tailwind v4 palette is not in the t3code repository, so every hex for a Tailwind step is **inferred** from the Tailwind v4 default palette (`apps/web/package.json` pins `"tailwindcss": "^4.0.0"`).
- **Units.** t3code sets `html { font-size }` from the "interface font size" setting, default 16px (`contracts/settings.ts:174`, applied at `appearanceFonts.ts:101`). Every rem value below is also given as px at a 16px root. Our operator runs a 12px root (`console-ui-system.md` §3.3 "Unit rule"): keep rem, never convert to px.
- **Not read** (listed in §11): shiki theme names, the send-button pill class, tool detail panels, header, sidebar. Nothing in this document is guessed for those.

## 1. Tokens

### 1.1 Colour (light and dark)

t3code defines semantic tokens on `:root` (`index.css:1146-1262`) and passes most text through a `--contrast-*` layer (`index.css:1624-1736`) that mixes the token with the background at `--appearance-contrast-base: 100%` and a user boost of `0%` (`index.css:93-96`). At default settings the contrast layer is an identity: `--contrast-foreground` equals `--foreground`. A builder can ignore the layer.

| Role | t3code token | Light | Dark | Source | Nearest xtrm token (see §10) |
|---|---|---|---|---|---|
| Canvas | `--background` | `zinc-25` = `oklch(99.2% 0 0)` ≈ `#fcfcfc` (inferred hex) | `#000` | `index.css:224,1149,1225` | `--x-deep` / `--x-surface` |
| Text | `--foreground` | `zinc-900` ≈ `#18181b` (inferred) | `neutral-100` ≈ `#f5f5f5` (inferred) | `index.css:1158,1227` | `--x-ink` |
| Prose text | `text-foreground/90` | foreground at 90% | foreground at 90% | `ChatMarkdown.tsx:2110` | `--x-ink` |
| Muted text | `--muted-foreground` | `zinc-500` ≈ `#71717a` (inferred) | `neutral-400` ≈ `#a3a3a3` (inferred) | `index.css:1168,1236` | `--x-ink-muted` |
| Secondary label (tool rows, meta) | `--secondary-label` | = muted-foreground | = muted-foreground (`#8f8f8f` only inside the sidebar) | `index.css:1170,1309` | `--x-ink-muted` |
| Icon muted | `--icon-muted` | = muted-foreground | = muted-foreground | `index.css:1171` | `--x-ink-faint` |
| Placeholder | `--placeholder` | = muted-foreground | = muted-foreground | `index.css:1169` | `--x-ink-faint` |
| User bubble fill | `--message-surface` | `color-mix(srgb, zinc-200 55%, zinc-100)` ≈ `#ebebed` (inferred) | `color-mix(srgb, neutral-950 92%, white)` ≈ `#1e1e1e` (inferred) | `index.css:1173,1240` | `--x-control` (`#efeff1` / `#262626`) |
| User bubble text | `--message-foreground` | = foreground | = foreground | `index.css:1174` | `--x-ink` |
| Card / popover / raised | `--card`, `--popover` | `white` | `color-mix(srgb, neutral-950 97%, white)` ≈ `#111111` (inferred) | `index.css:1159,1161,1228,1230` | `--x-raised` |
| Hover fill / "accent" | `--accent` | `zinc-100` ≈ `#f4f4f5` (inferred) | `white` at 4% | `index.css:1178,1237` | `--x-hover` |
| Muted fill (code frame, pre) | `--muted`, `--secondary` | `zinc-50` ≈ `#fafafa` (inferred) | `white` at 3% | `index.css:1165,1167,1233,1235` | `--x-control` |
| Border | `--border` | `zinc-200` ≈ `#e4e4e7` (inferred) | `white` at 8% | `index.css:1185,1245` | `--x-border-muted` (ink 7% / white 8%) |
| Input border | `--input` | `zinc-300` ≈ `#d4d4d8` (inferred) | `white` at 11% | `index.css:1186,1246` | `--x-border` |
| Primary / focus ring | `--primary`, `--ring` | `oklch(0.488 0.217 264)` | `oklch(0.571 0.21 264)` | `index.css:1163,1187,1232` | `--x-accent` (`#4f46e5` / `#818cf8`) |
| Link colour in prose | `--info-foreground` | `blue-700` | `blue-400` | `index.css:1190,1247,2104-2106` | `--x-accent-ink` (references use accent in our system) |
| Error | `--error` / `--error-foreground` | `red-500` / `red-700` | `red-500` 90% + white / `red-400` | `index.css:1180-1181,1241-1242` | `--x-danger` |
| Error surface | `--error-surface` | error at 8% | error at 16% | `index.css:1183,1244` | `--x-danger` at 12% |
| Failed-tool icon | `--tool-error-icon` | = error | `#fca5a5` | `index.css:1182,1243` | `--x-danger` |
| Success | `--success` / `--success-foreground` | `emerald-500` / `emerald-700` | same / `emerald-400` | `index.css:1195-1196,1249` | `--x-success` |
| Warning | `--warning` / `--warning-foreground` | `amber-500` / `amber-700` | same / `amber-400` | `index.css:1197-1198,1250` | none (we have no warning token) |
| Diff add / delete text | `--diff-addition-foreground`, `--diff-deletion-foreground` | `emerald-700` / `red-700` | `emerald-400` / `red-400` | `index.css:2374-2375` | `--x-diff-add` / `--x-diff-del` |
| Composer glass fill | `--chat-composer-glass-surface` | `var(--card)` | `var(--surface-raised)` = `color-mix(srgb, neutral-950 97%, white)` | `ComposerSurface.tsx:16-17`, `index.css:1226` | `--x-raised` |
| Composer outline | `--chat-composer-outline` | `rgb(0 0 0 / 8%)` | `white` 5% mixed with transparent | `ComposerSurface.tsx:16-17` | `--x-border-muted` |
| Composer highlight (dark inset) | `--chat-composer-highlight` | none | `rgb(255 255 255 / 3%)` | `ComposerSurface.tsx:17,34` | none |
| Scrollbar thumb | `--app-scrollbar-thumb` | `rgb(217 217 217)` hover `rgb(191 191 191)` | `rgb(255 255 255 / 36%)` hover `45%` | `index.css:97-98,149-150` | `--x-border-strong` |
| Inline code fill | `color-mix(foreground 10%, transparent)` | | | `index.css:2196` | `--x-control` |
| Skeleton | `bg-muted-foreground/15` | | | `ui/skeleton.tsx:5` | `--x-pressed` |

**Surface ladder.** Dark: true black canvas (`#000`), raised surfaces about `#111`, user bubble about `#1e1e1e` (`index.css:1222-1225`, comment: "Borders and hover states provide separation without milky gray fills"). Light: near-white canvas, white cards, grey user bubble. Our dark ladder is `#0d0d0d / #151515 / #1e1e1e / #262626` (`styles.css:82-86`): the bubble level is the same as t3code (`#1e1e1e`).

### 1.2 Font families

| Role | Value | Source |
|---|---|---|
| Sans (all interface and prose) | `-apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif` | `index.css:173-174`, `appearanceFonts.ts:13-14` |
| Mono (code, paths, timers in badges) | `ui-monospace, "SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace` in CSS; the runtime default drops `ui-monospace` ("some engines map it to a proportional font"): `"SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace` | `index.css:175-176`, `appearanceFonts.ts:16-18` |
| Composer | `--font-composer` = `var(--font-sans)` unless the user sets a separate composer font | `appearanceFonts.ts:80` |
| Smoothing | `-webkit-font-smoothing: antialiased` only if the user enables it | `appearanceFonts.ts:110-114` |
| List marker tabular numerals | `ol > li::marker { font-variant-numeric: tabular-nums }` | `index.css:1966-1968` |

t3code ships no web font of its own (system stack with `Inter Variable` as an optional hit). Our viewer ships Figtree Variable and Geist Mono Variable (`styles.css:2-3,121-122`).

### 1.3 Type sizes, weights, line heights

Interface root 16px (`contracts/settings.ts:174`; range 12-20, `:168-169`). Prompt default 14px (`:182`). Code default 13px (`:190`), applied through `--font-size-code` to code blocks only (`index.css:1822-1826`, `appearanceFonts.ts:106-107`).

| Step | rem / px at 16px | Line height | Where used | Source |
|---|---|---|---|---|
| `text-5xs` | 0.4375rem / 7px | 1 | provider badge overlays | `index.css:191-192` |
| `text-4xs` | 0.5rem / 8px | 1 | provider badge overlays | `index.css:189-190` |
| `text-3xs` | 0.625rem / 10px | 0.875/0.625 = 1.4 | status badge in the meta row | `index.css:187-188`, `TimelineAssistantRows.tsx:308` |
| `text-2xs` | 0.6875rem / 11px | 1/0.6875 ≈ 1.4545 | code-block language label, "Cut off by a steer" hint | `index.css:185-186`, `MarkdownCodeBlock.tsx:79`, `MessagesTimeline.tsx:1965` |
| `text-xs` | Tailwind default 0.75rem / 12px | 1rem | meta row (timestamp, copy), user-message actions, table footnotes | `TimelineAssistantRows.tsx:216`, `TimelineUserMessageRow.tsx:1139`, `index.css:2168` |
| `text-sm` | Tailwind default 0.875rem / 14px | overridden to `leading-relaxed` = 1.625 | **prose, tool rows, working row, turn fold** | `ChatMarkdown.tsx:2110`, `WorkLog.tsx:64` |
| Prompt | `--font-size-prompt` = `var(--text-sm)` by default, 14px when set | `leading-relaxed` | composer editor | `appearanceFonts.ts:102-105`, `ComposerPromptEditorTiptap.tsx:1148` |
| Code | `--font-size-code` 13px | `leading-snug` (1.375) on the frame | fenced code | `index.css:1825`, `MarkdownCodeBlock.tsx:67` |
| Inline code | 0.85em of the sentence | inherits | prose | `index.css:2199` |
| `h1` | 1.25rem / 20px | 1.3 | markdown heading | `index.css:1926-1928` |
| `h2` | 1.125rem / 18px | 1.3 | | `index.css:1930-1932` |
| `h3` | 1rem / 16px | 1.3 | | `index.css:1934-1936` |
| `h4-h6` | 0.875rem / 14px (`h6` muted) | 1.3 | | `index.css:1938-1946` |
| Table | 0.875rem / 14px | inherits | markdown table | `index.css:2311` |
| Footnote ref | 0.6875rem / 11px, weight 600 | | | `index.css:2187-2188` |
| Footnotes section | 0.75rem / 12px | | | `index.css:2168` |

Discrepancy (verified): the table rule comment says "One step under 15px prose" (`index.css:2310`), but the prose root class is `text-sm` = 14px (`ChatMarkdown.tsx:2110`). The comment is stale. The table is 14px, the same as prose.

**Weights.** Body 400 (no explicit weight). Headings 600 (`index.css:1921`). `strong` 700 (`index.css:2208`). Table header 600 (`index.css:2335`). Attempt-fold label `font-medium` 500 (`MessagesTimeline.tsx:1961`). Footnote ref 600. There is no 300 and no 800 in the chat view. The chat view is deliberately low-contrast in weight: the hierarchy comes from colour (foreground vs muted-foreground) and size, not from bold.

### 1.4 Spacing, radius, border, shadow

**Radius.** `--radius: 0.5rem` (`index.css:1148`); `sm` = radius-4px = 4px, `md` = radius-2px = 6px, `lg` = radius = 8px, `xl` = +4px = 12px, `2xl` = +8px = 16px, `3xl` = +12px = 20px (`index.css:295-300`). `--control-radius: 0.5rem` (`index.css:103`).

| Element | Radius | Source |
|---|---|---|
| User bubble | `rounded-2xl` 16px; `rounded-tr-md` (6px) when grouped with the previous message or media above; `rounded-br-md` (6px) when grouped with the next | `TimelineUserMessageRow.tsx:941-943` |
| Composer shell, main surface, host | `rounded-2xl` 16px | `ComposerSurface.tsx:21,41,57` |
| Code block frame | `rounded-lg` 8px | `MarkdownCodeBlock.tsx:67` |
| Inline code | 0.25rem 4px | `index.css:2193` |
| Bare `pre` in prose | 0.5rem 8px | `index.css:2215` |
| Tool row hit area | `rounded-md` 6px | `WorkLog.tsx:55,94` |
| Attempt fold | `rounded-md` 6px | `MessagesTimeline.tsx:1954` |
| Status badge | `rounded-full` | `TimelineAssistantRows.tsx:308` |
| Scroll-to-end pill | `rounded-full` (glass button) | `ui/button.tsx` `glass` variant, `TimelineOverlays.tsx:43` |
| Minimap hover card | `rounded-xl` 12px | `TimelineMinimap.tsx:236` |
| Scrollbar thumb | 3px; `pre` thumb 999px | `index.css:1886,2233` |

**Spacing (rem, 4px = 0.25rem at 16px).**

| Use | Value | Source |
|---|---|---|
| Block margin between paragraphs, lists, quotes, `pre`, tables | `0.65rem` (10.4px) | `index.css:1911` |
| Heading margin | `1.25rem 0 0.5rem` | `index.css:1920` |
| List item gap | `0.25rem` (`li + li`) | `index.css:2046-2048` |
| List gutter | `1.25rem` | `index.css:1952-1953` |
| Blockquote | border 2px, padding-inline-start `0.8rem` | `index.css:2127-2128` |
| Pre padding | `0.8rem 0.9rem` | `index.css:2217` |
| Inline code padding | `0.1em 0.35em` | `index.css:2197` |
| Table cell padding | `0.45rem 0.75rem`; header block `0.55rem`; first/last cell flush (0 on the outer edge); max cell width `24rem` | `index.css:2318,2334,2324-2330,2344` |
| User bubble padding | `p-3` (12px) | `TimelineUserMessageRow.tsx:948` |
| Assistant block | `px-1 py-0.5` (4px / 2px) | `TimelineAssistantRows.tsx:42` |
| Meta row | `mt-1.5` under assistant text (6px); `gap-2` (8px) between items | `TimelineAssistantRows.tsx:79,216` |
| Row bottom padding by kind | default `pb-4` (16px); assistant without meta, event, html-render, sent-message, viewed-images `pb-2` (8px); user grouped with next `pb-1` (4px); working and turn-fold `pb-1.5` (6px); work-log standalone `pb-2`, group-content `pb-1`, group-header or continuing `pb-0` | `MessagesTimeline.tsx:1682-1699`, `WorkLog.tsx:26-32` |
| Tool row | `min-h-6` (24px), `gap-1.5` (6px), `px-0.5` (2px); `py-0` inside a group, `py-0.5` standalone | `WorkLog.tsx:64,69,94` |
| Tool icon box | `w-6` / `size-6` (24px) box; icon `size-4` (16px), stroke 2 (`stroke-2` utility overrides the lucide base rule that sets 1.75) | `WorkLog.tsx:71-72`, `TimelineWorkGroupRows.tsx:587`, `index.css:1753-1757` |
| Tool detail (text) | `ms-7` (28px indent), `max-h-96` (384px), `gap-3`, `px-0.5 py-1`, scrolls | `WorkLog.tsx:181` |
| Timeline lane gutters | `0.75rem` (12px) below 640px; `3rem` (48px) from 640px | `index.css:2660-2696` |
| Content max width | `--chat-content-max-width: 46rem` (736px); "wide" 72rem; "full" 100% | `index.css:131,2380-2386` |
| Workspace gutter | `0.75rem`, `1.25rem` from `sm` | `index.css:138,142-144` |
| Top bar height | `--workspace-topbar-height: 52px` | `index.css:123` |

**Borders.** All 1px. Dividers use `border-border/60` (`MessagesTimeline.tsx:1908`, `TimelineWorkGroupRows.tsx:369`), code frame `border-border/70` in light and `transparent` in dark (`MarkdownCodeBlock.tsx:67`), attempt fold `border-border/60`, status badge `border-border/70`. Markdown table rules `color-mix(border 60%, transparent)` (`index.css:2333,2339`). Footnote rule `1px solid var(--contrast-border)` (`index.css:2165`).

**Shadows.** The chat view uses almost none. Composer light: `--shadow-composer: 0 1px 2px rgb(0 0 0 / 5%)` (`index.css:200`), dark: none (`ComposerSurface.tsx:41` `dark:shadow-none`; the unused token `--shadow-composer-dark: 0 14px 32px -18px rgb(0 0 0 / 75%)` is defined at `index.css:201`). Minimap hover card `shadow-xl shadow-black/25` (`TimelineMinimap.tsx:236`). Buttons use `shadow-xs` and a 1px inset highlight `0 1px rgb(255 255 255 / 16%)` (`index.css:195`, `ui/button.tsx`). Skeleton, user bubble, code frame and tool rows have no shadow.

**Glass.** Composer and "glass" pill use `backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturation))` on a fill at `--glass-opacity: 80%`. Light blur 12px, saturation 1.14; dark blur 16px, saturation 1.08 (`index.css:119-121,151-152`, `ComposerSurface.tsx:21`).

**Grain.** The body carries an SVG noise tile at opacity 0.035 (256px tile), baked into each surface background (`index.css:1793-1810`). This is a t3code brand texture; see §10 (conflict).

### 1.5 Motion tokens

| Token | Value | Source |
|---|---|---|
| Decelerating curve (surfaces that slide in) | `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)` | `index.css:197` |
| Meta reveal | `transition-opacity duration-200` (`opacity-0` to `100` on `group-hover`, `focus-within`, always `100` under `pointer-coarse`) | `TimelineAssistantRows.tsx:216-219`, `TimelineUserMessageRow.tsx:1139` |
| Streaming block fade-in | `transition: opacity 600ms ease-out` with `@starting-style { opacity: 0 }`, only when `data-streaming` and `prefers-reduced-motion: no-preference` | `index.css:2288-2298` |
| Skeleton | `skeleton 2.4s infinite`, opacity 1 / 0.55 in `steps(4)` | `index.css:225,301-319` |
| Status pulse | `status-pulse 2s infinite`, opacity 1 / 0.5 in `steps(6)` | `index.css:228,338-352` |
| Step in | `180ms ease-out`, `opacity 0` + `translate 0 4px` | `index.css:236,353-358` |
| Live tool shine | `2.2s steps(30) infinite`, 4.5rem-wide highlight band swept across the label | `index.css:578-605` |
| Live activity focus (overlay shimmer) | same 2.2s `steps(30)`, mask with 12% / 55% / 100% stops over 4.5rem | `index.css:613-682` |
| Hover colour | `transition-colors` (Tailwind default 150ms) on rows | `WorkLog.tsx:94` |
| Minimap tick | `transition-transform duration-150`; panel `duration-150` opacity | `TimelineMinimap.tsx:113,206` |
| Scroll-to-end | `animated` smooth scroll unless reduced motion | `MessagesTimeline.tsx:1557` |

Animations that loop are **duty-cycled with `steps()`** and **paused when off-screen** (`animation-play-state: var(--visible-animation-state, paused)`, driven by `observeVisibleAnimation`): the comments say this cuts compositor updates from about 288 to 14 per second on a 120Hz display (`index.css:301-306`, `:602-603`). Reduced motion turns the shimmer off (`index.css:665-669,678-681`).

## 2. Layout

```
viewport
└─ conversation area (relative)
   ├─ timeline list  .messages-timeline-scroll   full height, scrolls, scrollbar-gutter both
   │    padding-inline: 0.75rem  (≥640px: 3rem)          index.css:2660-2696
   │    └─ rows, each capped at --chat-content-max-width (46rem), centred
   │        ├─ user row        right-aligned bubble, max 80% of the lane
   │        ├─ assistant row   full lane width, no bubble
   │        ├─ work-log rows   24px lines, indented under the assistant text
   │        ├─ working row     "Working for 1m 3s" with a hairline under it
   │        └─ turn fold       "Worked for …" disclosure with hairline under it
   ├─ scroll-to-end pill  (absolute, centred, bottom = composer height + 4px)
   ├─ timeline minimap   (absolute, left, 72px wide, fine pointers only)
   └─ composer overlay    absolute inset-x-0 bottom-0 z-20, pt-1.5 (sm: pt-2)
        └─ lane: padding-inline 0.75rem (≥640px: 3rem)
             └─ stack: mx-auto w-full max-w-(--chat-content-max-width)
```

Sources: `ChatView.tsx:3762-3792`, `index.css:2659-2697`, `MessagesTimeline.tsx:1496-1561`.

Verified facts for a builder:

1. **One column, 46rem (736px) at the default width.** Timeline lane, composer and HTML preview probe share `--chat-content-max-width` (`index.css:2378-2379`). Ours is `max-w-3xl` = 48rem for the channel view (`App.tsx:366`): within 2rem of t3code.
2. **No avatars and no author names on screen.** The author heading is `sr-only` (`TimelineRowParts.tsx:10-12`: `<h3 className="sr-only select-none">`). Identity comes from alignment (user right, assistant left) and from the bubble. Our channel view shows an agent mark, name, role chip, status dot and clock above every turn (`ChannelView.tsx:83-95`); that is multi-agent identity t3code does not need.
3. **User bubbles are right-aligned, max 80% wide, `items-end`.** The bubble and its action row share `max-w-[80%]` (`TimelineUserMessageRow.tsx:941,1126`). Consecutive user messages tighten the touching corners to 6px (`:942-943`).
4. **Assistant text is not boxed.** It sits at the lane's left edge with `px-1 py-0.5` (`TimelineAssistantRows.tsx:42`).
5. **Rhythm is padding on rows, not gaps.** There is no `gap-*` between rows; each row declares its own `pb-*` (table in §1.4). A turn reads as: user bubble (16px) → work log lines (0-8px) → assistant text (8px or 16px).
6. **Hairlines only at turn boundaries.** The working row and the turn fold carry `border-b border-border/60` (`MessagesTimeline.tsx:1908`, `TimelineWorkGroupRows.tsx:369`). The rest of the view has no rules.
7. **Container queries.** The user-message action cluster floats outside the bubble at `@min-[37rem]` and drops below it otherwise (`TimelineUserMessageRow.tsx:1114,1127`).

## 3. Components

### 3.1 User message

Verified (`TimelineUserMessageRow.tsx`):

- Bubble: `relative min-w-0 max-w-[80%] rounded-2xl text-message-foreground`, fill `bg-message` (light `#ebebed`, dark `#1e1e1e`, inferred hex), padding `p-3` (`:941-948`).
- Prose inside uses the same markdown component with `user-message-markdown` (`:1302`), `lineBreaks` on (`:1303`: single newlines are line breaks, a typed message keeps its shape), raw HTML off (`:1304`), leading spaces preserved with `pre-wrap` (`index.css:2038-2044`).
- Inline code inside a bubble: `color-mix(message-foreground 10%, transparent)` (`index.css:2203`).
- Long message fold: the body clamps at `max-h-44` (176px) and fades with `mask-image: linear-gradient(to bottom, black calc(100% - <n>rem), transparent)` (`:1213,1237,1247-1248`). A ghost `xs` button "Show full message" / "Show less" sits under it, right-aligned, `mt-1.5`, `-ml-1` (`:1264-1275`). Only offered when the content is tall enough to fold (`useTallEnoughToFold`, `:1226`).
- Actions (copy, revert, and similar) sit in a row under the bubble, `justify-end pe-1`, `text-xs tabular-nums`, hidden until the row is hovered or focused (`:1126,1138-1139`).
- Media and file cards use the same radius family: file card `rounded-2xl bg-message py-2 ps-2 pe-1`, `w-64 max-w-full` (`:146`), thumbnail ring `ring-1 ring-inset ring-black/9` light, `white/12` dark (`:101`).

### 3.2 Assistant message

Verified (`TimelineAssistantRows.tsx`):

- No bubble. `ChatMarkdown` renders straight into the lane (`:52-69`). The root class is `chat-markdown w-full min-w-0 [overflow-wrap:anywhere] [word-break:break-word] text-sm leading-relaxed text-foreground/90` (`ChatMarkdown.tsx:2108-2110`).
- Empty text shows `(empty response)` unless the message is streaming (`:38`).
- Interrupted turns show a pill badge under the text (`:72-76`, `:306-311`: `rounded-full border border-border/70 px-1.5 py-0.5 font-mono text-3xs text-muted-foreground`).
- **Meta row** (`:195-255`): `flex items-center gap-2 text-xs tabular-nums transition-opacity duration-200`, `opacity-0` until the assistant group is hovered or focus is inside it, always visible on coarse pointers. Contents in order: status badge (when not `completed`), copy button, fork button, reply button, day-aware timestamp with a tooltip carrying the full date. The last assistant message of a turn uses `alwaysVisible` (`:176-193`, `:184-190`), so the final timestamp and copy are always on screen.
- Timestamp: `text-muted-foreground text-xs tabular-nums` (`:239`). Format: time only for today; `yesterday at {time}`; otherwise numeric date plus time, year omitted in the current year (`timestampFormat.ts:270-288`). Tooltip shows the full timestamp (`:248-250`).

### 3.3 Tool calls (the "work log")

Verified (`WorkLog.tsx`, `TimelineWorkGroupRows.tsx`, `MessagesTimeline.tsx`).

**Anatomy of one line** (`WorkLog.tsx:59-89`): `flex min-h-6 min-w-0 gap-1.5 text-sm leading-relaxed select-none`. A 24px icon box (`size-6`, centred 16px icon), then a label `min-w-0 flex-1 text-secondary-label truncate`, then an optional trailing slot (timestamp). Rows are `rounded-md px-0.5 text-left transition-colors`, keyboard focus is `ring-2 ring-inset ring-ring/70` (`:54-55,91-99`). The line is **one line, truncated**; nothing wraps (`[&_*]:whitespace-nowrap`, `:80`) except a reasoning preview (`wrapLabel`).

**Groups.** Consecutive tool calls fold into one header line: icon plus summary label plus a hover-revealed timestamp (`WorkGroupHeader`, `TimelineWorkGroupRows.tsx:740-770`). The summary is built by `toolGroupSummaryIconName` and a text summary (`row.summary`). Click toggles the group (`aria-expanded`). The header uses `WorkLogButton`; expanded entries render in a `WorkLogList` (`flex min-w-0 flex-col`, `:39-45`). The block padding collapses between header and content (`pb-0` / `pb-1`, `WorkLog.tsx:26-32`).

**Live line** (`LiveWorkEntryTimelineRow`, `:614-718`): the active tool call shows as one clickable line with the tool icon and a label such as `Reading file.ts`. While active, the label text carries the `live-tool-shine` utility (a light band sweeping across the text, 2.2s, `steps(30)`, `index.css:591-605`). A failed call turns its icon to `--tool-error-icon`, adds an `aria-label` "tool call failed" and a trailing `XIcon size-3` (`:562-563,606-608`).

**Turn fold** (`TurnFoldTimelineRow`, `MessagesTimeline.tsx:1901-1937`): after a turn completes, its tool noise folds into one line `border-b border-border/60 pb-2 pe-0.5 pt-1`, a button `text-sm leading-relaxed text-muted-foreground tabular-nums hover:text-foreground` with a 14px chevron (`ChevronRight` collapsed, `ChevronDown` expanded, `size-3.5`) and the timestamp pinned right (`ms-auto`). Expanding a fold whose items were not loaded shows `WorkHistorySkeleton` (§4.3) and reports `Couldn't load work. Click to retry.` on failure (`:1873`).

**Detail panels** (`WorkLogDetails`, `WorkLog.tsx:152-191`): three kinds. `text`: `ms-7 flex max-h-96 flex-col gap-3 overflow-auto px-0.5 py-1 select-text`. `panel`: `mt-0.5 mb-1.5 pb-2`. `media`: `mt-1`. With `followLive`, the panel stays pinned to the bottom while the user is within 4px of the bottom edge and stops following as soon as the user scrolls up (`LIVE_EDGE_PX = 4`, `:150,162-177`). That is the pattern for streaming command output.

**Superseded attempt** (`AttemptFoldTimelineRow`, `:1939-1971`): `rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 hover:bg-muted/35`, a chevron `size-3.5 text-muted-foreground`, label `text-xs font-medium text-foreground/80`, hint `text-2xs text-muted-foreground` ("Cut off by a steer").

Command lines in the work log use `CommandBlock`: `$` prompt in `text-muted-foreground mr-2`, `min-w-0 truncate`, a copy button with `size-3.5` icons (`CommandBlock.tsx:35-45`).

### 3.4 Reasoning ("Thinking")

Verified (`TimelineWorkGroupRows.tsx:443-491,632-715`):

- While the model reasons, a single line shows the brain icon (`iconName="brain"`) and the label `Thinking` (or a provider-starting label, the row's own label, or a live answer preview). The line is a `LiveActivityRow` with the shimmer overlay (`ActivityShimmerOverlay` + `live-activity-focus`): the text sits in the muted colour and a 4.5rem band of full-foreground colour sweeps across it (`:513-540`, `index.css:631-687`, `TimelineRowParts.tsx:46-60`).
- When a thought has text, the row shows a preview: the brain icon, then up to four lines of inline markdown (`line-clamp-4`, `:668`), then the `Thinking` / `Thought` status line under it (`:655-700`). When the thought is finished the label flips from `Thinking` to `Thought` (`:684-686`).
- Reasoning is never shown in a bubble and never in a different font. It is the same 14px / 1.625 line as a tool call, in the secondary-label colour.
- Under approval wait, the live flag turns off so nothing shimmers (`:456`).

### 3.5 Working indicator (answer for XTRM-1026)

Verified (`TimelineWorkGroupRows.tsx:131-139,352-384,426-441`, `AgentElapsed.tsx`):

- Row: `border-b border-border/60 pb-2 pt-1`; inner `flex h-6 min-w-0 items-baseline gap-2 px-1 text-sm leading-relaxed text-muted-foreground tabular-nums` (`:369-370`). Height 24px.
- Text: `Working for <timer>` where the timer is a `tabular-nums` span updated by a ticking text node (no React re-render per second): `formatWorkingTimerNow(createdAt)` (`:131-139`, `AgentElapsed.tsx:8-58` has full and compact formats). Without a start time: `Working...` (`:366`).
- Shimmer is **not** applied to this row in the normal case. It applies only for `Setting up worktree…` and `Compacting for …` (`:356`, `shimmer = isPreparingWorktree || compacting`). The normal "agent is busy" cue is the live tool line (§3.3) or the `Thinking` line (§3.4) with its shimmer, plus this timer row.
- Compacting: label `Compacting for <timer>` with a `Minimize2Icon size-3` (`:426-441`).
- No spinner, no dots, no pulsing avatar. The only continuous motion on screen is a text-sized light band, stepped and paused off-screen (§1.5).

Port to our model (no shimmer needed to start): one 24px row under the last turn, `text-sm leading-relaxed text-ink-muted tabular`, text `Working for 1m 03s`, hairline `border-b border-border-muted` under it; then the live tool line with `viewer-fade` or a stepped sweep. Our current cue is `Working…` with `viewer-fade` at 1.8s ease-in-out (`ActivityDisclosure.tsx:154,186`, `styles.css:470-476`).

### 3.6 Code blocks

Verified (`MarkdownCodeBlock.tsx`, `index.css`):

- Frame: `chat-markdown-codeblock my-[0.65rem] text-start overflow-hidden rounded-lg border border-border/70 bg-secondary leading-snug dark:border-transparent dark:bg-input/32` (`MarkdownCodeBlock.tsx:67`). Light: 1px zinc border at 70% on `#fafafa`. Dark: no border, fill `--input` (white 11%) at 32% ≈ white 3.5%.
- Header: `flex items-center justify-between gap-2 pt-1.5 pr-1.5 pb-0 pl-3 select-none` (`:74`); colour `foreground` at 72% (`index.css:2238`). Left: language label `font-mono text-2xs` (11px). Right: a toolbar of `ghost-muted` `icon-xs` buttons with `size-3` (12px) icons, `gap-0.5`: wrap toggle (pressed state = `secondary` variant), run in terminal (shell blocks only), view toggle (diagrams), copy (swaps to a check mark) (`:223-265,190-202`).
- Body: `pre` has no margin, border or radius inside the frame (`index.css:2241-2246`); syntax colours come from the highlighter's inline styles with the `.shiki` background forced transparent (`index.css:2253-2255`). Plain-text fences (`text`, `txt`, `plain`, `plaintext`) inherit foreground (`index.css:2257-2269`).
- Wrapping: `data-wrap="true"` gives `white-space: pre-wrap; overflow-wrap: anywhere` (`index.css:2248-2251`); otherwise horizontal scroll with a 6px thin thumb (`index.css:2228-2235`).
- Size: `--font-size-code`, default 13px (`index.css:1822-1826`).
- Diagrams get no frame: `my-[0.65rem] border border-transparent` with the actions top right (`MarkdownCodeBlock.tsx:206-210`).
- Inline code: no border colour (`1px solid transparent`), 4px radius, `0.1em 0.35em` padding, 0.85em size, 10% foreground fill (`index.css:2191-2200`).

Our `CodeBlock` is a borderless `bg-deep` well with `text-2xs` and a hover-only copy button (`CodeBlock.tsx:29-44`); the markdown `pre` uses 0.75rem mono on `--color-deep` (`styles.css:xtrm-prose pre`).

### 3.7 Metadata (timestamps, status, actions)

Verified:

- Hover-revealed, never persistent noise: timestamps in tool rows are `absolute opacity-0` and become `static opacity-100` on `group-hover/timeline-row` and `group-focus-within/timeline-row` (`TimelineRowParts.tsx:32-33`). Size `text-xs tabular-nums text-muted-foreground`.
- The last assistant meta row is pinned visible (`alwaysVisible`).
- A tooltip over any timestamp carries the full date (`formatChatTimestampTooltip`).
- Status words are lowercase mono in a bordered pill and only for non-normal states (`interrupted`, etc.), `text-3xs` (`TimelineAssistantRows.tsx:308`).
- Day-aware format described in §3.2.

### 3.8 Composer

Verified (`ComposerSurface.tsx`, `ChatView.tsx`, `ComposerPromptEditorTiptap.tsx`, `index.css`):

- **Lane.** Absolute overlay `inset-x-0 bottom-0 z-20 pt-1.5 sm:pt-2` (`ChatView.tsx:3786`); inside, a `chat-composer-lane` with the same inline padding as the timeline (0.75rem; 3rem from 640px) and a stack `mx-auto w-full max-w-(--chat-content-max-width)` (`:3789-3792`, `index.css:2660-2687`).
- **Surface.** `rounded-2xl` (16px). A `::before` layer paints the glass: fill `--chat-composer-glass-surface` at `--glass-opacity` (80%), `backdrop-blur 12px / 16px`, `backdrop-saturate 1.14 / 1.08` (`ComposerSurface.tsx:21`). Without `backdrop-filter` support it falls back to the solid fill (`:22`).
- **Outline.** A 1px `::after` border: light `rgb(0 0 0 / 8%)`, dark `white 5%` over transparent plus a 2xs inset highlight `rgb(255 255 255 / 3%)` (`:16-17,34`).
- **Shadow.** Light `0 1px 2px rgb(0 0 0 / 5%)`; dark none (`:41`, `index.css:200`).
- **Editor.** `composer-tiptap -m-1 block max-h-52 min-h-[calc(2lh+--spacing(2))] overflow-y-auto p-1 whitespace-pre-wrap wrap-break-word bg-transparent leading-relaxed text-foreground focus:outline-none` (`ComposerPromptEditorTiptap.tsx:1148`). Two lines minimum, 208px maximum, then it scrolls. Font size is the prompt size (14px default). Headings, lists and quotes inside the editor share the chat markdown styles (`:is(.chat-markdown, .composer-tiptap)` selectors, `index.css:1914-2016`).
- **Touch.** On phones the prompt size is `max(prompt, 16px)` so iOS does not zoom on focus (`index.css:134-135`).
- **Send.** A pill button `h-8 sm:h-7`, `px-3` compact / `px-4` regular (`ComposerPrimaryActions.tsx:338`); the shared class is `messageActionPillClassName` (not read). Send icons `size-4` (`:475-481`).
- **Context strip.** An optional row under the card (environment, branch) with `surface-glass`, `gap-2 px-2 pt-2 text-muted-foreground` (`ComposerSurface.tsx:77`).
- **Draft hero.** With no messages the composer is vertically centred in the viewport and a headline sits above it (`ChatView.tsx:3784-3800`).

Our composer: `max-w-3xl`, `bg-deep` bar, `text-sm` textarea, `px-3.5 pt-3 pb-1`, `max-h-40` (160px), send button `size-7` square in `bg-github` (`Composer.tsx:115,211,242`). It is a flat control in the sidebar's ladder, not a glass card.

### 3.9 Markdown (prose)

Verified in `index.css:1895-2369`. Summary of the choices that give t3code its look:

- Block rhythm `0.65rem`; headings tight (1.3) with `1.25rem` above and `0.5rem` below.
- Links: no underline at rest, blue (`--info-foreground`); on hover or focus a **dotted underline drawn with a 4×2px radial-gradient repeat**, not `text-decoration` (`index.css:2108-2124`).
- Blockquote: 2px rule at 35% of the current colour, no fill, `0.8rem` indent (`:2126-2130`).
- Lists: disc / circle / square by depth; ordered: decimal, `lower-alpha`, `lower-roman`; tabular numerals on markers; the gutter widens for multi-digit markers (`:1948-2032`).
- Task lists: native checkbox replaces the marker (`:2051-2059`).
- Tables: row rules only (header rule plus body row rules at 60% border), no vertical rules, no zebra, no header fill, flush outer columns; wide tables scroll horizontally with an always-visible thumb (`:2305-2369`).
- Footnotes: 12px, top rule, superscript chips 1rem wide (`:2163-2189`).
- Files and paths render as inline chips (`.chat-markdown-file-link`), inline-block, icon at `0.2em` gap (`:2074-2101`).
- Math, mermaid, images (inline-block, gallery) and "★ Insight" blocks are supported (`ChatMarkdown.tsx:2096-2101`, `index.css:2348-2360`).

Our `.xtrm-prose` is 13px / 1.6rem (25.6px) with headings 1rem / 0.9rem / 0.8125rem, links underlined with a 35% decoration, blockquote with a control-coloured fill, tables zebra-striped with a filled header (`styles.css:230-380`).

## 4. Scroll, loading, empty states, motion

### 4.1 Scroll behaviour (verified, `MessagesTimeline.tsx:938-941,1496-1544`)

- Virtualised list (`@legendapp/list`, `LegendList`), `estimatedItemSize={90}`, `maintainScrollAtEndThreshold={1}`.
- `initialScrollAtEnd` unless find, a citation jump or a remembered "not at end" position says otherwise (`:1504-1506`). Opening a thread lands at the end.
- `maintainScrollAtEnd` has two modes: **smooth** while the agent is working, no sync in flight, reduced motion off and no settling; **instant** otherwise; **off** during citation positioning, position restore, find, fullscreen app rows, or when live follow is disabled (`:1513-1523`). That is "stick to bottom only if you were at the bottom".
- `maintainVisibleContentPosition: { data: true, size: true }` keeps the viewport still when rows above change size (`:938-941`); disabled during find/restore.
- `overflow-anchor: none`, `overscroll-y-contain`, `scrollbar-gutter-both` (`:1539`): the list owns anchoring, and the scrollbar gutter is reserved on both sides so the column does not shift.
- Per-thread remembered position (`rememberedPosition.atEnd`) restores where you were.
- **Top fade.** A 10-stop mask fades the top of the timeline under the header: stops `transparent 0%`, `10% at 10%`, `30% at 24%`, `58% at 42%`, `82% at 62%`, `96% at 82%`, `black 100%` (`index.css:496-507`, `MessagesTimeline.tsx:1540`).
- **Scroll-to-end pill** (`TimelineOverlays.tsx:27-56`): shown when not at the end; absolute, centred in the lane, `bottom = composer height + 4px`, `py-1.5`; a `glass` `xs` button (h-7, `sm:h-6`, `text-sm sm:text-xs`) with `ChevronDown size-3.5`, text `Scroll to end`, and an optional muted summary `· 3 new …`. `onPointerDown preventDefault` keeps the composer focus.
- **Minimap** (`TimelineMinimap.tsx`): a 72px (`w-18`) rail on the left edge, **pointer-fine devices only**, one 24×2px rounded tick per turn (`h-0.5 w-6`), the current turn `bg-muted-foreground/60`, others `/25`; hovering a tick opens a `w-80` `rounded-xl` card with a `text-sm font-medium leading-5` title and a two-line clamped preview (`max-h-[3.75rem]`, `text-muted-foreground`); click scrolls to the turn, smooth unless reduced motion (`:110-113,206-207,233-242`, `MessagesTimeline.tsx:1553-1560`).
- **Detail panels follow live output** only while pinned within 4px of the bottom (§3.3).
- **Hit areas.** The timeline itself takes keyboard focus (`tabIndex={-1}`, F6) with a 2px ring offset inward (`index.css:2699-2715`).

Our viewer: `MessageScroller` with `autoScroll`, `defaultScrollPosition="end"`, `content-visibility: auto` per item, `scroll-fade-b` mask at the bottom, an icon-only end button (`App.tsx:362-401`, `ui/message-scroller.tsx:40,64-71`).

### 4.2 Streaming

- New paragraph and code blocks fade in (`opacity` 0 → 1 over 600ms `ease-out`) as they arrive, only while `data-streaming`, so reopening a finished thread never replays it (`index.css:2283-2298`). Blocks before the last are finished and their parse is cached (`ChatMarkdown.tsx:2124-2125`).
- Streaming text lives in a separate store so the row does not re-render per token (`TimelineAssistantRows.tsx:31-36`).

### 4.3 Loading, empty and error states

| State | Rendering | Source |
|---|---|---|
| Work history loading | `role="status"`, `space-y-2 px-1 pb-1 pt-3`, three rows each a `size-3` block plus a pill bar `h-2.5` of width `2/5`, `3/5`, `1/3`; skeleton fill `bg-muted-foreground/15`, `animate-skeleton` (`motion-safe`) | `MessagesTimeline.tsx:1884-1899`, `ui/skeleton.tsx:5-17` |
| Work history failed | label `· Couldn't load work. Click to retry.` appended to the fold label | `MessagesTimeline.tsx:1873,1919-1921` |
| No thread selected | centred `Empty`: title `Pick a thread to continue`, description `Select an existing thread or create a new one to get started.`; block `w-full max-w-lg px-8 py-12`; header says `No active thread` in `text-sm font-medium` | `NoActiveThreadState.tsx:25-35` |
| Empty assistant reply | text `(empty response)` | `TimelineAssistantRows.tsx:38` |
| Tool call failed | icon tinted `--tool-error-icon`, trailing `X size-3`, accessible label | `TimelineWorkGroupRows.tsx:562-608` |
| Compacting, worktree setup | shimmer on the `Working` row | `TimelineWorkGroupRows.tsx:356` |
| New thread (draft) | hero composer centred with a headline | `ChatView.tsx:3784-3800` |

Our states: plain centred text lines `text-xs text-ink-faint` `py-20` for loading, and a two-line empty (`App.tsx:384,394`, `ChannelView.tsx:141`).

### 4.4 Motion principles (inferred from the comments, verified in code)

1. Opacity and a 4px translate only. No scale on content, no bounce.
2. Loops are stepped (`steps(4)`, `steps(6)`, `steps(30)`) and pause when off-screen.
3. Every animation has a `prefers-reduced-motion` branch (`index.css:592,665,678,2288`).
4. Hover-revealed chrome uses a 200ms opacity fade; coarse pointers always show it.
5. Layout never animates (no height tween on rows; `AnimatedHeight` exists elsewhere in the app, not in the timeline rows read here).

## 5. Goodies, ranked

Fit is judged against our model: the viewer **reads transcripts** (JSONL events) and **writes only through `tmux send-keys`**. It cannot interrupt, steer, fork, rewind or approve through an API. "Fit Y" = pure rendering; "Partial" = needs a design ruling or an extra read; "N" = needs agent control we do not have.

Rank key: value (H/M/L) = how much it changes the feel of the chat view; effort (S ≤ half a day, M ≤ 2 days, L > 2 days).

| # | Goodie (t3code evidence) | Value | Effort | Fit | Note |
|---|---|---|---|---|---|
| 1 | **One-line tool rows, grouped, with a per-turn fold** ("Worked for…" line, chevron, hairline under it) (`WorkLog.tsx`, `MessagesTimeline.tsx:1901-1937`) | H | M | Y | Replaces our expanded trace rail. We already group by turn (`ActivityDisclosure`). |
| 2 | **Live label shimmer** on the active tool or `Thinking` (stepped, paused off-screen) (`index.css:578-682`) | H | S | Y | Pure CSS. Replaces `viewer-fade` on `Working…`. |
| 3 | **Working row with a ticking timer** `Working for 1m 03s` (`TimelineWorkGroupRows.tsx:352-384`) | H | S | Y | Needs only the turn start time. Update through a text node, not state. |
| 4 | **Unboxed assistant prose at 14px / 1.625 in a 46rem lane**, user as a right-aligned 80% rounded bubble (`TimelineUserMessageRow.tsx:941`) | H | S | Y | The largest single visual change; see §9 recipe. |
| 5 | **Hover-revealed metadata** (timestamp, copy), last message pinned visible (`TimelineAssistantRows.tsx:216-219`) | H | S | Y | Removes the per-turn header clutter. |
| 6 | **Streaming block fade-in** gated on a streaming flag (`index.css:2283-2298`) | M | S | Y | A transcript tail that grows by polling is equivalent to streaming. |
| 7 | **Long user message fold** (176px + fade mask + "Show full message") (`TimelineUserMessageRow.tsx:1213-1282`) | H | S | Y | Operators paste long prompts to agents. |
| 8 | **Scroll-to-end pill with a summary** (`Scroll to end · 3 new`) (`TimelineOverlays.tsx:27-56`) | M | S | Y | We have `MessageScrollerButton`; add label and unread count. |
| 9 | **Smart stick-to-bottom**: smooth only while working, never when the user scrolled up, restore per-thread position (`MessagesTimeline.tsx:1513-1523`) | H | M | Y | Needs a per-thread remembered position. |
| 10 | **Code block frame** with language label, wrap toggle and copy in a header (`MarkdownCodeBlock.tsx:67-88`) | M | M | Y | Highlighting is separate (not audited). |
| 11 | **Day-aware timestamps** with a full-date tooltip (`timestampFormat.ts:270-288`) | M | S | Y | Replaces our `clock()` plus day dividers. |
| 12 | **Follow-live detail panels** (stay pinned within 4px of the bottom) (`WorkLog.tsx:150-177`) | M | S | Y | For running Bash output. |
| 13 | **Visibility-gated, stepped animations** (`index.css:301-306`) | M | S | Y | We may show many animated agents at once. |
| 14 | **Timeline minimap** (ticks, hover preview, click to jump) (`TimelineMinimap.tsx`) | M | L | Y | Fine-pointer only. Useful for 200-turn threads. |
| 15 | **Failed-tool marking** (red icon, trailing mark, accessible label) (`TimelineWorkGroupRows.tsx:562-608`) | M | S | Y | |
| 16 | **Status pills only for abnormal states** (`interrupted`) (`TimelineAssistantRows.tsx:306-311`) | M | S | Y | Fits the Restraint rule: state, not metadata. |
| 17 | **Thread find** (Ctrl+F inside the timeline with reveal of folded content) (`MessagesTimeline.tsx` find paths) | M | M | Y | Needs virtual-list reveal logic. |
| 18 | **Chat width setting** (comfortable 46rem / wide 72rem / full) (`index.css:2380-2386`) | L | S | Y | One CSS variable. |
| 19 | **Appearance sizes** (interface, prompt, code) and font overrides (`appearanceFonts.ts`) | M | M | Y | We already need rem-only (12px root). |
| 20 | **Glass composer card** (blur, outline, inset highlight) (`ComposerSurface.tsx`) | M | S | Y | Conflicts with our shadow and border rules (§10). |
| 21 | **Sticky drafts, prompt history** (`composerPromptHistory.ts`, `composerDraftStore.ts`) | M | M | Y | Not audited in depth; local storage only. |
| 22 | **Reply to a response** (select text, send a quoted follow-up) (`AssistantReplyButton`, `TimelineAssistantRows.tsx:257-303`) | M | L | Partial | Our send path is text via send-keys; a quoted prefix is plain text. t3code stores a structured citation; we would not. |
| 23 | **Fork thread from a message** (`AssistantForkButton`) | M | L | N | Needs agent control. |
| 24 | **Revert / checkpoint** (`RevertUserMessageButton`) | M | L | N | Needs agent control. |
| 25 | **Pending approvals row** (`TimelinePendingApprovalRow`) | H | L | Partial | We can detect "waiting for approval" from the transcript; answering is `send-keys`. Needs a lead ruling on the risk (CLAUDE.md: the lead answers pane prompts after reading the command). |
| 26 | **Subagent groups, background work chips** | M | L | Partial | Pi has no equivalent event stream yet. |
| 27 | **Brand grain texture** (`index.css:1793-1810`) | L | S | Y | Rejected, see §10. |

## 6. Further UX ideas beyond t3code (fit our model)

These ideas use only transcript data and `send-keys`.

1. **Delivery state machine on a sent message.** Show `queued → typed → seen in transcript → answered` by matching the sent text against the next user event. Our optimistic message already has `status` and `error` (`optimistic.ts`); the missing step is "seen". It makes send-keys feel reliable.
2. **"New since you looked" divider.** Persist the last-read event time per thread (browser storage, wrapped in try/catch) and draw a hairline with the label `New` where it falls. Slack and iMessage do this; t3code has no equivalent.
3. **Per-turn file summary.** Extract file-edit tool calls into a line `3 files changed +42 −7` under the turn fold, from the tool input paths and diffs. A reviewer reads this before the prose.
4. **Per-turn cost and duration.** Put `1m 12s · 8.4k tokens` in the hover meta row when the transcript carries usage.
5. **Stuck-agent hint.** When the last event is older than N minutes and status is `working`, show `No activity for 6m` in the working row, in the muted colour (never red). Inferred from event timestamps only.
6. **Failure roll-up on the fold.** A folded turn that contains a failed tool shows a small red dot and `1 failed` on its header line, so folding never hides an error.
7. **Tool visibility switch.** Three global levels, `none / summary / all`, remembered per viewer, so a reader of a 300-turn thread can read prose only.
8. **Keyboard map.** `j` / `k` next / previous turn, `e` expand or collapse all tool rows in the focused turn, `/` find, `y` copy the last assistant message, `G` jump to end, `Esc` clear focus. The minimap tick strip mirrors `j/k`.
9. **Intercom as a conversation lane.** Group consecutive agent-to-agent messages between the same pair into one block with `from → to` once, then bubbles on alternating sides (our `IntercomCard` repeats the header every time). Collapse delivery receipts into one line.
10. **Quick-send macros.** A row above the composer with `Continue`, `Status?`, `Summarise` that fill the composer (never auto-send). The send path stays the operator's decision.
11. **Interrupt button (needs ruling).** `Escape` via `send-keys` is the only interrupt we have; show it only for a working agent and require a confirm. The contract forbids attaching to a pane; `send-keys` is allowed, but an interrupt changes agent state, so the lead must rule.
12. **Pinned context line.** When scrolled more than two screens away from the first user message of a turn, show a one-line sticky header with that prompt's first 80 characters.
13. **Anchor links.** `#event-<id>` deep links so one lead can point another at a turn.
14. **Copy turn as Markdown.** One action on the fold header.
15. **Older turns on demand.** For threads above N turns, render the last N and a `Show 120 earlier turns` row (t3code does this for work history, `MessagesTimeline.tsx:1569-1601`).
16. **Reduce redundant chrome in multi-agent threads.** Show the agent name only when the speaker changes from the previous turn.

## 7. Restyle recipe (values mapped to our tokens)

All sizes are rem so they follow the operator's 12px root. Our tokens are authoritative; this table says which t3code value to take and what to map it to.

| Element | Take from t3code | Use our token |
|---|---|---|
| Thread lane | `max-w-[46rem]`, padding-inline `0.75rem`, `3rem` from 640px | `mx-auto w-full max-w-[46rem] px-3 sm:px-12` |
| Prose | 0.875rem / 1.625, colour foreground 90% | `text-sm` is 0.8125rem in our ladder; use a viewer-local `--chat-text: 0.875rem` and `line-height: 1.625` only on `.xtrm-prose` (§3.3 of the console doc lets prose own its scale) |
| Heading sizes | 1.25 / 1.125 / 1 / 0.875rem, weight 600, lh 1.3 | `.xtrm-prose` h1-h4 |
| Block rhythm | 0.65rem | `.xtrm-prose` margins (ours is 0.7rem; keep 0.7) |
| Tool row | `min-h-6` (1.5rem), icon box 1.5rem, `gap-1.5`, label 0.875rem secondary-label | `text-ink-muted`; icon 0.8125rem (`text` glyph step, see §10) |
| Meta row | 0.75rem, `tabular-nums`, `opacity-0 → 100` 200ms | `text-xs` is 0.72rem in ours; keep ours |
| User bubble | 80% max, radius 16px, p 12px, `rounded-tr-md`/`rounded-br-md` when grouped | `bg-control`, radius needs a ruling (§10) |
| Code frame | radius 8px, border at 70% light / none dark, header 0.6875rem mono | `rounded-md` (8px), `border-border-muted`, `text-2xs` |
| Dividers | `border-border/60` at turn boundaries only | `border-border-muted` |
| Composer | 16px radius, glass, 2-line min, 208px max | `bg-raised`, `rounded-md` or ruling, `max-h-52` |
| Scroll pill | glass, `rounded-full`, `h-6`, chevron + label + summary | `bg-raised shadow-float` |
| Motion | 200ms opacity reveal; 600ms stream fade; 2.2s stepped shimmer paused off-screen | add `--ease-drawer` only if a drawer appears |

## 8. What t3code does not have that we have (keep)

- Multi-agent identity: role chips, status dots, agent marks, intercom cards. t3code is single-agent per thread.
- Channel and "all events" views with a day divider.
- Optimistic sends with an error and dismiss path.
- Sidebar session tree. Not audited and out of scope.

## 9. Evidence for the numbers a builder will check first

| Question | Answer | Source |
|---|---|---|
| Prose font size | 14px at a 16px root, line height 1.625 (22.75px) | `ChatMarkdown.tsx:2110` |
| Why does `index.css` say 15px? | Stale comment | `index.css:2310` |
| Max chat width | 46rem | `index.css:131` |
| User bubble radius | 16px | `TimelineUserMessageRow.tsx:941` + `index.css:299` |
| Tool line height | 24px | `WorkLog.tsx:64` |
| Code font size | 13px default | `contracts/settings.ts:190` |
| Dark canvas | `#000` | `index.css:1225` |
| Dark user bubble | ≈ `#1e1e1e` (inferred) | `index.css:1240` |
| Weights used | 400 body, 500 labels, 600 headings, 700 strong | §1.3 |
| Shadows in the timeline | none | §1.4 |

## 10. Conflicts with `console-ui-system.md`

| # | Topic | t3code value | `console-ui-system.md` rule | Resolution proposed |
|---|---|---|---|---|
| 1 | Prose size | 14px / 1.625 | Prose owns its scale (`§3.3`: ".xtrm-prose … is outside the type ladder by design") but the shell body is `text-sm` 13px | No conflict if prose stays in `.xtrm-prose`. Set the prose size there only; do not touch `--text-sm`. |
| 2 | UI text sizes | `text-xs` 12px, `text-2xs` 11px | `text-xs` 0.72rem, `text-2xs` 0.625rem (`§3.3`) | Keep ours. Differences are 0.5px and 1px. |
| 3 | Row glyph size | 16px icons in a 24px box next to 14px text | "A glyph never exceeds its row's text" (`§3.4`); row glyph is `text` step 0.8125rem | Use the `text` step (0.8125rem). Conflict with the t3code look (smaller icons). Accept ours. |
| 4 | Radii | 16px bubble and composer, 8px code frame | `rounded-md` 8px for rows and cards; `rounded-lg` 10px for floating layers only; nothing larger (`§3.2`) | **Open ruling.** Option A: bubble 12px (`rounded-xl`) added as a new "message" step. Option B: bubble at `rounded-lg` 10px. Recommend B plus the grouped-corner tightening at `rounded-sm`. The lead decides. |
| 5 | Boxes and borders | Code frame has a 1px border (light), composer has an outline, attempt fold is a bordered box | "Hairlines, not boxes" (`§2.1` rule 3, `§11`); no card around a list | Code frame: border only in light, none in dark (as t3code) using `border-border-muted`. Composer outline: `border-border` input border (`§3.1`: "input borders, form controls"). Attempt fold: hairline only. |
| 6 | Shadows | Composer `0 1px 2px` in light, buttons `shadow-xs` | Shadows only on floating layers; `shadow-float` / `shadow-panel`; no `shadow-[…]` literal (`§3.2`) | Drop the composer shadow; our dark theme already has none. The scroll pill takes `shadow-float`. |
| 7 | Glass and blur | Composer and pill use `backdrop-blur` and `saturate` | Not in the doc; no glass token | Not adopted. A solid `bg-raised` composer satisfies the ladder. If wanted, add a token through the lead. |
| 8 | Grain texture | SVG noise on every surface | "Depth comes from background shifts" (`§3.1`) | Not adopted. |
| 9 | Colour | True black dark canvas, indigo primary, blue links | Ladder `deep → sidebar → surface → raised → control`; violet accent; links are accent-ink (`§3.1`) | Keep our ladder. Links: `--x-accent-ink`, dotted hover underline from t3code. Bubble fill: `--x-control`. |
| 10 | New colours | `warning` amber, `info` blue, `guest` fuchsia | "Colour only through the existing tokens"; no new tint (`§2.3` rule 4) | Do not import them. Use `--x-danger` and `--x-ink-muted`. |
| 11 | Pills | Scroll pill (rounded-full), status pill | Chips only for state; no pill rows (`§2.3` rules 2 and 5) | Status pill for `interrupted` is state: allowed. The scroll pill is a floating control, not a chip: allowed with `shadow-float`. |
| 12 | Hover reveal | Meta fades in on hover | "Chrome is quiet" (`§2.1` rule 2) | Compatible. Must stay keyboard-reachable (`focus-within`). |
| 13 | Dividers | `border-border/60` | `--x-border-muted` (ink 7% / white 8%) | Use `--x-border-muted`. |
| 14 | Weights | 400 / 500 / 600 / 700 | Title `font-medium`; row labels inherit; headings 600 in prose | Compatible. Do not use 700 outside `strong`. |
| 15 | Fonts | System stack, optional Inter | Figtree Variable and Geist Mono Variable (viewer `styles.css:2-3,121`) | Keep ours. |
| 16 | Row height | Tool row 24px (`min-h-6`) | Rows are 28 / 32px (`§4.2`) | Conflict for dense logs. The chat view is not a list; treat the tool row as a transcript line, not a `Row`. Recommend a 24px line documented as a transcript exception. Needs a lead ruling. |
| 17 | Motion | Stepped 2.2s shimmer, 600ms fade | Doc mentions motion only for the toolbar filter (150ms, `§5.3`) | Add a short motion section when adopted. Keep reduced-motion branches. |

## 11. Open items (draft 2)

Not yet read; nothing above depends on them:

- Syntax highlighter theme names and token colours (`@pierre/diffs`, shiki). Needed to match code colours.
- `messageActionPillClassName` and the composer controls bar (model picker, effort glyph, attachments).
- Tool detail panels (`CommandOutputPanel`, diff panels), subagent rows, approvals row.
- Thread header and sidebar (out of scope for the chat view).
- Quick computed contrast ratios for the t3code text colours on both canvases.

## 12. Licence

- Repository licence: MIT, "Copyright (c) 2026 T3 Tools Inc." (`LICENSE:1-3`). The MIT licence permits reuse of code with the copyright and permission notice retained.
- `TRADEMARK.md:3-20`: the MIT licence covers source code only. The names **T3 Code**, **T3 Connect**, **T3 Tools**, the T3 wordmark, logos, icons, `assets/` and trade dress are not licensed. A fork or derivative must use its own branding and say it is unofficial.
- **What this document does.** It records values and patterns (colours, sizes, weights, structure, timings) with file and line citations. It copies no t3code source. It uses no t3code name, wordmark, logo or asset in any proposed UI.
- **Rule for the builder.** Write our own CSS and components from the values here. Do not paste t3code source. If a future slice wants to reuse code verbatim (for example the `LegendList` setup or a stepped-shimmer utility), the licence allows it under MIT only with the copyright and permission notice kept in the file, and the lead must approve it first. Do not use the strings "T3 Code" or the T3 marks in the viewer. Do not copy the grain texture or the brand themes (`t3-chat`, `index.css:1577-1580,1801-1804`).
- Third-party licences of t3code dependencies are listed in `third-party-licenses/` and `third-party-licenses.config.json` in the repository; they were not audited.
