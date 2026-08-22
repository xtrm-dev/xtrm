# Lane A — XTRM Programme Documentation Audit

Lane: A (read-only documentation audit, runtime canonicalization programme)
Date: 2026-08-22
Parent bead: xtrm-cn8 (Runtime architecture doc audit + canonicalization programme)
Scope: 23 documents fully read (first byte to last byte) + `bd list` / `bd ready`.
Companion artifact: `lane-a-source-register.json` (same directory).

---

## 1. Files read completely

| # | Path | SHA (HEAD blob) | Bytes | Lines |
|---|---|---|---|---|
| 1 | docs/xtrm-MOC.md | c5f83563ef7a4270b8f4d18f840b8a4504e5dc83 | 9361 | 154 |
| 2 | docs/_meta/2026-06-21-design-reconciliation.md | e0fa7383fdffe97aad86c9515bfe44d3dd9a00ed | 23175 | 434 |
| 3 | docs/_meta/vault-workflow.md | 9805f5382941c918780a3b0fa09ac9381755f684 | 5224 | 145 |
| 4 | docs/shared/xtrm-current-execution-plan.md | c45c2b17c263b59263717e7cc12f0e6a76375e22 | 28591 | 855 |
| 5 | docs/shared/xtrm-current-execution-plan.json | 49c53fd8930e4117da23574b6690a3ef3fc9f7b9 | 22354 | 860 |
| 6 | docs/shared/xtrm-v1-completion-ledger.md | fdff0fcabc82a2c5b38c140f02aa74a114e03672 | 9317 | 86 |
| 7 | docs/shared/xtrm-v1-completion-ledger.json | 3b52d9b67fb90bb96137a8a6b31c5357350aa099 | 9915 | 245 |
| 8 | docs/shared/xtrm-v1-runtime-reconciliation-and-termination-2026-08-09.md | ad9f482b887e6ed46623abb16bf469ab8dc81ff7 | 47551 | 890 |
| 9 | docs/shared/xtrm-v1-runtime-reconciliation-and-termination-2026-08-09.json | 1c24d6ff2971ce94e90afff8d67960a82ceebe32 | 7389 | 187 |
| 10 | docs/shared/xtrm-local-coordinator-bootstrap.md | 8e7baa4a196e5d1b3f5e0d449be5a0972dc87328 | 9495 | 392 |
| 11 | docs/shared/xtrm-codex-kan-127-execution-note.md | c227d35d2389c6aaadd282ae7ddbcec2c58f957b | 15129 | 331 |
| 12 | docs/shared/xtrm-cli-actionable-outcomes-and-followups.md | a11623d71ee3ec5e0a195835207b0c62de199214 | 19294 | 629 |
| 13 | docs/shared/xtrm-harness-native-adapters.md | 2181601619a5475ba81f79f45d5bfba6b958e046 | 23926 | 824 |
| 14 | docs/shared/xtrm-native-pi-tools-pi-extensible-workflows-integration-2026-07-30.md | 583e411bd34c1bad5341965193171321e7abac3a | 30887 | 1189 |
| 15 | docs/shared/xtrm-deterministic-quant-pipelines-2026-08-10.md | 9bc4d231ba97ccb90594c596afa6a117064ed286 | 44552 | 1226 |
| 16 | docs/shared/native-chain-runtime-audit-2026-08-19/architecture-decision-matrix-and-adr-index.md | 0395909a941b3f4064aeaec93990cbd84d4607fb | 12499 | 247 |
| 17 | docs/shared/native-chain-runtime-audit-2026-08-19/local-verification-packet.md | 0d4575156d17a46f839c59357cf80a8de062bec5 | 10401 | 416 |
| 18 | docs/shared/native-chain-runtime-audit-2026-08-19/native-chain-runtime-prd-draft.md | f05edf4c09cf1a1d7b7657cfef0698a0a6836c4f | 33499 | 1279 |
| 19 | docs/shared/native-chain-runtime-audit-2026-08-19/source-and-authority-register.md | ba010d696ceac6ee0a4e78a72cf05b6b6106b91c | 24584 | 346 |
| 20 | docs/tether.md | 352de9f2dd7a45c244111fbe3e2480a8b097cccd | 22548 | 405 |
| 21 | docs/improvements.md | 3d63713ca4f5d3b64c290d6c4ef9325879df321e | 1919 | 14 |
| 22 | docs/state-store-options.md | ee711d268da34f1ca2e9223a6ec7070d411b0791 | 18364 | 284 |
| 23 | docs/monorepo-migration.md | c4b9c89771ab24eee057794d11617f5998ad5ea1 | 27915 | 497 |

Read status: complete for all 23. SHAs are HEAD blobs (`git rev-parse HEAD:<path>`); none untracked.

