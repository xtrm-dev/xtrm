## Phase 1 — Initial Analysis

Chain coordinator failed because one name hid multiple products: reducer, judge, supervisor. `coordinator_model: null` changed semantics, not cost setting. Borderline evidence needed judgment, so no-LLM mode failed where value mattered. LLM mode worked better, cost exploded. Off mode became default.

## Phase 2 — Devil's Advocate

Maybe coordinator could survive if scoped to high-risk chains only. Maybe deterministic reducer handles normal chains, LLM handles exceptions. But design promised one always-on entity across many chains per day. That promise forced cost path into hot path, then operators rejected whole abstraction.

## Phase 3 — Synthesis

Core flaw: capability bundle too dense. Fresh-context spawning, kill+respawn, journal gap detection, release atomicity, pulse hygiene, memory distillation, and judgment should not ship as one runtime shape. Split abstraction: deterministic chain monitor first; optional adjudicator later; memory closeout separate.

## Phase 4 — Final Refined Output

Recommendation: demote chain coordinator from container judge to auditable reducer. Make LLM adjudication explicit, metered, opt-in per disputed transition. Never hide semantic change behind `coordinator_model: null`.

## Final Answer

### The Failure Story

June–July went into stage 0 and stage 4 plumbing: daemon, socket, chain container lifecycle, journal events, `coordinator.release`, respawn hooks. §4.3 kept changing because every bug looked like missing coordinator behavior: fresh-context spawn for drift, gap detection for crashes, pulse hygiene for cross-chain leaks, memory distillation at close. By August, chain coordinator existed, but only as two half-working paths: `coordinator_model: null` reducer that could replay events, and LLM judge that could interpret messy evidence.

September dogfood exposed break point. No-LLM reducer passed clean chains but failed borderline cases: partial test logs, ambiguous collision warnings, missing release evidence, specialists claiming “done” with dirty worktrees. Those were exact moments coordinator was supposed to decide. Operators stopped trusting ready/closed transitions unless LLM mode reviewed them. Cost jumped from near-zero to per-chain spend across many chains per day, plus latency from fresh-context spawning and two-compaction context rebuilds.

October–November produced third runtime shape: coordinator off. Teams first disabled LLM mode for low-value chains, then disabled coordinator entirely after respawn bugs and false release blocks made it slower than tribal review. By December, “chain coordinator” meant cheap-no-judgment, expensive-with-judgment, or off, depending on operator mood. Console state became less trustworthy because lifecycle transitions no longer meant same thing across chains. Runtime entity never became production truth.

### The Underlying Assumption

Designer assumed one coordinator abstraction could switch between deterministic reduction and semantic judgment without changing product semantics.

### Early Warning Signs

- Dogfood metric: percentage of `coordinator_model: null` chains needing manual override for `ready → closed` or disputed `coordinator.release`; anything above 10% means reducer is not coordinator.
- Cost/latency metric: median coordinator tokens and wall time per chain rising faster than specialist work time, especially on borderline evidence chains.