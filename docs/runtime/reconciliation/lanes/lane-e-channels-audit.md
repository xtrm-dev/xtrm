# Lane E — Channels communication/authority audit

> Read-only reconciliation audit. Repos: `/home/dawid/dev/xtrm` @ `01a1b647298c` (brief said `4f6ac48c4e0b`; actual HEAD is a later vault commit — recorded as discrepancy, working-tree reads used), `/home/dawid/dev/specialists` @ `0253e3e4b823` (matches brief).
> Scope: Channels domain. Canonical runtime-reference contract extracted in `lane-e-runtime-reference-contract.json`; source inventory in `lane-e-source-register.json`. Bead: `xtrm-cn8.2`.

## 1. Files read completely

| File | Lines | SHA (git HEAD:path) | Classification |
|---|---|---|---|
| `docs/channels/channels.md` | 864 | `45a9981bb8b7` | **CANON** — normative spec |
| `docs/channels/channels-upgrade.md` | 1103 | `b3568d432d17` | decision-log / rationale (non-normative) |
| `docs/channels/channels-forensic-attention-proposal.md` | 490 | `1a727dce6a49` | historical proposal, all Q1–Q7 resolved |
| `docs/channels/channels_plain_it.md` | 705 | `6670abce7fd5` | editorial translation **with unique current delta** |
| `/home/dawid/dev/specialists/docs/design/substrate/channels.md` | 14 | `4510b07f2b03` | resolved stub pointer (not a fork) |

## 2. Canonical determination

`docs/channels/channels.md` is the single canonical Channels document. Evidence:

