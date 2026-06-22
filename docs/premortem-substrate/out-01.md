## Phase 1 - Initial Analysis

Design drift failure starts from pattern: new concern enters doc, becomes new runtime concept, gets labeled convergence. Substrate scope already spans daemon, socket, SQLite authority, five packages, container lifecycle, validator, channels, tether, collision matrix, memory relevance, pulse layer, skill injection, participant SDK, console, migration. Serial sequencing makes drift lethal: stage 0 gates all later value.

Main risk: implementation learning loop routes surprises into architecture revision, not shipping slice. Each edge case becomes design input. Runtime never hardens.

## Phase 2 - Devil's Advocate

Counterpoint: absorbing concerns can prevent bad foundations. Chain coordinator, skill injection, issue relationships may be real missing primitives. Cutting scope too early could ship weak substrate requiring rewrite.

But failure reason stays valid because plan has no freeze rule. No coexistence shim, no deferred console, no migration bridge, serial stages, same author/implementer. No external brake. Design has prestige; bugs become proof doc needs one more section.

## Phase 3 - Synthesis

Root problem not ambition alone. Root problem: no boundary between architecture discovery and runtime delivery. Substrate treats implementation edge cases as requirements intake. That makes stage completion unstable. Stage 0–4 must become thin, frozen, ugly, measurable runtime before any new abstractions land.

## Phase 4 - Final Refined Output

Recommendation: freeze substrate MVP around daemon, state.db, socket, issue validator, chain container only. New concerns become post-MVP beads unless blocking running chain container in production.

## Final Answer

### The Failure Story

June 2026 started with `substrate_design_it.md` at Bozza revisione 12 and “converged.” Stage 0 began: daemon, `state.db`, Unix socket, five-package client boundary. First implementation week exposed protocol versioning, crash recovery, opaque-ID correlation, and SQLite migration questions. Instead of cutting scope, rev 13 added invariants and daemon lifecycle rules. Stage 0 took all June and most of July.

July and August should have delivered stage 1 issue schema, stage 2 channels, stage 3 tether, and stage 4 chain container. Instead, stage 1 hit §6.7 issue-relationship ambiguity, stage 2 raised channel/domain-table ownership concerns, and stage 4 revived coordinator semantics: fresh-context spawning, kill+respawn, journal gap detection, `coordinator_model: null`. Each edge case became design work. Runtime PRs stalled behind “one more clarification.” Validator and chain lifecycle stayed demo-level; no operator used `sb container ps chain:X`.

September through December collapsed into permanent draft mode. Collision matrix, plan artifacts, epic/wave kinds, advisor invites, small-model tether relevance, reconciler, console feed, and bd migration all depended on unfinished earlier stages. Since there was no coexistence shim, cutover risk rose every month. Operators kept using sp+bd+GitHub because it existed. Substrate became architecture vocabulary pasted onto tribal practice, not runtime substrate.

### The Underlying Assumption

Designer assumed implementation discoveries could keep expanding architecture without consuming delivery runway or invalidating MVP freeze.

### Early Warning Signs

- Revision velocity beats shipped runtime velocity: two or more new doc sections/operator-note absorptions land after stage 0 starts while daemon + issue validator + chain container remain unused in daily work.
- Implementation bugs get resolved as design revisions or new beads instead of merged code: “needs section,” “under-drilled,” or “post-revision clarification” appears more often than runtime PRs closing stage acceptance criteria.