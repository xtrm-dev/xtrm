## Phase 1 - Initial Analysis

Substrate failure mode: architectural coherence beats operator relief. Five real pains get bundled behind daemon, store, socket, packages, identity, SDK, console. Small fixes lose priority because “throwaway” bd+sp stack marked dead.

Main risk: stage-gated sequence makes first useful operator fix arrive late. Stage 7 collision matrix depends on stages 0–6. Existing pain continues during build.

## Phase 2 - Devil's Advocate

Rebuild could be justified if isolated fixes create worse fragmentation. Thin wrappers might deepen tribal stack and make later migration harder.

But plan rejects coexistence shim. That removes adoption bridge. Also author = implementer means design taste can outrun feedback from production use.

## Phase 3 - Synthesis

Root failure: substrate optimizes for final-state purity, not time-to-relief. Existing stack already routes work. Fixes can attach there. Runtime platform should emerge after pressure-tested primitives, not before them.

Best mitigation: ship five narrow patches now, then let substrate absorb proven behavior later.

## Final Answer

### The Failure Story

June 2026 started with rev 12 “ready enough”, but implementation went straight into stage 0: daemon, `state.db`, Unix socket, package boundaries, migration shape. That work consumed June and July because every later stage needed stable connection semantics, schema ownership, crash behavior, and client API rules. Meanwhile existing bd+sp chains stayed implicit, claims stayed weak, collisions still appeared at integration, and memory recall still used FTS5.

August delivered stage 1 and stage 2 in demo form: issue classifiers, Stage-1 validator, channels v0. But none sat in operator path because clean cutover was deferred until stage 13 and no coexistence shim existed. September added tether v0 and chain container lifecycle, but `sb container ps chain:X` still described substrate-only containers, not real sp dispatches. Operators kept using old commands, then manually mirrored outcomes into substrate test state when demos needed screenshots.

By November, stage 7 collision matrix worked only for substrate-managed worktrees. Real work still started through bd+sp, so file locks missed most active branches. December postmortem showed substrate had five packages, identity tables, emitter dedup, plan artifacts, and promising console feeds, but original pain was unchanged in production. Five problems that needed five small patches had waited behind runtime replacement.

### The Underlying Assumption

Designer assumed coherent runtime rebuild would deliver operator relief faster than shipping targeted fixes on existing bd+sp infrastructure.

### Early Warning Signs

- By end of June, no production command exists for at least one narrow fix: `sb chain ps`, claim-time validator hook, active-worktree collision watcher, embedding recall on `bd_memories`, or `bd create` JSON schema.
- More commits land in daemon/package/identity/socket scaffolding than in operator-facing bd+sp hooks, while daily work still depends on manual chain naming, manual preflight, and late collision discovery.