## Phase 1 - Initial Analysis

Failure driver: single-mind architecture. Same author designs, audits, triages, implements, and validates substrate. No external user forced to understand model before implementation.

Core risk: runtime names become private language. `seed`, `chain`, `wave`, `node`, `participant`, `job`, `tether`, `memory capability` all fit author workflow, not shared workflow.

Likely collapse point: adoption, not daemon. SQLite, socket, lifecycle, validator can ship. Users still reject model because abstractions need author brain as decoder.

## Phase 2 - Devil's Advocate

Counterpoint: solo authors can ship coherent systems faster. Second eyes can slow design, dilute vision, bikeshed names.

But substrate is coordination architecture. Success requires multiple agents/operators understanding same runtime state. If only author can operate it, substrate fails stated purpose: replacing tribal practice.

Worst sign: doc already contains self-dialogue artifacts: absorbed notes, closed audits, unused “questions for next agent.” Process simulated review without real reviewer.

## Phase 3 - Synthesis

Technical implementation can succeed while product architecture fails. Substrate may reach stage 4 or 7, but runtime entities stay author-shaped. Clean cutover from `bd`/GitHub worsens failure because users lose familiar escape hatch before mental model proves transferable.

Fix direction: force non-author comprehension before more stages. External operator must run dry workflow from issue intake → chain → plan artifact → collision response without author explaining terms.

## Final Answer

### The Failure Story

June–July 2026, author finishes stage 0 daemon/state.db/socket and pushes stage 1 validator. Because same person wrote `substrate_design_it.md`, issue classifiers feel obvious: class/type/role maps cleanly to author habits. First real validation failures expose problem: future-self after `/compact` cannot tell whether work is `chain`, `wave`, or `node`, so issues get massaged until validator passes instead of becoming clearer.

August–September, chain container and seed planning land. CLI works for author: `sb container ps chain:X`, plan artifacts, lifecycle transitions, worktree leases. Second operator tries one task and stalls at vocabulary boundary. Seed sounds like planning, chain sounds like execution, wave sounds like batch, node sounds like autonomous agent, but boundaries overlap in actual monorepo work. Participant SDK requires implicit knowledge: when to spawn specialist vs script vs coordinator, what `participant_id` means, when `job_id` changes, what tether should carry.

October–December, clean cutover from `bd`/GitHub materializer removes old path before shared model exists. Collision matrix and channels produce more tables than confidence. Console is thin renderer, so it shows author-shaped state without teaching it. Runtime entities technically exist, but production use routes around them: operators write prose notes, ping author, or avoid substrate commands. Architecture replaces tribal practice with author tribe of one.

### The Underlying Assumption

Designer assumed internal coherence in author’s head would transfer to other operators through names, schemas, and docs without real second-seat use.

### Early Warning Signs

- Non-author dry-run cannot classify 10 real issues into container kind + class/type/role with ≥80% agreement against author labels.
- §14.1 “questions for next agent” remains unanswered by actual independent agent while stages continue shipping.