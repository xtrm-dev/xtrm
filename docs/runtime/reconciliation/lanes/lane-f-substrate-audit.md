# Lane F — Substrate durability audit

> Read-only reconciliation audit. Bead: `xtrm-cn8.2`. Companion outputs: `lane-f-minimal-kernel-candidate.json`, `lane-f-deferred-full-substrate.json`, `lane-f-source-register.json`.
> HEAD note: `/home/dawid/dev/xtrm` working tree @ `01a1b647298c` (brief cited `4f6ac48c4e0b`; discrepancy recorded).

## 1. Files read

Completely:
- `docs/substrate/substrate_design_en.md` (1880 lines, `07c698f0ed17`) — header-marked **STALE / NON canonico** (marcato 2026-06-01), rev10 content.
- `docs/substrate/substrate_design_it.md` (2105 lines, `51255cbed02d`) — **CANON**, rev12, round-3 audit closed (`unitAI-bgyp0`), plus 2026-06-13 premortem R2/R5/R9/R3 folds.
- `docs/state-store-options.md` (284 lines) — kernel/store decision doc; §9 decision log + §10 inbound-reference surface and Stage 0 rollback predicate (2026-06-13).
- `docs/premortem-substrate/_context.md`, `audit-brief.md`, `audit-result.md`, `synthesis.md` — premortem frame, cross-doc audit brief, verdicts, synthesis with full disposition table.
- specialists `docs/design/roadmap/history/handoff-from-substrate-design.md` (86 lines), `docs/design/roadmap/history/substrate-reconciliation.md` (104 lines) — history/context artifacts.

Sampled to confirm generated (not read fully):
- `premortem-substrate/out-01.md`, `reason-05.md`, `audit-dispatch.log` — confirmed raw fan-out outputs of an overthinker run (per-reason deep dives, dispatch log). All `out-*`, `reason-*`, `prompt-*`, `err-*`, `all-outputs.txt`, `report.html` classified generated without full reads. Lane B owns WP extraction from these docs' roadmap content; this lane extracts only Substrate-specific unique requirements (below).

Structural compare EN↔IT before full read: IT is canonical and strictly ahead of EN. EN carries a stale banner; EN lacks every post-rev10 addition (see §3). EN disposition: archive or re-align; no unique current content found in EN that IT lacks — EN's only distinct value is being the English rendering, which the handoff doc says is deliberately maintained ("Italian conversation for deliberation, English canonical documents as source of truth" — note: handoff predates the 2026-06-01 flip where IT became canon).

## 2. Determinations from the canonical document (substrate_design_it.md)

| Area | Determination | Anchor |
|---|---|---|
| Chain-template relationship | Chains advance template-driven, executed by substrate, observed by orchestrator; resolved shape is persisted container state (`resolved_chain_json`) = completeness contract; two layers (domain steps + mandatory gates); catalog semantics owned by `chain_templates.md` canon, primitive shape by substrate | §6.9–§6.9.10, :1235 |
| Lineage/provenance | Three axes on containers: membership (`parent_id`), provenance (`opened_by` immutable chain to root), ownership (`owned_by` mutable); 5-layer identity (L1 kind / L2 role label-safe; L3 participant_id stable per (scope,role); L4 job_id activation; L5 turn/tool/event); lineage reader-composed via opaque IDs, no cross-domain FK | §2.6–§2.8, §13.1 |
| Container lifecycle | Abstract lifecycle open→working→converging→ready→closed (+escalated) specialized per kind; five kinds seed/chain/epic/wave transient + node standing; close is derivation (`close_ready`→`ready`→merge), never imperative | §3, §4, §6.10 |
| Issue/step model | Root=change contract, step=step contract (mandate/inputs/outputs), XML serialization; three classifiers class/type/role independent axes; nine relationships with only blocks/parent-child/until gating; work_state incl. rev12 `idle` (materialized-not-dispatched) | §6.1–§6.7, §6.9.5 |
| Memory | Facts+metadata; herd/workgroup/identity are queries not fields; access is capability not role (curator eliminated); distillation at close by coordinator; retention per-query | §10.1–§10.3 |
| Capability/skill model | One capability model across emitter autonomy / node policy / container `can_open_containers` / chain-coordinator `can_emit`; skills are injected per-step capability packs (§10.4), not participants | §2.3, §5.8, §10.4 |
| Pulse/emitter | Signal layer trigger/job/message with idempotency-key dedup (`pulse_dedup`); daemon does mechanical scheduling only, coordinator semantic; specialist lifecycle itself is pulses; node clusters = named pattern over pulse mesh, queryable not constructable | §2.3, §5.8, §4.5 |
| Coordinator | Node coordinator: stateless w.r.t. node, kill+respawn via journal with gap detection, explicit responsibilities/non-responsibilities table + failure budget + scheduling authority limits (R5). Chain coordinator: entity always spawned, model may be null; five roles — entry gate (`verdict: ready` gates step-1), borderline judge, hygiene-by-pulse, close-time judge (atomic `coordinator.release` evidence gate), incident handler (R/xtrm-1jp): mechanical failure → deterministic recovery → `chain.incident.*` wake; `closed:failed` always a coordinator verdict | §4.2, §4.3, §3.1 invariant |
| Replay/recovery | Event-driven on persisted evidence only (never wall-clock tick, never live-stream text); reducer pure / after-hook idempotent; failure classes transient (= pi auto_retry envelope) vs semantic (non-progress counters semantic_after reviewer-cycles + hard_cap); never destroy work on failure; evidence preservation on closed:failed; journal checkpoint cadence | §3.1, §5.9, §5.10, §6.10.3 |
| State-store assumptions | One SQLite(WAL) `state.db` + one daemon + one Unix socket, owned by `packages/core` (`xt daemon`); all domain packages are socket clients; domain schema ownership per package; decisions kernel-owned by `state-store-options.md` (incl. §10.2 backup/integrity-check rollback predicate, §10.3 keeper bridge class) | §13, §15 Stage 0 row |
| Work graph/projection | Substrate owns durable work graph edges + projection assembly (join of stream+edges+issue+runtime); channels own the stream; truth-is-stream/projection-is-cache | via channels.md §5.8–§5.9; substrate consumes |

