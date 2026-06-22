# Premortem: substrate_design_it.md (Bozza rev. 12)

> Frame: it is **December 2026**. Substrate has failed. The 5-package monorepo
> (`core`/`substrate`/`channels`/`specialists`/`console`) exists. The daemon
> runs. Operators are still using `bd` + `sp` + GitHub for daily work.
> Why?

---

## The single underlying assumption

> Architecture coherence in one designer's head will transfer to other operators
> through schemas, stage gates, and clean cutover — and that this will deliver
> operator relief faster than shipping targeted patches against the existing
> `bd`+`sp` stack while substrate is being built in private.

Every one of the 9 failure stories below is a special case of this assumption.

---

## The 9 reasons it could fail

Each was deep-dived by an independent `overthinker` (gpt-5.5) run; raw outputs in
`out-01.md` through `out-09.md`.

### 1. Stage 0 is not a stage — it's the hardest product in the system
*(out-07)*

Stage 0 ships **daemon + IPC protocol + SQLite migrations + identity/transactions
+ restart-stable session + cross-package schema registry + emitter idempotency**.
That's not foundation — that's the kernel. Every later stage waits on it. There
is no kill switch, no degraded mode, no coexistence shim. Stage 0 either takes
8+ weeks or ships unsound and leaks races into every container.

Either way, the calendar burns before stage 4 can show an operator anything.

### 2. Design drift outran implementation
*(out-01)*

Rev 12 calls itself converged but the same pattern that produced rev 1→12 is
still wired in: implementation surprise → new doc section → new runtime concept
→ "convergence". There is no freeze rule. Each edge case becomes design input
instead of a merged PR. The doc has prestige; bugs become evidence the doc
needs one more section. Runtime never hardens.

### 3. The clean cutover never cuts
*(out-08)*

Stage 13 is the only path to production truth (claims, deps, memories, close
semantics). There is **no coexistence shim** — operators must choose `bd` or
substrate. They will choose `bd` because work cannot pause. Substrate then
learns `bd`'s real behavior **at the migration** (`bd kv`, FTS5 quirks, dep-graph
edges, Stop-hook claim release, memory-ack batch closes) — exactly when there
is no rollback. Each gap blocks cutover instead of becoming one bridged edge.

### 4. Total rebuild instead of five targeted fixes
*(out-09)*

The five real pains (claim weakness, chain implicitness, late collision discovery,
weak memory recall, unstructured `bd create`) get bundled behind daemon + store +
socket + packages + SDK + console. The first useful operator fix arrives at
stage 7 — **after** the existing pain has continued for six months. Five narrow
patches against `bd`+`sp` would have shipped relief inside stage 0's calendar
window without delaying a single line of substrate plumbing.

### 5. The node-coordinator is a load-bearing fiction
*(out-02)*

`participant_id`, `job_id`, `can_open_containers`, `autonomy_json`, pulse
emitter, capability model, SDK — all assume an autonomous reader. **No stage in
the 13-stage plan gives the node-coordinator its own delivery gate.** It is
"future semantic layer." Without one process that reads a pulse, evaluates
`autonomy_json`, opens a child container, journals, survives restart, and
respects denial — the SDK is wrappers, the pulse emitter is logging, the
capability model is dead schema. Architecture sells autonomy and ships
bureaucracy.

### 6. The chain coordinator is over-specified
*(out-05)*

One name hides three products: **reducer, judge, supervisor**. `coordinator_model:
null` is not a cost setting — it's a semantics change. The no-LLM reducer
passes clean chains and fails exactly where the coordinator was supposed to add
value (borderline evidence). LLM mode works but costs blow up at substrate's
chain volume. The runtime shape ends up as three modes:
cheap-no-judgment / expensive-with-judgment / off. By December most operators
have chosen off.
> **Correction (2026-06-13, post-cross-doc-audit).** This reason was a false positive — driven by reading substrate §4.3 in isolation without channels §8/§10/§15. The coordinator's LLM cost isn't "always-on judge reading everything"; it wakes only on subscribed kinds, decides, writes one event, sleeps. `coordinator_model: null` is the explicit no-LLM mode, not a semantics-change-masquerading-as-cost-flag. R6 reclassified ADDRESSED. The user's reading — "with selective channel reads, the coordinator can take on more judgment than this admits without runaway cost" — was correct. See `audit-result.md` §6 (revised verdict) and the Corrections section at the bottom of this file. Related follow-up: `xtrm-1jp` (runtime incident handler as 5th coordinator role).


