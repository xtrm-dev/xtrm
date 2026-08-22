# Asset Absorption Matrix

> Status: CANONICAL reconciliation artifact (coordinator-owned).
> Generated: 2026-08-22 · Programme bead: `xtrm-cn8`
> Machine companion: [`asset-absorption-matrix.json`](asset-absorption-matrix.json) (138 assets, per-row SHAs)
> Evidence base: [`source-register.json`](source-register.json) + lane audits under [`lanes/`](lanes/)

## Corpus freeze gate (pre-write state)

| Metric | Value |
|---|---|
| TOTAL_FILES | 140 registered rows → 138 deduplicated assets |
| FULLY_READ | 137 |
| PARTIAL / UNREAD / UNCLASSIFIED | 0 / 0 / 0 |
| Residual non-complete rows | 3 — all justified generated artifacts (below) |
| BROKEN_CANONICAL_LINKS | 48 real mdlink misses + 114 stale path mentions (lane-j), fixes scheduled in W6 |
| AUTHORITY_CONFLICTS (register-level) | 0 unresolved (6 label aliases normalized; substantive contradictions → decision matrix) |

Residual rows: `docs/substrate/chain_templates.html` (stale export → archive),
`docs/channels/channels.html` (cosmetic export → regenerate-on-change only),
`docs/premortem-substrate/{out,reason,prompt,err,log,report}` fan-out outputs
(generated raw artifacts; `synthesis.md` fully read).

## Disposition summary

keep 51 · update_in_place 30 · absorb_then_archive 21 · retain_as_evidence 13 ·
archive 9 · move 6 · replace_with_pointer 5 · delete_generated_copy 3

## Key candidate dispositions

### XTRM programme / shared/

| Asset | Disposition | Absorbed into / target | Unique content preserved |
|---|---|---|---|
| `shared/xtrm-current-execution-plan.{md,json}` | **update_in_place** | — | Sequencing authority stays here; R1 native-parity reframe, C1 four-stage authoring, A1 reclassification, eval-lane extension (see decision matrix Q18/Q1/Q20) |
| `shared/xtrm-v1-completion-ledger.{md,json}` | update_in_place | — | Single ledger rule; carve out minimum-Substrate-kernel exception |
| `shared/xtrm-v1-runtime-reconciliation…2026-08-09.{md,json}` | **absorb_then_archive** | execution plan §15 + runtime canon | Identity envelope fields; `uncertain`+journal rules; ChannelMessage→DeliveryIntent→DeliveryAttempt→ProcessingReceipt split; supervision≠workflow boundary. Sunset condition self-declared |
| `shared/xtrm-local-coordinator-bootstrap.md` | archive | — | Nothing unique beyond plan duplication (stale pre-amendment) |
| `shared/xtrm-codex-kan-127-execution-note.md` | keep | — | GATE-IFACE independence from production Codex (anti-circular-gate rule) |
| `shared/xtrm-cli-actionable-outcomes-and-followups.md` | update_in_place | — | Command-outcome contract semantics; fix stale release baselines |
| `shared/xtrm-harness-native-adapters.md` | move → `runtime/harness/native-adapters.md` | — | Adapter thinness rules (no private durable store/scheduler; body≠authority) |
| `shared/xtrm-native-pi-tools-pi-extensible-workflows…` | update_in_place (+ REFERENCE DESIGN banner) | — | Bounded authoring/cognition integration; never a second durable runtime (Q18) |
| `shared/xtrm-deterministic-quant-pipelines-2026-08-10.md` | move → `research/` | — | Quant vertical acceptance criteria (§34, 18 items); validator-promotion discipline |
| `native-chain-runtime-audit-2026-08-19/native-chain-runtime-prd-draft.md` | **absorb_then_archive** | `runtime/prd/native-chain-runtime.md` | Four-stage object model; invariants block; phases A–F; 24 acceptance criteria |
| `…/architecture-decision-matrix-and-adr-index.md` | absorb_then_archive | `runtime/adr/*` + `runtime/reconciliation/runtime-decision-matrix.md` | D-01…D-35 states; ADR-01…10 ownership map; ten immediate canon changes |
| `…/local-verification-packet.md` | retain_as_evidence → move under reconciliation/ | — | 16-section bounded verification tracker (D-07/D-30 local gates) |
| `…/source-and-authority-register.md` | absorb_then_archive | this register | C-01…C-12 contradiction list |
| `xtrm-MOC.md`, `_meta/2026-06-21-design-reconciliation.md`, `_meta/vault-workflow.md` | archive / archive / keep | — | Provenance value only (first two) |
| `state-store-options.md` | update_in_place | feeds ADR-002 | Kernel rollback predicate (WAL backup + integrity_check + operator-approved restore + forensic event) |
| `monorepo-migration.md` | update_in_place | feeds packaging ADR section | Bridge whitelist; data-driven retirement criteria; per-stage rollback table |
| `tether.md` | retain_as_evidence | — | Shepherd sidecar draft; fix dead `conversations.md` links |