## 2. Transitively discovered files (deliberately NOT read — out of lane scope)

Named repeatedly by the scoped corpus; candidates for other lanes:

- `docs/shared/xtrm-native-harness-on-pi-architecture-exploration-2026-08-09.md` — absorbed input of plan JSON (line 837), ledger JSON (line 15), reconciliation §2 / §9 XTRM-HARNESS-01. Not in this lane's scope list; existence on main not verified here.
- `docs/shared/xtrm-jira-reconciliation-packet.json` — required input of coordinator bootstrap (line 25).
- `docs/channels/channels.md`, `docs/channels/channels-upgrade.md` — patch targets XTRM-CHAN-01/02.
- `docs/substrate/substrate_design_it.md`, `_en.md` — XTRM-SUB-01 targets.
- `docs/console/**` — XTRM-UI-01 target family.
- `xtrm-dev/specialists`: `enhanced-prd.md`, `specialists-roadmap.md`, `specialist-execution-protocol.md`, `chain-templates/README.md` (broken canon pointer per verification packet §11), `pi-rpc-boundary.md`, `chains-prompt-evals.md`.
- `xtrm-dev/core`: `memory-system-r6g.md`.
- `docs/harness/**` incl. the agentsession-sre-chain-vertical-slice experiment family (register §4 Harness section).
- GitHub draft PRs #33/#34 (SUPERSEDED dispositions in ledger §2).
- `docs/conversations.md` — companion of tether.md; presence not verified.

Exclusion reason: lane scope fixed by coordinator; these belong to other lanes. Recorded so the coordinator can assign them.

## 3. Which documents genuinely belong where (shared vs runtime/harness/research/archive)

`docs/shared/` currently mixes five distinct document classes:

**Genuinely programme-canonical (stay shared or move to a programme/ root):**
- `xtrm-current-execution-plan.{md,json}` — self-declared "canonical current execution plan" (md line 3); reconciliation line 7 names it "Programme sequencing authority".
- `xtrm-v1-completion-ledger.{md,json}` — "the single cross-repository disposition index" (md line 5).
- `xtrm-v1-runtime-reconciliation-and-termination-2026-08-09.{md,json}` — accepted amendment with built-in sunset (see §6 below); after absorption becomes provenance record → eventually archive.
- `xtrm-local-coordinator-bootstrap.md`, `xtrm-codex-kan-127-execution-note.md` — programme sequencing companions; keep adjacent to the plan (bootstrap stale, see §4/§7).

**Runtime/harness domain (natural seed of the target docs/runtime/ structure):**
- All four `native-chain-runtime-audit-2026-08-19/*` files — ADR matrix+index, PRD draft, local verification packet, source register (analysis in §12).
- `xtrm-cli-actionable-outcomes-and-followups.md` — command-outcome contract; runtime surface contract.
- `xtrm-harness-native-adapters.md` — adapter boundary; harness domain.
- `xtrm-native-pi-tools-pi-extensible-workflows-integration-2026-07-30.md` — reference design (classified REFERENCE DESIGN by the 2026-08-19 register line 59); harness/reference.
- `tether.md` — Specialists sidecar (Shepherd) design draft; belongs in Specialists/harness docs, not xtrm shared programme canon.

**Research/archive:**
- `improvements.md` — personal Italian research notes (AWS summit follow-ups); archive.
- `xtrm-MOC.md` — June-2026 design index; historical snapshot; provenance only (register line 62: "useful for provenance and owner discovery").
- `_meta/2026-06-21-design-reconciliation.md` — register line 63: "HISTORICAL DECISION RECORD". Archive after extracting still-valid contracts.
- `_meta/vault-workflow.md` — editorial/ops how-to for the Obsidian vault; neither programme nor runtime; keep under `_meta/`.

**Target design (keep, annotate deferral):**
- `state-store-options.md` — storage-tier design; still owner-of kernel decisions via its inbound-reference table §10.1; predates the v1 termination deferral of Substrate runtime and conflicts with packet D-08 on daemon timing.
- `monorepo-migration.md` — accepted five-package target design; DEFERRED_BY_EXPLICIT_GATE per ledger §3 line 66; timing refined by packet D-12/C-12 ("implement in final package boundaries when safe").

## 4. Stale release/version assertions (quoted with file:line)

