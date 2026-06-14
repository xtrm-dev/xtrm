## Phase 1 - Initial Analysis

Substrate fails because adoption depends on one late Big Bang migration. Stage 13 carries production truth: active issues, claims, memories, deps, worktrees, close semantics. Earlier stages produce architecture, not workflow replacement.

Core trap: no coexistence shim. Operators must choose bd or substrate. They choose bd because xtrm cannot pause.

## Phase 2 - Devil's Advocate

Maybe clean cutover preserves simplicity. Shim can become permanent, duplicative, buggy. True.

But migration at stage 13 means substrate learns bd reality last. Missing behaviors surface after months sunk. Clean cutover removes rollback path and user feedback loop.

## Phase 3 - Synthesis

Failure not caused by SQLite, containers, or daemon. Failure caused by sequencing adoption after infrastructure. Runtime entities stay unreal because no live workflow depends on them before cutover.

Better path would make substrate shadow bd first, then own one narrow production loop, then expand. No shim means no gradual truth transfer.

## Final Answer

### The Failure Story

June went into stage 0: `xt daemon`, `state.db`, Unix socket, package boundaries. By July, stage 1 and stage 2 existed on paper and in tests: issue classifiers, Stage-1 validation, channels v0. But every real xtrm issue still lived in bd because claims, dependencies, memories, and close flow already worked there. Operators opened work in bd, then sometimes mirrored demos into substrate.

August shipped chain-only containers and lifecycle states. `sb container ps chain:X` finally showed something, but it did not control real work because bd-managed worktrees and Stop-hook claim machinery still decided who owned tasks. September added seed plans and file collision matrix, but collisions were still resolved in daily bd/GitHub practice because substrate did not know enough about bd dependency edges or active leases to be authoritative.

October and November exposed real cost. Console rendered substrate state, not production truth. Stage 13 migration drills failed one bd feature at time: `bd kv`, FTS5 memories, dependency graph quirks, batched closes with memory-ack, worktree ownership, claim release on Stop hooks. Because design rejected coexistence shim, each gap blocked cutover instead of becoming one bridged edge. By December, substrate was live only as parallel demo. Daily workflow stayed in bd. Runtime entities never became real because nobody could risk making them source of truth.

### The Underlying Assumption

Designer assumed bd was data to migrate, not production behavior to preserve while substrate earned authority.

### Early Warning Signs

- Stage 4 or later demos require manual copying from bd into substrate for claims, dependencies, worktrees, or memories.
- Any cutover checklist contains “pause xtrm work,” “freeze bd,” or more than one unsupported bd feature needed for daily close/claim flow.