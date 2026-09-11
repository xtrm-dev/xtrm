<!-- A4→A8→A9 handoff. This map is the coordination record; it makes no
     installed-copy changes itself. -->

# Staged sources → canonical installed Core skills: promotion map

**Boundary statement.** xtrm-6qu.4 claims source-level conformance only: the
staged canonical sources pass the SKILL-MIGRATION-GATE statically and their
taught verbs are proven live against the `sb` CLI
(`skill-migration-gate.test.ts`: 64/64, suite 270/270). A4 does **not** claim
installed-workflow acceptance — a worker performing the full lifecycle from
an installed skill copy is proven only by the A9 sweep and the A10
acceptance gates on merged main. No installed copy in this bead was written.

## Promotion path

```text
A4 staged canonical sources (this bead, xtrm repo)
  docs/substrate/skill-migration-gate.md
  docs/substrate/skills/using-xtrm.md
  docs/substrate/skills/planning.md
  docs/substrate/skills/starting-and-resuming-work.md
        ↓  consumed by
A8 generator fixes (§47, xtrm-6qu.8 — MUST land first)
  generator templates + drift reconciliation for AGENTS.md / CLAUDE.md
  managed blocks and installed skill copies
        ↓  installed / swept by
A9 repo migration + fleet sweep (§§43–45, §48, xtrm-6qu.9)
  canonical installed Core skill sources + managed-checkout rollout
        ↓  proven by
A10 acceptance (§§49–55, §57): fresh-machine, upgrade, workflow,
  specialist, hook-parity, docs gates + final report
```

## Source → consumer mapping

| Staged source (A4) | A8 generator input becomes | Installed consumer (A9 installs) |
|---|---|---|
| `docs/substrate/skills/using-xtrm.md` | Core `using-xtrm` template content | `~/.xtrm/skills/default/using-xtrm/SKILL.md` (replaces Beads-first copy) |
| `docs/substrate/skills/planning.md` | Core `planning` template content | `~/.xtrm/skills/default/planning/SKILL.md` |
| `docs/substrate/skills/starting-and-resuming-work.md` | Core `starting-and-resuming-work` template content | `~/.xtrm/skills/default/starting-and-resuming-work/SKILL.md` |
| `docs/substrate/skill-migration-gate.md` | Gate definition for generator self-check + `.5` application | Referenced by A9 sweep checks and A10 acceptance; installed copies do not embed it |

## Sequencing constraints (do not violate)

1. A8 lands before any promotion: hand-editing installed copies while the
   generator is Beads-first recreates the defect §47 exists to prevent.
2. A4's branch (`xt/6qu4`, parked at `d764216` + this map) merges after A8
   per CONTRACT DELTAS sequencing — not merely after A3.
3. O3 fence holds throughout: service-knowledge installed files and the
   reconcile/drift/activator machinery stay owned by
   xtrm-56flm / xtrm-401 / xtrm-crz.

## Handoff checklist for the A9 worker (core-xt-pi-6qu9-core)

- [ ] A8 generator merged; template inputs accept these four sources verbatim.
- [ ] Installed copies regenerated (not hand-edited) from the staged sources.
- [ ] `sb import beads` aliases still resolve; no reverse sync introduced.
- [ ] Installed-copy workflow run on a fresh checkout exercises
      Issue → claim → resume → execute → journal → validate → provenance →
      close without previous chat (A10 workflow gate evidence).
- [ ] A4's gate test still passes against the promoted content (re-run
      `skill-migration-gate.test.ts` with installed-copy paths if the
      generator relocates them).