1. **cli-actionable-outcomes §4 (lines 97–99)**: "Core is released as `xtrm-tools` 0.11.2." / "xtmux is released as `@jaggerxtrm/xtmux` 0.2.2." / "Specialists is released as `@jaggerxtrm/specialists` 3.21.1" — superseded by execution-plan §2 (lines 40–42): Core `xtrm-tools 0.11.4` (`xtrm-dev/core#535`, `9b823f80`), Specialists `@jaggerxtrm/specialists 3.21.2` (`#240`, `c1e660ab`), xtmux `@jaggerxtrm/xtmux 0.2.3` (`#89`, `12d6709e`). The doc itself flags: "These claims must be revalidated against HEAD before planning" (line 106).
2. **harness-native-adapters line 5**: "**FOR MCP, 2.0 WAS RELEASED SO BEFORE ANYTHING GETS IMPLEMENTED FROM HERE, IT SHOULD BE VERIFIED**" — untracked-style banner asserting external MCP 2.0 state without an evidence pointer; §2.4 (lines 88–94) describes the MCP `2026-07-28` spec as "still a release candidate" — stale external-state claim as of any later date.
3. **local-coordinator-bootstrap lines 70–74**: "Expected release baseline: Core 0.11.4 / Specialists 3.21.2 / xtmux 0.2.3" — versions match the plan but the bootstrap's flow (§ Exact implementation order, lines 277–307) predates the v1 termination amendment: no R1, no PI-v0.84.1, no KAN-127 K5/K6, no GATE-HARNESS-ADR anywhere in it.
4. **execution-plan md line 4 vs json line 3**: md says "**Last reconciled:** 2026-08-09", JSON says `"last_reconciled": "2026-08-10T00:00:00+02:00"` — one-day drift between paired authority files.
5. **MOC (whole doc)**: reflects 2026-06-21 state; e.g. line 130 "Roadmap reconciliation 2026-06-21 … `unitAI-sc03v` CLOSED"; open checkboxes at lines 122, 127, 129, 131 unresolved and unverifiable against current repos.
6. **2026-06-21-design-reconciliation line 13**: "`specialists-roadmap.md` è canonical (1145 linee, 2026-06-03). 8 fasi (P0–P7), **nessuna avviata**"; line 237: "Stage 0 … ~8 settimane stimato; gating per tutto" — daemon/state.db-first critical path later revised by AgentSession evidence (register C-03/C-04). Valid as history only.
7. **quant-pipelines line 1227**: "The superseded 2026-08-04 XTRM chain/Substrate/Channels reconciliation remains historical provenance for the original quant vertical sequence" — correct self-awareness; that doc is another stale artefact to locate in the corpus sweep.

## 5. Documents with explicit sunset / absorption / supersession requirements

- **v1 reconciliation md line 8**: "**Sunset condition:** once every direct document patch in §9 is merged and the current execution plan/registry are refreshed, this file becomes a provenance/change record rather than a competing long-lived authority." JSON line 7 repeats: `"sunset": "after direct canonical patches, execution-plan refresh, and final programme-ledger reconciliation"`.
- **Reconciliation §9 patch matrix (lines 549–569)**: 19 mandatory patches (SP-PRD-01 … XTRM-DRAFT-02) with acceptance criteria; preamble line 547: local agents "must update the actual canonical documents; they must not simply cite this file forever."
- **XTRM-DRAFT-01/02** (reconciliation lines 568–569 and §15 lines 818–824): absorb unique content from draft PRs #33/#34 then close/supersede; line 824: "The programme must end with exactly one master completion ledger, not two competing registry documents."
- **Ledger §1 line 15**: SUPERSEDED is a defined terminal disposition; §2 rows XTRM-DRAFT-01/02 marked SUPERSEDED.
- **channels-upgrade rationale** (reconciliation XTRM-CHAN-02, line 559): "mark any conflicting older delivery assumptions superseded by canonical `channels.md`".
- **Substrate EN companion** (ledger §2 line 34; reconciliation line 560): "EN cannot overrule rev12 while stale."
- **Packet ADR matrix §4 (lines 189–200)**: ten immediate canon changes "after local verification", including item 2 "Generalize C1 from Template → ResolvedChain to ChainSource → ChainDefinition → ResolvedChain" and item 3 "Reframe R1.6/GATE-HARNESS-ADR around native production parity, retaining RPC compatibility" — the packet requires superseding parts of the current plan when adopted.
- **Verification packet §11 (lines 298–314)**: P0 documentation-authority fix — `specialists/docs/design/roadmap/chain-templates/README.md` points to missing `docs/design/chain-templates.md`; requirement to "explicitly supersede broken pointer".

## 6. Duplicate master plans / ledgers

