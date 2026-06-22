## Phase 1 - Initial Analysis

Failure center: top tier called “optional,” but adoption story depends on it. Local SQLite daemon can ship. Team/company substrate cannot.

Cost mismatch: five packages, participant SDK, opaque IDs, channels, event layer, console feed all shaped for multi-actor runtime. No v0 validates projection, identity, lineage, comments, approvals, evidence refs, event volume.

## Phase 2 - Devil's Advocate

Maybe solo-user v0 still valuable. But plan sells replacement for tribal team orchestration. Solo-only runtime becomes heavier bd/sp replacement.

“No FK cross-domain” helps row copy. It does not solve meaning copy. Reader must rebuild lineage from opaque IDs across machines. Evidence refs break when source file lives elsewhere. Team writes create conflicts despite “read-mostly.”

## Phase 3 - Synthesis

Root failure: top tier treated as deployment detail, not product slice. Projection must be tested as early architecture path, not post-stage-13 add-on.

Fix path: define top-tier v0 before stage 1–4 harden schemas. Minimal slice: two laptops, one shared project, one chain, one seed plan, one approval, one comment, one evidence ref, one collision event, Supabase reader reconstructs lineage correctly.

## Final Answer

### The Failure Story

June–August 2026: stage 0 consumed 10 weeks instead of 3. `xt daemon`, `state.db`, Unix socket clients, idempotency keys, and package boundaries got stable enough for solo use, but every decision assumed “top tier later.” No Supabase schema existed beyond “1:1 row transfer.” `participant_id` stayed locally derived, evidence refs pointed at local paths, and `xtrm_forensic_events` volume was never projected across machines.

September–October: stages 1–4 shipped issue schema, validators, channels v0, tether v0, and chain containers. Solo demos looked real. First team trial failed fast: two laptops opened same project and produced different participant identities, approvals could not round-trip cleanly, lineage drawer had no network-resolvable graph, and comments/optimization decisions had no conflict model. “No FK cross-domain” made inserts easy but made reader-side reconstruction brittle; opaque IDs crossed network without enough resolver context.

November–December: stages 5–7 tried to add seed plans and file-level collision matrix, but team projection blocked everything. Evidence refs pointed to files on somebody else’s worktree. High-volume forensic events overloaded naive row sync. Top-tier work became new architecture project, not v0 feature. Bottom tier shipped as solo-user runtime. Team/company adoption died quietly, leaving five-package complexity built for audience never reached.

### The Underlying Assumption

Designer assumed local-first entities would become team/company entities by projection, without treating projection semantics as core runtime design.

### Early Warning Signs

- No passing two-laptop Supabase demo by end of stage 0: same project, stable `participant_id`, one approval/comment, one evidence ref, lineage reconstructed from top tier.
- Top-tier notes still use words like “trivial,” “later,” or “1:1 row transfer” without schemas for conflict writes, evidence resolution, event coalescing, and identity derivation.