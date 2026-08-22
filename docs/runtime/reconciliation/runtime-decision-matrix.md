# Runtime Decision Matrix

> Status: CANONICAL reconciliation artifact (coordinator-owned).
> Generated: 2026-08-22 · Bead `xtrm-cn8`
> Evidence shorthand: **A**=lane-a programme audit · **B**=lane-b specialists canon · **C**=lane-c chain authoring · **D**=lane-d harness/experiments · **E**=lane-e channels · **F**=lane-f substrate · **G**=lane-g xtmux · **H**=lane-h core · **I**=lane-i observability/eval · **P**=`native-chain-runtime-audit-2026-08-19` packet (PRD draft / decision matrix D-xx / register C-xx) · **PLAN**=`xtrm-current-execution-plan` · **REC**=v1 reconciliation amendment · **LEDGER**=v1 completion ledger.

System invariant adopted throughout: **Pi owns the model session. XTRM owns what that session means inside a governed workflow.** Verified against D (bridge.ts hosts AgentSession directly), G (xtmux records but does not host direct sessions), P §2/§8.

---

**Q1. ChainTemplate vs ChainSource/ChainDefinition.**
Old: PLAN C1 knows only Template→ResolvedChain (`specialists.resolved-chain.v1`). Current: P PRD §3 defines ChainSource with four variants (Template/JSON/AdHoc/Imported); formulas verified as one legacy materialization format (C). Disposition: **generalize** — template is a ChainSource variant and promoted default, not the ontology. Owner: runtime PRD §concept + ADR-001. Consequence: C1 workstreams restated as ChainLoader→ChainDefinition→compiler→ResolvedChain. Rejected: keeping template-as-ontology (breaks user JSON path, Q24).

**Q2. Draft concept vs direct ChainDefinition editing.**
Old: PLAN C1.4 manual composition CLI (review/insert/approve/show). Evidence: H issuetracking validator-verdict model ≈ freeze gate; substrate resolved_chain_json = completeness contract (F). Disposition: **ChainDefinition is a persisted, versioned authored artifact reviewed before freeze; no free mutation after ResolvedChain** (structural change = new revision, P PRD §3). Owner: ADR-001.

**Q3. ResolvedChain semantics.**
Old: PLAN persisted compiler output schema only. Current: approved immutable compiler output; children cannot mutate approved topology (A §9.16; C §7.8). Disposition: adopt P model verbatim. Owner: ADR-001/ADR-002 boundary.

**Q4. ChainRun/Container semantics.**
Old: REC Container/execution identity envelope. Current: P D-04/D-05 ACCEPT — no separate ChainProgram entity; Container(kind=chain) generic envelope + ChainRun chain-specific progression, 1:1 binding, single terminal authority, whole-container cleanup incl. borrowed-session release-not-kill. Owner: ADR-002.

**Q5. Beads materialization timing.**
Old/C: today nothing persists between resolution and `bd pour`; planner mutates Beads graph directly (H). Target: materialize only after ResolvedChain freeze; Beads projection is derived, never the ontology (PLAN line 429 anti-second-graph rule preserved). Owner: ADR-001 §materialization.

**Q6. Beads authority boundaries.**
Old: bd 1.2.1 native parent+blocks memory; REC external_root_bead_ref opaque. Disposition: Beads = authoritative work/acceptance/durable external projection; root Epic native parent; step beads children; blocks edges between steps only; never cross-DB queried. Owner: runtime PRD §beads.

**Q7. Pi AgentSession direct hosting.**
Old conflict: PLAN §8.4 neutral retain-or-adopt gate vs P D-09 "native preferred". Evidence: SRE vertical slice proved direct hosting, custom tools, parallel reducer dispatch, crash/resume on real infra (D; bd memory chain-vertical-slice). Disposition: **native AgentSession = product target; corrected RPC demoted to compatibility/migration/rollback/headless transport**. Gate becomes production-parity/hardening evidence, not architecture coin-flip. Owner: ADR-003. Consequence: R1.6/GATE-HARNESS-ADR reframed in plan (W5).