- **Plan ↔ Ledger**: complementary, not duplicates. Plan = sequencing/gates authority; ledger = disposition/evidence index. Gate states agree: plan JSON line 830 `"gate_state": "GATE-R0=DOCUMENTS_PATCHED_PENDING_REVIEW; remediation applied; all later gates pending"` == ledger §4 line 72 and ledger JSON line 21. Both defer Substrate runtime/migration identically (plan JSON lines 831 vs ledger line 59).
- **Reconciliation ↔ Plan**: amendment source vs amended authority; plan §15 (lines 821–855) absorbs it. The reconciliation explicitly sunsets once absorbed (§5 above) → its long-term slot is archive/provenance.
- **Coordinator bootstrap ↔ Plan §8/§10**: duplicates gate semantics and first-packet epics in a pre-amendment form. Stale partial duplicate; regenerate or archive.
- **Packet ↔ everything**: the PRD draft (phases A–F, §21) + ADR set (ADR-01..10) + sequencing (matrix §5) constitute a third forward plan. Status "Draft for canonicalization and local source/runtime verification" (PRD line 3). Until adopted or rejected there are effectively **two live candidate sequencing authorities** — exactly the "competing authority" pattern the reconciliation forbids elsewhere.
- **MD/JSON pairs**: consistency obligation stated at register line 51 ("must remain consistent with Markdown"). Only observed drift: the 2026-08-09/08-10 reconcile-date mismatch (§4 item 4).
- **state-store-options ↔ monorepo-migration §11**: the five-path storage decision table appears in both; state-store §9/§10 is the authoritative reasoning, migration §11 a summary mirror.

## 7. Programme workstream / gate inventory and current claims

### Workstreams (plan §7 + JSON `workstreams`; amendment adds R1)

| ID | Title / scope | Current claim relevant to runtime |
|---|---|---|
| R0 (.1–.5) | Release & authority reconciliation | GATE-R0 = DOCUMENTS_PATCHED_PENDING_REVIEW (plan JSON line 830; ledger line 72). Exit = "Every §9 patch merged or explicitly rejected; one ledger; contradiction review; local Beads delta mapped". |
| I1 (.1–.4) | Deterministic public command outcomes | Source doc: cli-actionable-outcomes. Additive `_outcome` shape `xtrm.command-outcome.v1` (plan lines 280–294). Not delivered (plan line 128 lists it under Core "Not delivered"). |
| E1 (.1–.4) | Minimum `specialists.execution.v1` | PREPARE/FINALIZE reducers + idempotency; non-goals prompt/memory/scheduling/grading (JSON lines 250–255). Residual per ledger line 50. |
| R1 (.1–.10) | Runtime-semantics closure (amendment) | R1.1 identity/envelope, R1.2 supervision split, R1.3 lease/journal/uncertain, R1.4 replay/snapshot/recovery, R1.5 bounded convergence, **R1.6 native-harness-on-Pi AgentSession parity spike + ADR**, R1.7 Channels delivery, R1.8 memory promotion, R1.9 substrate lineage projection, R1.10 console runtime-tree (plan JSON lines 262–372; reconciliation §12 lines 748–759). "R1 is not a new product family. It is the design closure recorded by the direct patches above" (reconciliation line 620). |
| C1 (.1–.5) | Chain compiler + durable spine | Pre-packet model: template catalog → pure compiler → persisted `ResolvedChain` (`specialists.resolved-chain.v1`, plan lines 397–418) → thin Beads materializer ("must not invent a second dependency graph", line 429) → manual composition CLI review/insert/approve/show (line 434–441). Packet generalizes authoring (§8 below). |
| D1 (.1–.4) | Evidence reducer, scheduler intents, coordinator shadow | Reducer derives next transition from persisted evidence only; intents exact/idempotent (plan §D1); coordinator shadow may not invent scheduling or skip mandatory gates (line 489). Blocked by GATE-COMPOSE + GATE-HARNESS-ADR (JSON line 449–452). |
| V1 (.1–.5) | Telemetry integrity, Eval Core, deterministic context, prompts, three-lens memory | Eval-gated promotion; memory lenses herd/workgroup/identity only (reconciliation D17); "Only after retrieval and pollution can be measured" (plan line 520). |
| A1 (.1–.5) | Harness-native integrations | Thin native tools list `xtrm_coordination_send/status/read`, `xtrm_specialist_dispatch/status/result/resume/stop`; "Adapters retain no private durable authority" (plan lines 537–549). A1.3 Pi Runtime Unification residual; A1.4 pi-extensible-workflows gated on idempotency + worktree ownership proof (line 554–556); A1.5 XT Codex parity → KAN-127 note. |
| P1 (.1–.4) | Product surfaces | Console eval views (KAN-123), Agent Workspace read-only first, OKS read-only provenance layer; "No UI-specific orchestration logic" (plan line 574). |
| S-TS7 / S-CODE-INTEL / S-ARCHON | Supporting lanes | KAN-125 / KAN-110 / bounded Archon comparison; all `critical_path: false` (JSON lines 785–812). |

### Gates

