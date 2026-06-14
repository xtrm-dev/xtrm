## Phase 1 - Initial Analysis

Substrate fails because visibility arrives last, not first. Runtime entities become real in SQLite, but operators still consume `sp feed`, `bd show`, logs, prose notes. New architecture adds IDs, lifecycles, collisions, plans, lineage, but no entity-aware surface.

Core mismatch: §16 says dashboard reveals runtime. §14 defers dashboard. Stage 12 gives merged feed, not dashboard. Adoption depends on seeing containers as objects, not believing daemon stores them.

## Phase 2 - Devil's Advocate

CLI feed could be enough if operators prefer terminal. But failure reason says value claim is visual first-class entities: chains, collisions, plans, lineage. Stream fusion cannot show topology, causality, or collision heat.

Backend-first could work if APIs stabilize before UI. But no coexistence shim plus clean cutover forces operators onto invisible substrate before trust forms. That turns validation into production pain.

## Phase 3 - Synthesis

Real failure is sequencing, not console polish. Console is treated as downstream renderer, but for Substrate it is adoption-critical infrastructure. Without UI, runtime state has no operator affordance, so old tribal tools remain default.

Fix would be stage-gating: no Stage 7 collision matrix, Stage 8 epic/wave, or Stage 13 migration without minimum entity-aware console slices.

## Final Answer

### The Failure Story

June became daemon month. Stage 0 took three weeks longer than planned because Unix socket auth, SQLite locking, and feed durability consumed attention. By mid-July, Stage 1 validator and Stage 4 chain containers existed, but only as `sb` rows and JSON feed events. Operators could create `container_id`s, lifecycle moved `open → working`, and nobody looked at them except through logs.

August and September made invisibility worse. Channels v0, tether v0, seed channel, plan artifacts, and approval landed as backend tables. Stage 7 collision matrix started recording file-level conflicts across worktrees, but no lineage drawer, no collision board, no container map existed. Operators still asked “which chain owns this file?” in chat, then checked `bd show`, `sp feed`, and git status. Collision data was correct but buried.

October through December shipped more runtime without more sight. Epic/wave kinds, advisor invite rules, small-model tether relevance, and reconciler specialist added more entities and state transitions. Stage 12 only merged `sp feed -f` with `sb feed -f`, so console stayed stream-shaped, not entity-shaped. Clean cutover to substrate migration then felt like cost without payoff: more commands, more IDs, more schemas, same mental model. Substrate became backend truth nobody trusted because nobody could see chains, plans, collisions, or lineage as first-class runtime objects.

### The Underlying Assumption

Designer assumed runtime entities become operationally real when modeled in database, not when operators can inspect, compare, and navigate them during work.

### Early Warning Signs

- By end of Stage 4, fewer than 30% of active operator status checks use `sb container ps`, `sb container show`, or equivalent substrate-native views; most still use `sp feed`, `bd show`, chat notes, or git status.
- Collision matrix has live rows for more than one week, but no daily operator decision cites collision output as reason for retargeting, pausing, or splitting work.