**Q8. RPC compatibility/rollback role.**
Old: Pi v0.84.1 atomic remediation first (REC Phase 1; SP-PI-01). Disposition: remediation remains valid as compatibility transport + rollback path; not the product runtime. Owner: ADR-003 §compatibility.

**Q9. SpecialistDefinition vs SpecialistActivationProfile.**
Old: specialist definition conflated with invocation config. Current: P C-06; loader fingerprints definitions (SHA-256 source + per-skill hashes, fail-closed drift, D). Disposition: Definition = role/cognition contract; ActivationProfile = per-step runtime profile (model, timeout, retry, capability policy). Owner: ADR-004.

**Q10. requested capabilities vs ResolvedCapabilityGrant.**
Old: `required_tools` risked exposing generic Pi built-ins. Current: bridge uses `noTools:"builtin"` + explicit tool allowlist (D §4). Disposition: request ≠ grant; grant = f(request, chain/step policy, operator policy, runtime sandbox). No arbitrary pre-script authority. Owner: ADR-004.

**Q11. skills vs probes vs deterministic effects.**
Old: overloaded `skills.scripts`. Disposition: taxonomy cognition(skills/prompt/procedures) / activation-policy / prepare(probes, validators, context resolvers) / result-contract / finalize(validators, projections, terminal effects); legacy scripts compile to typed ProbeDefinition for compatibility. Owner: ADR-004.

**Q12. PREPARE/FINALIZE ownership.**
Old: prompt/model discipline (B §6). Current: protocol design mandates runtime-owned phases; NOT yet present in experiment code (D: zero occurrences in pr71 src). Disposition: honest split documented — protocol = target; experiment evidence covers EXECUTE-path only. Owner: ADR-003/004; implementation milestone M-G/H/J.

**Q13. ActivationSupervisor.**
Dispositions from P §8 + G §3.1: supervises exactly one XTRM-owned direct participant activation (start/settlement/heartbeat/timeout/retry-signal/cancel/disposal); **never decides which chain node is next**. Owner: ADR-006.

**Q14. xtmux RuntimeSupervisor.**
Current: xtmux V2 already ships registry/receipts/waits/monitors/handoffs/turns/recovery (G §2, shipped-status verified). Disposition: evolve V2 via provider-adapter + terminal-backend seams; no second store; no workflow authority; direct AgentSessions do NOT route through xtmux (G explicit answer). tmux = optional operational/UI backend. Owner: ADR-006.

**Q15. ChainReducer/Scheduler ownership.**
Old: Specialists Supervisor mixed concerns (P C-08 decomposition). Disposition: pure reducer + SchedulerIntents + effect executor owns workflow progression; supervisor decomposition lands in participant runtime. Owner: ADR-002/006.

**Q16. Channels delivery/authority semantics.**
Canon: channels.md (E). Invariants: routing hard / attention soft / authority hard; read≠ack; delivered≠processed; body≠authority; scheduler indirection; single scheduler. Disposition: ADR-005 references canonical contract; absorb plain_it §7 delta into §5.3 first. Owner: channels.md + ADR-005.

**Q17. dynamic RLM children.**
Evidence: P §14.1; REC decisions list. Disposition: children may research/compute/critique within an approved step; may not mutate ResolvedChain, self-grant, create steps, bypass gates, decide acceptance, or become second scheduler; lineage records parent participant/activation + budget + grant + evidence. Owner: runtime PRD §rlm.

**Q18. pi-extensible-workflows disposition.**
Old: A1.4 gated integration. Current: reference design classification (P register L59). Disposition: bounded authoring/cognition/reference integration; never a second durable workflow execution authority. Banner added W5/W6. Owner: plan A1 note.

**Q19. memory promotion.**
Evidence: r6g tiers Archival→Recall→Core; promotion-tool-not-delete-tool; ADD-only retrieval-time conflict resolution; three lenses only; evidence-gated promotion (R1.8/GATE-AUTH). Disposition: document as design input; automatic writes prohibited before measured precision. Owner: runtime PRD §memory; V1 lane unchanged.