| Gate | State per ledger §4 / plan JSON | Claim |
|---|---|---|
| GATE-R0 | DOCUMENTS_PATCHED_PENDING_REVIEW | Docs patched; review + Beads mapping outstanding |
| GATE-PI84 | PENDING | Pi v0.84.1 atomic RPC compatibility + fault-injected settlement/retry/compaction/recovery tests (ledger line 73) |
| GATE-HARNESS-ADR | PENDING | Terminal retain-RPC vs adopt-native ADR from R1.6 parity evidence; native selection additionally requires governed RLM-child negative proofs (ledger lines 74, 166; plan JSON lines 686–708) |
| K5 / K6 | PENDING | Codex parity promotion after GATE-IFACE / ordered compatibility releases (KAN-127 note §§K5–K6) |
| GATE-IFACE | PENDING | Approved command-outcome contract + consumer fixtures + released-trio smoke; does not authorize chain automation (plan lines 600–607) |
| GATE-COMPOSE | PENDING | Packaged catalog, pure compiler, persisted draft/approved shape, manual composition fixture; observe-only execution only (plan lines 619–628) |
| GATE-DO0 | PENDING | 11 deterministic-orchestration requirements (plan lines 656–668); authorizes scheduler intents + shadow mode only |
| GATE-AUTH | PENDING | Measured precision/parity/override/recovery evidence before any warn/enforce promotion (plan lines 672–683) |
| FINAL | PENDING | Published-artifact E2E, deployment freshness, Beads/Jira/GitHub reconciliation (ledger line 80) |

### Other named programmes
- **RUN 0** — document reconciliation head of the amended critical path (plan §15 line 829); "RUN 0 is not complete from documentation alone" (line 849).
- **Quant/math vertical** — QD0–QD6 implementation stages (quant §33); 18-item acceptance criteria (quant §34); "design/reference only; this document does not claim `GATE-COMPOSE`, `GATE-DO0`, release, deployment or authority promotion" (quant line 7).
- **KAN-84…KAN-125** Jira mirrors mapped in plan §11 (lines 738–757); **KAN-127** K0–K7 Codex phases in the execution note (Beads epic `xtrm-ozknq`).
- **Eval lane** — V1.1/V1.2 plus packet extension: "Eval Core is not missing; its subject model is incomplete" (register C-09, line 281); extend subjects to SpecialistDefinition/ActivationProfile, compiler, whole ChainRun/Container, E2E (PRD §17).
- **RLM** — governed cognitive descendants inside one approved step; cannot mutate ResolvedChain topology (reconciliation decisions list line 31; PRD §14.1; quant §24).

### Current claims about the four contested concepts

**Native AgentSession:**
- Plan §8.4 (lines 632–643) + JSON GATE-HARNESS-ADR: *neutral* terminal decision — "retain the corrected RPC-compatible runtime, or select an XTRM-native harness on public Pi runtime APIs"; comparison "must cover lifecycle/terminality, cancellation, retry, compaction, context, evidence/forensics, cleanup, recovery and upstream compatibility".
- Reconciliation D20 (lines 320–324): "RPC remediation first; direct `AgentSession` remains an ADR-quality follow-up"; "No migration is authorized merely because direct `AgentSession` is architecturally attractive."
- Ledger lines 51/166: residual pending R1.6 parity + terminal ADR; "Native adoption is not presumed."
- **Packet D-09 (matrix line 18)**: "Native AgentSession is preferred product target. Corrected RPC remains compatibility/migration/rollback/headless transport." State EVIDENCE-SUPPORTED. Register C-03 (lines 222–225) explains the shift: the SRE vertical-slice experiment proved direct hosting, custom tools, parallel reducer scheduling and crash/resume; "Gate becomes production-parity/hardening evidence, not a coin-flip architecture decision."

**ChainSource / ChainDefinition / ResolvedChain / ChainRun:**
- Plan/C1 knows only Template→ResolvedChain; schema `specialists.resolved-chain.v1` (plan line 399; quant line 641 uses the same schema).
- Packet PRD §3 defines four stages: ChainSource (variants TemplateChainSource / JsonChainSource / AdHocChainSource / ImportedWorkflowSource, PRD lines 96–109; ad-hoc "is **not ephemeral prose**. It is persisted as a versioned/auditable source artifact before execution", line 109) → ChainDefinition (authored AST, "No physical job/session IDs belong here", line 132) → ResolvedChain (approved immutable compiler output; "Structural change requires a new reviewed revision", line 153) → ChainRun bound 1:1 to `Container(kind=chain)` ("Container and ChainRun must not maintain independent contradictory terminal state machines", line 187).
- Matrix D-01/D-04/D-05 RECOMMEND ACCEPT (no ChainProgram entity; Container generic envelope + ChainRun chain-specific progression).
- Invariant block (PRD §2 lines 34–53): `SpecialistDefinition != ChainDefinition != ResolvedChain != ChainRun`; `Participant != Activation`; `participant_id != execution_id != pi_session_id`; `agent_end != step satisfied`.

