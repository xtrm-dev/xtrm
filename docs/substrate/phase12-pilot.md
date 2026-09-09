# Phase 11 — Pilot import + cutover record (frozen)

**Bead:** `xtrm-7wc.12` · **Base:** origin/main at P9 · **Date:** 2026-09-09

## Pilot import (live board data)

- **Backup (pre-pilot):** `bd export --all` → `/tmp/sb-pilot/board-backup.jsonl`
  (265 lines: 191 issues + 74 memories) plus byte-identical
  `board-backup.orig.jsonl`. The live board was never written by the pilot.
- **Edges:** `bd dep list --json` batched over all ids → 230 records
  (`parent-child` 124, `blocks` 64, `validates` 25, `discovered-from` 12,
  `relates-to` 4, `supersedes` 1). Direction verified live: `{A depends-on B,
  blocks}` ⇒ B blocks A; `{A depends-on B, parent-child}` ⇒ A child of B.
- **Command:** `sb import beads --file board-backup.jsonl --edges-file
  edges.json --project prj_pilot --create-project PILOT:...` into a scratch
  SQLite DB.
- **Result:** 191 created, 230 edges applied, 0 edge errors, 191/191 unready,
  0 dispatchable, ~2s. Alias spot checks (`xtrm-7wc`, `xtrm-7wc.1`,
  `xtrm-7wc.11`) resolve with hierarchy intact.
- **Resume:** re-run → 191 skipped, 0 created (G44).
- **G47 regression:** `sb export --project prj_pilot` → 191 issues + 336
  edges; re-import into a fresh DB reproduces the graph.

### Pilot findings fixed in-lane

1. **Resolution precedence (G45):** Beads IDs shaped like human refs
   (`xtrm-401`, `xtrm-957`) hit the PREFIX-NUMBER branch of `resolveRef`
   and threw instead of falling through to alias lookup — breaking both
   alias resolution and import idempotency for those rows. Fixed in
   `issue-service.ts` (fall through when no project/row matches) with a
   regression test. Touches Phase 1 code; justified as a G45 blocker, no
   migration or schema change.
2. **Edge vocabulary:** live `validates`/`discovered-from`/`relates-to`/
   `supersedes` mapped into the Substrate vocabulary (unknown ⇒
   `relates_to`, never dropped silently).

### Abort / resume procedure

- **Resume:** re-run the same `sb import beads` command (idempotent on the
  `beads` alias + `beads-import:<id>` keys; verified 191/191 skipped).
- **Abort:** discard the scratch DB; the live board is untouched (import
  performs zero Beads writes). Restore confidence by diffing a fresh
  `bd export --all` against `board-backup.orig.jsonl`.

## Cutover scope and boundaries

**Migrated (authority prose):** AGENTS.md + CLAUDE.md managed blocks,
`.agents/skills/beads/SKILL.md` (compat notice), Specialists main PRD
dispatch-authority + guidance prose (35 replacements), amendment display
label, `substrate-light-prd.md` (superseded header), `substrate_design_it.md`
(cutover note appendix), runtime README + chain-runtime R1/R6.

**Left intact with reason:**
- Hook *mechanics* (`.codex/hooks.json`, `.claude/settings.json`,
  `scripts/install-beads-hooks.sh`, `.bd-sync` hooks): no `sb`
  hook-protocol adapter exists, and Phase 11 adds no new Substrate
  features — replacing them with nothing would break harnesses silently.
  G49 is proven for the `sb` workflow instead (test spawns the real bin
  with `bd` absent from PATH).
- `deterministic-xtrm-runtime.md`, `xt-pi-role-context-integration-brief.md`:
  xt-runtime mechanics owned by their track, no Substrate authority claim.
- Board-audit / service-knowledge / research docs: tool usage references,
  not work-authority statements.
- Frozen records (`phase0-*`, `phase10-conformance.md`): historical
  evidence, excluded from the G48 sweep by design.

**Open for the owning tracks:** managed-block generator provenance (no
in-repo generator found — copies edited directly; a future `bd hooks
install` may restore Beads blocks), Codex/Claude hook-protocol adapters,
xt-runtime flag migration.

## G48 sweep

`tests/cutover.test.ts` asserts the migrated surfaces carry Substrate
markers and no normative Beads-authority claim remains. Green in CI.