**Q20. Eval Core expansion.**
C-09: extend subjects, don't rebuild. All 16 new subject categories fit existing suite/case/experiment/trial/artifact/score entities (+2 additive trial columns). Disposition: eval-lane extension recorded in plan V1; grader categories listed in lane-i-eval-extension-map.json. Prometheus low-cardinality preserved. Owner: specialists PRD Workstream E + plan V1 note.

**Q21. Console read-model boundary.**
C-3: console-repo architecture set canonical post-host-retirement; xtrm copies → pointers. Boundary: UI reads DTOs; API reads materialized state, never advances cursors; missing_signal routing; parity-before-retirement (five named contracts). Owner: console repo docs + product contract.

**Q22. minimal early Substrate durability kernel.**
Conflict: LEDGER coarse DEFERRED vs P C-04 kernel-now. Disposition: carve out 8-item kernel candidate (F) into ADR-002 without gating on Stage-0 daemon/state-store. Ledger row annotated (W5).

**Q23. full Substrate migration deferral.**
Unchanged: deferred by explicit gate (LEDGER §3); premortem R2/R9 gates require runtime receipts + independent review before further architectural absorption. Not silently reintroduced. Owner: ledger + monorepo-migration annotations.

**Q24. user-authored JSON chain support.**
Disposition: JsonChainSource + AdHocChainSource (persisted, auditable before execution) enter the same ChainLoader/compiler as templates (P PRD §3/§6; C §5). Acceptance test: SRE chain becomes fully data-defined with zero SRE-specific runtime topology code (§18 of programme brief → next milestone section of runtime PRD).

**Q25. planner → ChainDefinition workflow.**
Path (C §5.5): xt spec apply change-contract → Pass-2 `recommended_template` annotation → ChainLoader/compile → persisted ResolvedChain → then materialize. Planning skill future direction updated in docs only (H). Owner: ADR-001 + core planning notes.

**Q26. template/formula compatibility.**
Canon precedence rule preserved: formula wins executable shape until substrate catalog lands; formulas remain supported ChainSource compatibility assets; 15 assets stay discoverable. Broken README pointer fixed to point at real canon (W4). Owner: chain_templates.md + README fix.

**Q27. SRE hard-coded experiment retirement.**
Experiment stays until evidence absorbed (retained_as_evidence rows). Retirement test: same behavior from data-defined chain through generic runtime, zero topology code. Documented as next milestone; not implemented here.

**Q28. runtime state persistence/recovery.**
Evidence: reducer derives from persisted evidence only; idempotency keys persisted pre-dispatch; crash/resume live-tested (attempts=2 only on killed step); reconciled-topology rerun explicitly scoped-out (honest UNVERIFIED, D). Disposition: ADR-002 requires effect receipts + journal + uncertain semantics before replay-equivalence claims.

**Q29. effect receipts/idempotency/uncertain state.**
From REC §6/D5-D7: admission-before-effect; completed keys return durable result; uncertain blocks blind replay; reconciliation records resolving evidence. Adopted wholesale into ADR-002.

**Q30. terminal/tmux optionality for native AgentSession.**
G verdict: headless session produces zero xtmux facts today (hooks exit outside $TMUX); tmux must not be correctness boundary for hosted activations; xtmux remains valuable for visibility/external runtimes/interactive sessions; Herdr-like backends enter as terminal backend behind ADR-006 adapters. Owner: ADR-006.

---

## Still-open questions (explicitly unresolved, non-blocking)

1. Canonical home of `runtime.*` failure-kind vocabulary (channels.md §5.3 vs substrate taxonomy) — E open q1.
2. Eval event naming convergence: 4 coarse vs 19 fine-grained (I C-4) — blocks V1.2 emitter work.
3. MCP emitter liveness claim (I C-1) — needs code check.
4. Forbidden-label single source membership (I C-6).
5. WP-id enforcement in Beads vs formal retirement of mapping duty (B §14.4).
6. Core planning-skill vendor drift root cause (H open q1).
7. agent.ready readiness handshake coverage across Pi/Claude (G open q2).
8. r6g operator answers (embedding budget, cross-repo hub timing) gate memory ship-order (I §9.6).