**Compiler:**
- Plan C1.2: pure compiler — "No shelling, Beads mutation, tmux or model call" (lines 380–392).
- Packet: one ChainLoader over all ChainSource variants → ChainDefinition → one compiler → ResolvedChain (register C-01 lines 192–213; matrix §4 item 2); compiler determinism becomes an Eval Core subject (PRD §17.1 layer 2: "invalid topology rejection").

**RPC:**
- Everywhere pre-packet: Pi v0.84.1 atomic remediation is the immediate path (reconciliation Phase 1 lines 594–603: "The Pi remediation is atomic across current package identity/version, `agent_settled` session-terminal semantics, current JSON event shape and compaction lifecycle parsing. The RPC-vs-SDK question does not block this repair."); ledger line 48; SP-PI-01 patch.
- Packet: RPC demoted to compatibility/migration/rollback/headless transport if native confirmed (D-09); ADR-03 owns the Participant-vs-Activation identity, ActivationSupervisor, PREPARE/FINALIZE and provider upgrade gate (matrix lines 75–85); verification packet §2/§3 enumerates PR #71 + live-smoke evidence needed first.

## 8. Contradictions found

1. **Native-target vs neutral gate.** Packet D-09/C-03 ("native AgentSession preferred product target") vs plan §8.4 / reconciliation D20 / ledger ("native adoption is not presumed"). The packet acknowledges and orders the canon change (matrix §4 item 3). Unresolved until the reframed gate is written into plan/ledger.
2. **Template-only vs four-stage authoring.** Plan C1 (Template→ResolvedChain) vs packet ChainSource→ChainDefinition→ResolvedChain(+ChainRun). Matrix §4 item 2 mandates generalization; plan text not yet updated.
3. **Substrate "deferred" granularity.** Ledger line 59 "DEFERRED_BY_EXPLICIT_GATE" vs packet C-04 (lines 228–246): "'Substrate deferred' is too coarse — implement a minimum runtime kernel early" (journal, leases, uncertain, snapshots). Reconcilable (kernel ≠ full migration) but the ledger row does not carve out the kernel exception yet.
4. **Release baselines.** cli-actionable-outcomes (0.11.2/0.2.2/3.21.1) vs plan/bootstrap (0.11.4/0.2.3/3.21.2). See §4 item 1.
5. **Daemon-first sequencing.** 2026-06-21 meta doc + state-store-options/monorepo-migration assume Stage 0 daemon+state.db gating everything (meta line 237; state-store §9 Path 1 chosen 2026-06-06) vs packet D-08 "No daemon-first rewrite. Prove contracts/file specimen and local runtime; introduce resident state engine only with measured need." Historical-vs-current tension; state-store kernel decisions remain inbound-referenced (its §10.1) so cannot be silently archived.
6. **xtmux role emphasis.** CLI/adapters docs prefer CLI-subprocess adapters (adapters lines 439–445 Ponytail preference); packet D-17 evolves xtmux V2 toward provider/backend supervisor, "never workflow authority". Direction-compatible but emphasis superseded.
7. **Date drift** plan md (08-09) vs json (08-10) — cosmetic but violates the pair-consistency rule (register line 51).

## 9. Unique requirements that must survive canonicalization