### 7. The two-tier story has no v0 for the top tier
*(out-06)*


"No FK cross-domain, 1:1 row transfer, trivial projection." Trivial hides
**identity stability across machines, reader-side lineage reconstruction from
opaque IDs across the network, conflict handling on team-level writes, evidence
ref resolution when the referenced file lives on a different laptop, and
write-coalescing for high-volume `xtrm_forensic_events`**. None of these has a
v0. The bottom tier ships solo-user. The top tier never starts. The
team/company adoption story — which justified building five packages instead of
one — quietly dies.

### 8. Console deferred — substrate ships invisible
*(out-03)*

§16 says runtime models the entities; dashboard reveals them. §14 defers the
dashboard, lineage drawer, and AWS-agentcore observability to downstream
`gitboard` work. Stage 12 of the plan merges `sp feed -f` + `sb feed -f` — a
stream fusion, not an entity-aware dashboard. By December, chains exist in
SQLite with stable IDs, the collision matrix is populated, plan artifacts are
stored — and **operators have no UI for any of it**. They keep reading `sp
feed` and `bd show`. Substrate is backend truth nobody can see.

### 9. Author = implementer, no second eyes
*(out-04)*

The doc carries absorbed operator-notes, closed round-3 audits triaged by the
author, and an unanswered "questions for next agent" §14.1. The dialogue
throughout reads as a single mind in conversation with itself. The vocabulary
(`seed`/`chain`/`wave`/`node`/`participant`/`job`/`tether`/`memory capability`)
fits the author's mental model perfectly — which is exactly why nobody else can
operate it on first contact. **Clean cutover then removes the familiar escape
hatch (`bd`+`sp`+GitHub) before the new mental model has been transferred to
anyone outside the author's head.**

---

## Cross-cutting patterns (the synthesis)

Reading the 9 deep-dives side by side, four meta-pathologies emerge that no
single reason captures:

### A. The "deferral compound"
Every individual cure is deferred to "later": coexistence shim deferred, console
deferred, top-tier deferred, node-coordinator demo deferred, external reviewers
deferred. Each deferral is defensible alone. Stacked, they guarantee that
**no operator-perceptible value lands before stage 7 at the earliest**, and the
calendar runs out before that.

### B. Invisible + irreversible + unfamiliar
Reason 8 (invisible), reason 3 (irreversible — no shim), and reason 9
(unfamiliar — author-shaped vocabulary) **multiply**. An operator who can't
see substrate, can't fall back to `bd`, and can't intuit the model has zero
reasons to switch. Each pathology amplifies the others. Fixing one is not
enough.