### Specialists

| Asset | Disposition | Notes |
|---|---|---|
| `design/roadmap/specialists-roadmap.md` | **update_in_place** | W3 writer; references accepted integrated runtime model; no WP tables copied in |
| `design/roadmap/enhanced-prd.md` | absorb_then_archive → **residual xtrm-cn8.5** (interim: stays canon with dated header note + `wp-continuity.json`, 90 WPs preserved; open decisions #1/#2 already ported to §20.2) | consolidation into current canonical specialists-prd.md tracked as its own bead |
| `design/roadmap/chains-prompt-evals.md` | **move → history/** after residual port | ~98% overlap with PRD verified mechanically; §9 was the eval reference text — successor is the new PRD Workstream E section |
| `design/execution-protocol-design/specialist-execution-protocol.md` | update_in_place | PREPARE/PLAN/EXECUTE/FINALIZE core preserved; activation/attempt/session identity, grants, probes updated |
| `…/specialist-execution-protocol-ownership-decision.md` | keep | Ten invariants verbatim |
| `current-release-snapshot.md` | update_in_place | Versions refreshed at write time |
| `chain-templates/README.md` | **update_in_place** | Broken canon pointer fixed → xtrm `docs/substrate/chain_templates.md`; missing catalog rows added; formulas framed as ChainSource compatibility assets |
| 15 × `.formula.json` | absorb_then_archive → future ChainDefinition corpus | Formula-wins-for-shape precedence preserved; code-with-tests obligations-scanner defect flagged for migration fix |
| `design/audit-reconcile-v0724.md` (0 bytes) | replace_with_pointer → core original | PRD cites it as evidence; stub is misleading |
| `TODO.md` | delete_generated_copy | Empty stub |
| `docs/design/README.md`, `roadmap/README.md` | update_in_place | Stale counts (12 opportunities/13 formulas) corrected |
| history trio | keep | Banners correct |
| `ARCHITECTURE.md` / `architecture.md` | keep both | Not duplicates (boundary doc vs cache addendum) |

Duplicate elimination:
- `xtrm:docs/specialists/specialists-execution-protocol.md` ≡ specialists original (body similarity 1.000, both claim canonicality) → xtrm copy becomes pointer; specialists repo owns protocol prose.
- `xtrm:docs/specialists/agentops-suite.md` ≡ specialists origin (0.994, plus `-10.1` corruption) → pointer.
- Native-harness exploration: exactly two blobs across 20+ copies (`1d98420b` stale subset vs `5bec00a3` superset) → shared blob wins, moves to `docs/harness/`; stale twin deleted.

### Channels / Substrate

| Asset | Disposition | Notes |
|---|---|---|
| `channels/channels.md` | **CANON — keep/update_in_place** | Absorb `channels_plain_it.md` §7 `runtime.*`/`chain.incident.*` message-kind delta into §5.3 before demoting the translation to purely editorial |
| `channels/channels-upgrade.md` | keep (decision log) | Two SUPERSEDED banners preserved; no second messaging contract extracted |
| `channels/channels-forensic-attention-proposal.md` | archive | All Q1–Q7 resolved; HISTORICAL banner + successor pointers |
| `channels/channels.html` | delete_generated_copy | Regenerate on canonical change only |
| specialists `design/substrate/channels.md` | keep (stub) | Healthy relocation breadcrumb; model pattern |
| `substrate/substrate_design_it.md` | CANON rev12 — update_in_place | Correct §7/§13.4 channel-recap cursor drift (`seq`/`msg_id` → `id`-cursor model) |
| `substrate/substrate_design_en.md` | archive | STALE banner since 2026-06-01; rev10; no unique current content vs rev12 IT |
| premortem-substrate dir | retain_as_evidence (archive wholesale) | Synthesis + disposition table absorbed; raw outputs are generated artifacts |
| Minimal durability kernel | NEW — ADR-002 | 8-item candidate set from lane-f (stable IDs; ChainRun/Container identity; lineage; effect receipts; execution lineage; projections; explicit uncertain; replay-safe recovery) without reintroducing Stage-0 daemon programme |

### Core / planning

No core doc claims compiler/scheduler/participant-protocol/Channels/Specialist-resolution authority (verified by grep, lane-h §3). Key updates: superseded-designs registration for two 2026-03 era plans; skills vendor-drift remediation note (repo copies stale vs shipped SSOT for planning/test-planning); UPSTREAM-DEPENDENCIES formula count 13→15.

Planning direction change (documented, not implemented): intent → authored ChainDefinition → review/freeze → ResolvedChain → Beads materialization, replacing intent → direct Beads graph mutation. Draft-capture (`contract:draft`) beads remain the intake format feeding ChainDefinition authoring.

### Telemetry / Eval / Memory / Console

- Forensic contract = envelope SSOT; projection contract becomes the single forbidden-label source; catalog gets C-1/C-2/C-4 corrections. Prometheus stays low-cardinality; exact IDs stay in forensics/evidence/read models.
- Eval Core: no standalone doc exists; ontology owned by Specialists PRD Workstream E. Extension follows packet C-09 ("subject model is incomplete — extend, don't rebuild"); all 16 requested subjects map onto existing entities with no new tables (lane-i-eval-extension-map.json).
- Console host ownership (C-3): console-repo architecture set is canonical post-host-retirement; xtrm-tree console architecture copies become pointers; product contract remains the surface authority.

## Post-write disposition status (updated 2026-08-22 after independent review)

Applied during W1–W6: runtime foundation (README/PRD/ADR-001..006); plan+ledger amendments incl. kernel exception aligned to ADR-002's 8 items; banners (pi-extensible-workflows REFERENCE DESIGN, forensic-proposal HISTORICAL, chains-prompt-evals HISTORICAL move); chain-templates README pointer fix + 2 catalog rows; execution-protocol and agentops-suite xtrm duplicates → pointers; harness stale twin → pointer; tether dead links; wp-continuity.json; PRD identity-envelope + memory sections.

Explicitly residual (each has an owner bead — none silently dropped):
- `xtrm-harness-native-adapters.md` move, quant doc move, coordinator-bootstrap archive, MOC/_meta archives → **xtrm-cn8.6** (docs housekeeping batch)
- Console architecture copies → pointers (C-3), core superseded-designs registration, skills vendor-drift note → **xtrm-cn8.6**
- channels.md §5.3 absorption of plain_it §7 `runtime.*`/`chain.incident.*` kinds; substrate IT §7/§13.4 id-cursor correction → **xtrm-cn8.6** (channels/substrate correction pass)
- enhanced-prd consolidation into current canonical specialists-prd.md → **xtrm-cn8.5** (in-place header note + wp-continuity.json keep the deviation documented meanwhile)
- v1-reconciliation archive: deferred BY DESIGN until its own sunset condition (all §9 patches merged) is met; identity envelope now carried by runtime PRD §"Execution identity envelope", delivery split by ADR-005

## Follow-ups required at write time (serialized)

1. W1/W2 create `docs/runtime/**` and absorb packet content.
2. W3/W4 edit specialists roadmap/protocol/PRD/README/formulas-pointer.
3. W5 correct execution plan md+json (+ date-drift fix) and ledger kernel exception.
4. W6 execute all `move`/`delete_generated_copy`/`replace_with_pointer` rows with inbound-reference updates (git mv where true moves), including chain-templates README pointer, execution-protocol duplicate, agentops-suite duplicate, harness stale twin, console architecture pointers.
5. Re-run crawler; prove UNREAD=0 / UNCLASSIFIED=0 / UNRESOLVED_DUPLICATES=0 / UNRESOLVED_AUTHORITY_CONFLICTS=0 / BROKEN_CANONICAL_LINKS=0 on post-mutation tree.