1. One-authority-per-concern table (plan §3.3 lines 94–108; bootstrap Authority boundaries lines 35–44; pi-tools doc §3).
2. Execution identity envelope fields (reconciliation §5 lines 394–417: principal/actor/assignment/participant/execution/attempt/parent/job/runtime_session/generation/authority_ref + lease + convergence_policy).
3. `uncertain` mutation outcome + journal rules: admission-before-effect, completed keys return durable result, uncertain blocks blind replay, reconciliation records resolving evidence (reconciliation D5/§6).
4. ChannelMessage → DeliveryIntent → DeliveryAttempt → ProcessingReceipt split; `channel_messages.id` stays semantic cursor; runtime replay uses execution_id+generation+sequence; snapshot recovery never renumbers Channel messages (reconciliation D6/D7/§7).
5. Runtime supervision ≠ workflow supervision boundary (reconciliation D1; packet ActivationSupervisor "never decides which chain node is next", PRD line 519).
6. Four-stage chain object model + immutability after approval + revision-not-mutation (packet PRD §3/§2), preserving templates as one ChainSource variant rather than rejecting them (D-02).
7. Container(kind=chain)/ChainRun 1:1 single terminal authority; whole-container cleanup contract including borrowed-session release-not-kill (packet D-05, D-18, PRD §12.4 lines 749–771).
8. Capability request ≠ grant; `ResolvedCapabilityGrant` controls tools; Pi built-in tools not enabled by role prose; legacy `skills.scripts` compiles to typed ProbeDefinition/EffectDefinition (packet C-06/C-07, PRD §9–10).
9. Command-outcome contract: stable reason codes, argv next_actions, no prose parsing, FYI-no-monitor, receipt≠fulfilment, idempotent retries, hostile-input redaction (cli doc §5/§16; KAN-127 K2 rules lines 150–157).
10. Adapter thinness: no private durable store/job lifecycle/scheduler; message body never grants authority; never execute CLI `display` strings (harness-adapters §3; XTRM-ADAPT-01).
11. Three memory lenses only; findings are candidates not truth; no silent self-modification; execution lineage is provenance not a fourth store (reconciliation D13/D15–D17; packet §13).
12. Five-package target; no sixth package; monorepo not a prerequisite (reconciliation D22; ledger lines 66/235–236; packet D-30/§19 with implement-in-final-boundaries refinement).
13. Quant vertical acceptance criteria (quant §34, 18 items) and validator-promotion discipline: exploratory `save_result()` warnings ≠ blocking gates without explicit versioned validator contract (quant §14).
14. Gate ladder + forbidden-early-work list (plan §12 lines 767–780; JSON `forbidden_early_work` lines 814–826) including "native harness adoption before GATE-HARNESS-ADR".
15. Sunset discipline: amendments must declare their own sunset; exactly one master ledger (reconciliation line 8; line 824) — structural requirement for any future docs/runtime/ regime.
16. Kernel rollback predicate: WAL checkpoint backup + integrity_check gate + operator-approved restore + forensic rollback event (state-store §10.2) — the only testable Stage-0 rollback spec in the corpus.
17. Bridge whitelist (closed set, additions require operator escalation) + data-driven retirement criteria + per-stage rollback table + "no rollback is free / rolling back is permanent lineage" rule (monorepo-migration §5.1).
18. KAN-127 separation rule: programme GATE-IFACE is proven independently of production Codex; "This separation prevents a circular gate in which `xt codex` would have to be production-ready before the gate that authorizes production harness adapters" (note lines 125–133).

## 10. The native-chain-runtime-audit-2026-08-19 packet vs target docs/runtime/

Verified: the packet already contains all four target artefact types:

- **PRD draft** (`native-chain-runtime-prd-draft.md`, 1279 l): product thesis (13 numbered claims, §1), non-negotiable invariants (§2), full object model (§3), product lifecycle (§4), planning/composition (§5), Chain JSON + ad-hoc durability/promotion (§6), specialist execution protocol (§7), runtime supervision split (§8), capabilities/tools (§9), probes (§10), Channels/cooperation (§11), Beads/Substrate runway + kernel + cleanup (§12), memory (§13), RLM/dynamic workflows (§14), workspace/leases/Git (§15), observability (§16), Eval Core extension (§17), CLI/MCP/harness parity (§18), packaging (§19), reference verticals (§20), phases A–F (§21), non-goals (§22), 24 acceptance criteria (§23), 10 bounded local-evidence gates (§24). Status: "Draft for canonicalization and local source/runtime verification".
- **Decision matrix + ADR index** (`architecture-decision-matrix-and-adr-index.md`, 247 l): 35 decisions D-01…D-35 with states (ALREADY ACCEPTED / RECOMMEND ACCEPT / EVIDENCE-SUPPORTED / ALREADY SUPPORTED BY CANON / LOCAL GATE), consolidated ADR-01…ADR-10 ownership map, product-requirements-not-ADRs list (§3), ten immediate canon changes (§4), post-acceptance implementation sequencing A–G (§5).
- **Local verification packet** (`local-verification-packet.md`, 416 l): 16 sections of machine-level verification (cold-start state §1, PR #71 closure §2, AgentSession live evidence §3, prototype hardening bugs §4, Beads capability matrix §5, planning-skill→ChainDefinition proof §6, container/ChainRun file specimen with fault-injection matrix §7, package-placement gate §8, xtmux characterization §9, runner/supervisor decomposition audit §10, chain-template canon repair §11, CLI/MCP/API mapping §12, memory test §13, whole-chain eval spike §14, quant confirmation §15, report format §16).
- **Source & authority register** (`source-and-authority-register.md`, 346 l): authority-class taxonomy §3 (CURRENT CANON / ACCEPTED AMENDMENT / CURRENT IMPLEMENTATION RECORD / PROPOSED / EXPERIMENT EVIDENCE / RESEARCH-REFERENCE / HISTORICAL-SUPERSEDED), full source register across xtrm/Specialists/Core/xtmux/Console/DevOps/Quant/external §4, contradictions C-01…C-12 §5, experiment findings that must not be promoted as-is §6, coverage statement §7.

Relationship to target structure: this packet is the natural **seed corpus of docs/runtime/**. Recommended mapping:
- architecture-decision-matrix-and-adr-index.md → `docs/runtime/adr/` (index; individual ADRs authored against ADR-01…10 ownership),
- native-chain-runtime-prd-draft.md → `docs/runtime/prd/` (promote to canon only after §24 verification gates),
- local-verification-packet.md → `docs/runtime/verification/` (bounded work tracker),
- source-and-authority-register.md → merge into the programme-wide source register this audit feeds (it already classifies most of this lane's corpus; lane A adds classifications for vault-workflow, tether, improvements, cli/adapters/pi-tools details).

Its own §4 canon-change list defines what must be edited in the plan/ledger when docs/runtime/ is adopted. Its remote-head snapshot (register §2 lines 27–30, dated 2026-08-19) must be refreshed per its own instruction line 32. Note the packet's register classifies two of this lane's scoped docs differently than their self-descriptions: pi-tools doc = REFERENCE DESIGN (not current design) and MOC = DESIGN INDEX (provenance only) — lane A adopts those classifications.

## 11. Beads mapping (programme workstream view)

From `bd list` / `bd ready` (16 issues: 13 open, 3 in progress):
- **xtrm-cn8** [EPIC, P2, IN_PROGRESS] — "Runtime architecture doc audit + canonicalization programme": parent of this audit; description matches current effort (source register, absorption matrix, decision matrix, runtime PRD+ADR set, Specialists PRD/roadmap/protocol reconciliation, execution-plan update; "No runtime code changes").
- **xtrm-w5m** [P2, IN_PROGRESS] — "Bench: direct AgentSession vs sp RPC RSS/CPU/wall": directly generates cost/resource dimensions of R1.6/GATE-HARNESS-ADR comparison evidence.
- **xtrm-2zd** [epic] + children .1–.4 [P1] — "Reconcile Mercury DevOps collaborator with XTRM v1 runtime and ownership semantics": consumes v1 reconciliation semantics (sync/event admission .1, recovery/GC .2, identity/delivery/observability .3, validation against current authorities and migration gates .4).
- Handoff beads **xtrm-y9i** (2026-06-10) / **xtrm-h1r** (2026-06-14): stale session handoffs predating the August programme docs; candidates for retirement per ledger SUPERSEDED vocabulary.
- Remaining open beads (release-flow, service-knowledge fixes, SSH signing, board-audit exporter, bench) are adjacent infrastructure, not programme workstream packets.
- No open bead maps R0/I1/E1/C1/D1/V1/A1/P1 symbolic packets in this repository. Per reconciliation §12 ("must not create a new cross-repository mega-epic if equivalent roots already exist") and ledger §5, residuals must be mapped onto repository-local Beads; that mapping is not yet visible here — consistent with GATE-R0 still being pending-review.

## 12. Open questions

1. Does `docs/shared/xtrm-native-harness-on-pi-architecture-exploration-2026-08-09.md` exist on main? It is an absorbed input of three canonical files but was outside lane scope. If missing, absorbed-input pointers dangle.
2. Have the reconciliation §9 patches actually landed in owner repos (Specialists PRD/roadmap/protocol, channels.md, core memory)? Ledger says DOCUMENTS_PATCHED_PENDING_REVIEW; verification requires reading those repos (other lanes).
3. Which artefact becomes the single sequencing authority after packet adoption: the amended current-execution-plan, or a promoted runtime PRD? Both currently claim forward planning (contradiction §8.1/8.2 resolution depends on this).
4. Regenerate coordinator bootstrap against the amended plan, or retire to archive?
5. Where do state-store-options / monorepo-migration kernel decisions live after Substrate deferral — retained as target design under docs/runtime/, or absorbed into ADR-02/ADR-07?
6. Final GitHub-side dispositions of PRs #71/#33/#34 need confirmation (read-only check possible in a later lane).
7. Is `docs/conversations.md` present? tether.md depends on it for mailbox/single-scheduler invariants.

## 13. Disposition summary (full detail in lane-a-source-register.json)

canonical: execution-plan md/json, completion-ledger md/json · normative (sunsetting): reconciliation md/json · programme-sequencing: kan-127 note, coordinator bootstrap (stale — regenerate) · implementation-reference: cli-actionable-outcomes, harness-native-adapters, quant pipelines · experiment/audit-seed: all four native-chain-runtime-audit files · research/reference: pi-tools-pi-extensible-workflows, tether, improvements · historical: MOC, 2026-06-21 reconciliation · editorial: vault-workflow · current-target-design: state-store-options, monorepo-migration (both deferred-by-gate).
