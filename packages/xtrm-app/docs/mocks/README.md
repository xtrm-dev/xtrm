# XTRM Console v2 visual mock references

These HTML files preserve selected visual explorations from the Console v2 design work.

They are **reference artifacts only**. They are not canonical implementation authority and must not override the current PRD, architecture documents, adoption audit, Substrate contracts, or repository-local executable work state.

## Preserved references

### `console-v2-v13-dual-rail-reference.html`

Curated reference derived from the v13 dual-rail exploration. It preserves the concepts that remained important after later visual simplification:

- full-width global search;
- persistent top-level icon rail;
- rich contextual repository/work sidebar;
- contextual sidebar collapsing to a narrow rounded reopen rail rather than disappearing;
- persistent right Inspector rail;
- canonical Drawer geometry;
- repository selector/context and grouped Work/Governance navigation.

This file is intentionally a compact reference snapshot rather than a product specification.

### `console-v2-v15-supernova-substrate.html`

Rebuilt mock informed by the Supernova/PiChamber/Conar audit round. It explores a quieter, flatter and denser visual language and starts with the first three intended real product surfaces:

- Substrate Issues;
- Program / governance;
- GitHub / repository activity.

It retains the global rail, contextual sidebar and canonical Inspector Drawer, while moving away from dashboard/card-heavy composition.

### `console-v2-v14-agent-supernova-substrate.html`

The operator's v14 "Final GUI Simulation", added for the Agent experience epic (XTRM-621, brief in `../design/agent-experience/brief.md`). It is the richest Agent-surface reference so far:

- Frame header with History / Fork / Inspect / `⋯` actions;
- grouped command activity ("Ran 3 commands · 1 failed"), coordination blocks (message, reply, chain run with gates, fork with lineage);
- History panel with Frames and Tree tabs, `/` command menu, reference bar, composer with model/effort picker and permission mode;
- Frame dock, drawer tabs (Overview, Live, Work, Coordination, Telemetry, Evidence), plus Agents fleet and graph views.

The only change from the operator's original file is the removal of the Google Fonts `@import` on line 7, so the file loads without network access; fonts fall back to the local stacks. Inspiration, not authority.

### `sidebar-restyle-proposals.html`

Status: decided (XTRM-632) — variant B, `Box` for Project, `SquareStack` for Issues, `MousePointer2` for Agents, trailing always-visible stroke chevron. The mock stays as the reference for alternates.

Sidebar restyle and icon-system comparison for the Workspace / Github / System information architecture. One information architecture rendered four times so only the tokens differ:

- a `Ref` column reproducing Linear's shipped sidebar as measured from the operator's screenshot (30 px rows, 16 px icons at stroke 1.5, 13 px labels at weight 500, 20 px nested indent, muted icons, filled section carets);
- baseline (today's 32 px rows, 14 px icons at stroke 1.6, 13 px labels at weight 500);
- A Compact, B Linear (recommended), C Heavy — row height, icon size and stroke, label and header weight, and nested indent all vary;
- live `--x-*` palette values for both themes, with a light/dark toggle;
- every icon slot with its recommendation and linked lucide alternates;
- an icon weight × size matrix and a Figtree text-weight strip.

The companion scope document is [`../design/sidebar-restyle.md`](../design/sidebar-restyle.md). Icons are lucide 1.70.0 geometry inlined at the stroke widths under test; the file needs network access only for the Figtree and Geist Mono webfonts.

### `sidebar-weight-connection-activity.html`

Status: built (A1 weight, 2.25 stroke; B2 board line) — the source footer is now a drop-up popover, and the feed rows are accordions (XTRM-757 owns the data work).

Three follow-ups to the restyle on one page, at real sidebar width, with lucide 1.70.0 geometry inlined:

- **A · weight ladder** — stroke 2 / 2.25 / 2.5 crossed with label weight and row height, plus a 30 px zoom strip so the stroke difference is legible at a glance. A1 (stroke 2.25, 600 at 13 px) is what ships in `src/ui/icon.tsx`;
- **B · connection indicator** — dot-only, dot + latency, two-line, degraded and offline states for an ssh-forwarded board. B2 is the shipped footer row; the host is in the row title, not in the visible line;
- **C · activity feed** — a mixed git / GitHub / Substrate timeline with source chips and counts, then **C2** the same rows as accordions (expanded journal note, expanded review comment with the quoted hunk, collapsed rows) so the shape is settled before XTRM-757 implements merging;
- a journal-kind legend covering every kind the feed must render, including the ones with no natural GitHub analogue.

## How to use these files

Use them to compare interaction geometry, density, search/navigation placement, collapse behavior and visual direction while implementing `packages/xtrm-app`.

Do not treat fixture data, labels, counts, statuses or mock routing as source-of-truth product semantics. Current technical and product decisions live in the canonical XTRM App PRD/architecture/adoption documents and current source.
