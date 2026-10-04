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

## How to use these files

Use them to compare interaction geometry, density, search/navigation placement, collapse behavior and visual direction while implementing `packages/xtrm-app`.

Do not treat fixture data, labels, counts, statuses or mock routing as source-of-truth product semantics. Current technical and product decisions live in the canonical XTRM App PRD/architecture/adoption documents and current source.