### C. Three abstractions are bundles, not entities
Node-coordinator (#5), chain coordinator (#6), and two-tier projection (#7)
share one shape: **one name hides multiple products with different
semantics, cost curves, and UX**. The system cannot ship any one of them
coherently because each needs different stage acceptance criteria than the
plan provides.

### D. Stage acceptance ≠ operator adoption
Even when each stage technically ships (chain container exists, validator
passes, collisions recorded), no operator decision cites substrate output as
authority. Runtime entities exist but are operationally dead. The 13-stage
acceptance criteria measure plumbing, not adoption.

---

## Plan revisions

These are the deltas that would change the December 2026 outcome. Ordered by
leverage (highest first).

| # | Revision | Replaces |
|---|---|---|
| 1 | **Coexistence shim from day 1.** Substrate reads `bd` state first; then shadows; then owns one narrow production loop; then expands. No stage 13 Big Bang. | Reason 3, partially 9 |
| 2 | **Five narrow operator-facing patches inside stage 0.** `sb chain ps`, claim-time validator hook, active-worktree collision watcher, embedding recall on `bd_memories`, `bd create` JSON schema. Each ships against the existing stack while plumbing is built. | Reason 4, partially 1 |
| 3 | **Top-tier v0 is a stage 0 acceptance criterion.** Two laptops, one shared project, one chain, one seed plan, one approval, one comment, one evidence ref, one collision event, Supabase reader reconstructs lineage. Not optional. | Reason 7 |
| 4 | **No new stages until §14.1 is answered by a non-author.** Force an external operator to classify 10 real issues to ≥80% agreement against author labels before stage 5 closes. | Reason 9, partially 2 |
| 5 | **Stage-gate console against entities.** No stage 7 collision matrix without `sb container ps`, `sb chain show`, and a lineage drawer that an operator uses for >30% of status checks. | Reason 8 |
| 6 | ~~**Demote the chain coordinator** to auditable reducer. LLM adjudication explicit, metered, opt-in per disputed transition. Never hide semantic change behind `coordinator_model: null`.~~ **Withdrawn 2026-06-13** — see Corrections. Replacement guidance: keep four coordinator roles as specified in §4.3; rely on channels §8/§10/§15 kind-subscription as the cost ceiling. Open follow-up: add a 5th role (runtime incident handler) per `xtrm-1jp`. | ~~Reason 6~~ (withdrawn) |
| 7 | **One executable node-coordinator demo by stage 4.** Long-running coordinator reads pulse → evaluates `autonomy_json` → opens child container → journals → survives restart → respects denial. If absent, freeze SDK/capability/identity surface. | Reason 5 |
| 8 | **Hard freeze rule on the design doc.** After rev 12: no new architecture absorbs without a merged-PR receipt for the prior section's runtime acceptance. | Reason 2 |
| 9 | **Cut stage 0 scope** to smallest append-only local event log + one write API + one read API + restart recovery + identity stability. Schema registry, multi-domain transaction semantics, pulse idempotency, migration locks → push past first chain-container demo. | Reason 1 |

---

## Early warning signs (to watch in June–September 2026)

- Stage 0 consumes more than **4 calendar weeks** before first real chain
  container can be opened, advanced through lifecycle, killed, restarted, and
  recovered.
- **Revision velocity > shipped-runtime velocity:** two or more new doc sections
  land while daemon + issue validator + chain container remain unused in
  daily work.
- More than **30% of stage 1–4 implementation notes** mention daemon workarounds
  ("retry", "restart required", "migration lock", "socket version", "orphan
  job", "race", "idempotency gap").
- No passing **two-laptop Supabase demo** by end of stage 0.
- No non-author dry-run achieves **≥80% issue classification agreement** with
  the author by stage 4.
- §14.1 "questions for next agent" still unanswered while new stages ship.
- **<30% of operator status checks** use `sb container ps` / `sb container
  show` by end of stage 4; most still use `sp feed`, `bd show`, chat notes.
- Collision matrix has live rows for >1 week but **no daily operator decision
  cites collision output** as reason for retargeting or splitting work.
- Any cutover checklist contains "pause xtrm work", "freeze `bd`", or more than
  one unsupported `bd` feature needed for daily close/claim.
- `coordinator_model: null` chains need **>10% manual override** for `ready →
  closed` or disputed `coordinator.release`.
- Median coordinator tokens/wall-time per chain rising faster than specialist
  work time, especially on borderline-evidence chains.
- Stage 4 ships without one executable demo of node-coordinator reading a pulse
  and opening a child container.
- By end of June, no production command exists for **at least one** of the five
  narrow fixes (`sb chain ps`, claim validator hook, active-worktree collision
  watcher, embedding recall on memories, `bd create` JSON schema).

---

## Corrections (post-cross-doc-audit, 2026-06-13)

The cross-doc audit (`audit-result.md`) reconciled the 9 premortem reasons against the wider xtrm vault. One verdict from the audit was itself revised after re-reading substrate §4.3 in full plus channels §8/§10/§11/§15.

### R6 — Chain coordinator over-specified: **WITHDRAWN**

Original framing ("one name hides three products: reducer, judge, supervisor; `coordinator_model: null` is semantics-change-masquerading-as-cost-flag") was a false positive driven by reading substrate §4.3 in isolation. With channels' selective-subscription model on the table, the cost concern dissolves:

- Coordinator subscribes to `work.verdict`, `work.proposal`, `control.escalation`, `system.*`, `coordinator.release` precursors — **not** `work.turn` token streams (channels §8).
- `readSince` is observation-only; `markSeen` only fires when the coordinator decided (channels §10).
- §15 attention rungs cap participant-driven wakeups at 2 attention + 1 self-activation per epoch.
- Reducer pure + after-hook idempotency (channels §11) keep the high-volume mechanical work out of the LLM path.
- `coordinator_model: null` waives the LLM entirely for `code-quick` — explicit no-LLM mode, not a semantics dodge.
- §3.1 invariant ("due layer di giudizio sempre presenti") is the safety net.

The dual framing (entity always exists; model may be null) is by design. Plan revisions row 6 was withdrawn (see strikethrough above).

### Updated top-3 still-real risks (replaces audit roll-up)

With R6 dropped:

1. **Canon drift** — `xtrm-MOC.md` stale vs shipped forensic/code reality.
2. **Migration gates (R3)** — bridge retirement criteria still underspecified.
3. **Independent reviewer (R9)** — deliberation docs ≠ second-eyes.

### New follow-up surfaced post-audit: `xtrm-1jp`

While correcting R6, a real gap surfaced that neither the premortem nor the audit caught: substrate §4.3 enumerates 4 coordinator roles but none of them is runtime incident handler. Today, mechanical mid-run failures (executor died, gate unresponsive, worktree diverged, evidence ref broken, pulse delivery failed N times) fall through to the orchestrator, which owns vision rather than intra-chain mechanics. Filed as `xtrm-1jp`:

- Add 5th coordinator role: **incident handler** — reducer detects mechanical failure, attempts deterministic recovery, escalates to coordinator via `chain.incident.*` when recovery exhausts or failure is judgment-shaped.
- Add `runtime.*` failure-kind vocabulary to channels §7 (`runtime.participant_died`, `runtime.gate_unresponsive`, `runtime.worktree_diverged`, `runtime.evidence_ref_broken`, `runtime.pulse_delivery_failed`, `runtime.budget_exhausted_mid_step`, `runtime.recursion_cap`).
- Add §3.1 invariant: **a chain never fails by runtime fallthrough — `closed:failed` is always a coordinator verdict.** Substrate-level kernel disasters (state.db unwritable) terminate at a different layer (`substrate.unavailable`).
- Constraint: detection in reducer (pure), wake intent in after-hook with idempotency key, per channels §11.

---

## Full disposition (2026-06-13, end of session)

All 9 premortem reasons folded into substrate canon. Final mapping:

| Reason | Disposition | Site |
|---|---|---|
| §1 Stage 0 = kernel | folded as owned-by link | substrate §15 Stage 0 row → [[state-store-options]] + [[monorepo-migration]] + [[devops-system]] |
| §2 Design drift | folded as freeze rule (R2 gate) | substrate top-of-doc revision protocol — no new section without merged-PR runtime receipt |
| §3 Migration gates | folded as §13.8 | bridge whitelist + retirement criteria + per-Stage rollback + MOC update trigger |
| §4 Total rebuild | already addressed in canon | devops-system + temp_roadmap |
| §5 Node-coordinator | folded as §4.2 expansion | responsibilities/non-responsibilities table + failure_budget + scheduling authority limits + Stage 4.5 delivery gate |
| §6 Chain coordinator | corrected ADDRESSED + xtrm-1jp landed | §4.3 5th role + channels §7 runtime.* + §3.1 invariant |
| §7 Forensic / two-tier | folded as MOC fix + §2.8 owned-by | MOC reflects shipped reality; substrate §2.8 → [[forensic-event-contract]] |
| §8 Console | folded as §12 owned-by | substrate §12 → [[console-product-contract]] + [[specialists-console-handoff]] |
| §9 Author = implementer | folded as reviewer gate (R9 gate) | substrate top-of-doc revision protocol — independent reviewer + verdict-as-evidence required for rev-13+ |

**Plan revisions table — operational items still pending (not substrate-shaped):**

- Row 2 (5 narrow operator-facing patches inside stage 0) — owned by [[monorepo-migration]] / [[temp_roadmap]]
- Row 3 (top-tier v0 as Stage 0 acceptance criterion) — owned by [[monorepo-migration]]
- Row 5 (stage-gate console against entities) — owned by [[console-product-contract]]
- Row 9 (cut stage 0 scope) — owned by [[state-store-options]] / [[monorepo-migration]]

These are sequencing/operational decisions, not design-doc patches; substrate has now done what substrate can do, the rest belongs to the docs that own those decisions per the owned-by links landed today.

**Files patched this session:** `xtrm-MOC.md`, `substrate/substrate_design_it.md`, `channels/channels_plain_it.md`, `premortem-substrate/audit-result.md`, `premortem-substrate/synthesis.md`. Bead filed: `xtrm-1jp`.