- Self-declares: "Doc role: **canonical / normative spec**" (channels.md:11).
- `xtrm-MOC.md`:34,59,108 — vault `channels/channels.md` is canonical; repo copy replaced by stub (MOC §7 #1 resolved 2026-06-21).
- `_meta/2026-06-21-design-reconciliation.md` §0: "Channels (xtrm) — design LOCKED & AUDITED (2026-06-11). Tutte le 11 open questions risolte."
- `channels-upgrade.md`:11 — explicitly non-normative: "Where this doc and `channels.md` differ, `channels.md` wins."
- specialists `docs/design/README.md` cross-cutting section points all Channels design at the vault.

## 3. Duplication analysis

### 3.1 specialists `docs/design/substrate/channels.md` — RESOLVED duplicate
Was a stale 617-line copy (2026-05-26); on 2026-06-21 it was replaced by a 14-line breadcrumb stub pointing to the vault canonical. It is **not** a live fork; no content diff remains to reconcile. The stub's stated facts (canonical home, companions, MOC §7 #1 resolution) verify against the vault tree.

### 3.2 `channels.html` — cosmetic export
89 KB HTML export of the canonical doc (MOC:150 confirms it is a plain export). Classified generated/export; not read in full.

### 3.3 `channels-upgrade.md` — sanctioned rationale companion, with internal supersessions
Two sections carry explicit SUPERSEDED banners that must survive any canonicalization pass:
- §7 (~lines 240–293): v0 SQL schema historical; canonical schema is channels.md §5.1. Old SQL uses `target_participant_ids_json`/`target_job_ids_json` and lacks the cursor model.
- §20 (~lines 955–1003): v0/v1/v2/v3 roadmap wording superseded by the single-delivery 0.1→0.2 model (channels.md §11).
Everything else is rationale feeding canonical sections, each carrying an explicit "Canonicalized in channels.md §X" pointer.

## 4. Contradictions and drift found

1. **`channels_plain_it.md` contains content absent from canonical `channels.md`.** plain_it §7 (lines 195–208, added 2026-06-13, bead `xtrm-1jp`) defines seven `runtime.*` mechanical-failure message kinds (`runtime.participant_died`, `runtime.gate_unresponsive`, `runtime.worktree_diverged`, `runtime.evidence_ref_broken`, `runtime.pulse_delivery_failed`, `runtime.budget_exhausted_mid_step`, `runtime.recursion_cap`) plus a `chain.incident.opened/resolved` wake kind. Canonical channels.md §5.3 (lines 136–157) lists only `runtime.error`, `runtime.message_rejected`, `runtime.member_joined/left`, `runtime.delivery_failed`. The substance is also canonical in substrate_design_it.md (§3.1 invariant 2026-06-13, §4.3 role 5), but the *channel message-kind table* was updated only in the Italian translation. This delta must be absorbed into channels.md §5.3 before the translation can be treated as purely editorial.
2. **Substrate channel-recap vs canonical cursor model.** `substrate_design_it.md` §7 recap and §13.4 still describe "`seq` … ordinamento e cursore" plus a globally-unique `msg_id` hash. Canonical channels.md §5.1 (lines 72–77, 103) resolved the opposite way (2026-06-11 audit, Open-Q #10): the table-wide autoincrement `id` is the sole delivery cursor; `seq` is display-only; no `msg_id` hash exists in the canonical schema. The substrate recap paragraphs predate that resolution.
3. **substrate §13.4 omits the `channels` table** from the channels-domain table list (canonical §5.1 has three tables). Cosmetic drift, same root cause as (2). Fix belongs to a substrate-doc pass (Lane F flagged).
4. No contradictions between channels.md and channels-upgrade.md outside the two banner-marked SUPERSEDED sections; every other divergence carries an explicit canonicalization pointer.

## 5. Authority claims observed

- channels.md claims authority for: envelope/storage schema (§5.1), message families (§5.3), audience/visibility (§5.4), delivery/cursor semantics (§5.5), edge derivation (§5.8), projection invariants (§5.9), attention/self-activation (§5.10), authority procedure (§10.1), error envelope (§10.2), evidence dereference (§10.3), swap state machine (§10.4), forensic families (§10.5), phasing (§11).
- channels.md defers authority: work graph + issue/step state + projection assembly → substrate (`substrate_design_it.md`, Lane F); identity minting L1–L5 → substrate §2.7; forensic envelope → `telemetry/forensic-event-contract.md` (SHIPPED SSOT in specialists repo); cross-container coordination → pulse (substrate §2.3/§4.5); metrics cardinality rule → `telemetry/prometheus-projection-contract.md`.
- upgrade.md retains ownership only of rich coordinator-projection shapes (§14–15) as detail beyond channels.md §5.9's canonical table/invariants.

## 6. Unique requirements to preserve

From upgrade.md (decision-log): "v0 = canonical contract, minimal engine" thesis; layer-boundary invariant list (§2); supervisor inbox intent shape (§16); governance invariant "No specialist may edit any .specialist.json" (§17); metrics forbidden-label list (§19); the twelve decisions to carry into the repo (§21).
From forensic proposal: nothing unique remains — all decisions landed; retained as provenance of Q1–Q7.
From plain_it: the 2026-06-13 `runtime.*` / `chain.incident.*` vocabulary and the detect-in-reducer → deterministic-recovery → coordinator-wake description (pending absorption into canonical §5.3).
From the specialists stub: bead-mandatory-reading pointers landing there must redirect to the vault.

## 7. Dispositions

| Source | Disposition |
|---|---|
| `channels.md` | CANON — keep as normative runtime-reference contract |
| `channels-upgrade.md` | KEEP as non-normative decision-log; preserve its two SUPERSEDED banners; no second messaging contract may be extracted from it |
| `channels-forensic-attention-proposal.md` | **HISTORICAL** — Q1–Q7 all resolved with inline successor pointers to channels.md §5.4/§5.10/§10.3/§10.5/§11 and upgrade.md §23; doc self-declares "proposta storica (non normativa)". Recommend historical status + successor pointer |
| `channels_plain_it.md` | KEEP as editorial translation; **absorb its §7 runtime.\*/chain.incident.\* delta into channels.md §5.3 first**, then demote to purely editorial |
| specialists `substrate/channels.md` | KEEP stub as relocation breadcrumb; verified accurate |
| `channels.html` | Generated export; regenerate on canonical change |

## 8. Open questions

1. Where does the `runtime.*` failure-kind vocabulary canonically live — channels.md §5.3, or a substrate-owned failure taxonomy referenced from it? Today fully specified only in plain_it + substrate IT §4.3 role 5.
2. Should substrate IT §7/§13.4 channel-recap paragraphs be corrected to the `id`-cursor model or annotated historical? (Fix belongs to a substrate pass; drift is about Channels.)
3. `epic` cross-channel watching and multi-user identity remain deferred indefinitely by design (channels.md §12.4–12.5, Out-of-scope) — tracked, not open defects.