## 3. EN↔IT delta (why IT is canon and EN is not)

IT rev12 contains, and EN rev10 lacks: top-of-doc revision protocol (R2 freeze rule requiring merged-PR runtime receipts for new architectural sections; R9 independent-reviewer gate with forensic `design.review` evidence required for rev13+) ; §2.7 five-layer identity model; §2.8 telemetry/traceability fabric with owned-by links; §4.2 node responsibilities/non-responsibilities + failure budget + scheduling limits + Stage 4.5 delivery demo; §4.3 fifth coordinator role (incident handler) + `coordinator_model: null` = always-spawned no-LLM entity + within-chain kill+respawn journal; §4.5 node clusters; scrutiny reformulated as chain-structure dial with `none` tier and hard-deny on code scope; `seconder` fused dual-verdict gate replacing code-sanity phase split; work-state `idle` + lazy per-step dispatch framing; templates `code-with-tests` + `test-only` + ambidextrous roles (eight archetypes, fifteen bd formulas); multi-writer findings attribution; §10.4 skills-as-capability; §12.5 lineage drawer pointer; §13.8 migration gates (bridge whitelist, retirement criteria, per-Stage rollback, MOC update trigger); daemon ownership moved to core with deployment tiers summary.

Contradiction carried forward (flagged, not blocking): substrate IT §7/§13.4 channel recap still says `seq` is ordering+cursor and posits a global `msg_id` hash — superseded by canonical channels.md §5.1 cursor-model resolution (Lane E finding #2).

## 4. Minimal durability kernel candidate

Full set in `lane-f-minimal-kernel-candidate.json`. Principle: bring forward only the durability invariants that make work recoverable and attributable NOW, on the existing runtime (observability.db + bd + git), without gating on the substrate daemon/store programme (Stage 0) or any other deferred stage. Each item cites its canonical source so the full design can later absorb it without semantic drift:

1. Stable IDs — colon-ID scheme (`chain:<id>`, `node:<id>`), L3 participant_id vs L4 job_id separation (already adopted bridge-side by forensic v1 + Opp 18).
2. ChainRun/Container identity — minimal container record: id/kind/state + three axes (parent_id, opened_by provenance, owned_by).
3. Participant/activation lineage — participant_id stable across activations; activations correlated as job_id; provenance chain reconstructible reader-side.
4. Append-only effect receipts — idempotency keys on every external effect (channels §5.5 key list; pulse dedup pattern); forensic dual-write through the shipped `xtrm.forensic.v1` envelope writer.
5. Execution lineage — issue `evidence_json` as the durable side of the live/persisted dual-write; journal-with-gap-detection pattern for any long-running actor.
6. Projections recomputable from stream — truth-is-stream discipline; watermark-based recompute; monotonic `changesSince` cursor concept.
7. Explicit uncertain state — failure_class transient/semantic; `escalated` suspension; degraded-but-recorded outcomes (`unverified_endpoint`, `closed:with_followups`, `closed_with_followups` flag).
8. Replay-safe recovery — never destroy work on failure; preservation-on-failure; pre-mutation backup + integrity-check rollback predicate (state-store-options §10.2 pattern generalized).

## 5. Deferred-full-substrate

Everything else goes to `lane-f-deferred-full-substrate.json`: the Stage 0 daemon/socket/kernel programme, monorepo packaging, seed planning container, epic/wave/node kinds, chain-template engine, collision matrix, plan artifacts, two-stage validator, tether, console, two-tier Supabase projection, bd migration. The premortem's still-real risks (canon drift, migration gates underspecification, author=implementer) are recorded there as constraints, since R2/R9 gates now formally require runtime receipts + non-author review before further architectural absorption — which is exactly why the minimal kernel must NOT reintroduce the full programme as a prerequisite.

## 6. Open questions

1. EN doc end-state: archive vs re-sync to rev12 (translation-lag question also flagged in the handoff doc).
2. Who owns correcting the substrate IT §7/§13.4 channel-recap drift (seq/msg_id)?
3. Do the premortem "plan revisions rows 2/3/5/9" (narrow operator patches, top-tier v0 criterion, console entity-gating, cut Stage 0 scope) get absorbed into the canonicalization PRD, or stay owned by monorepo-migration/temp_roadmap? Synthesis assigns them to those docs; the reconciliation programme should confirm.
