## Phase 1 — Analysis

Premortem over-flags missing items because substrate doc is not only owner. Vault has explicit ownership split: substrate, telemetry, console, devops, chain templates. Need classify findings by wider canon, not substrate alone.

## Phase 2 — Devil's Advocate

Vault evidence can be stale. `xtrm-MOC.md` says telemetry contract "DA CREARE", while telemetry docs and specialists code say shipped. Design docs can reduce risk, not prove implementation. Deliberation docs do not equal independent review.

## Phase 3 — Synthesis

Many substrate "missing" items are addressed elsewhere, but substrate lacks enough "owned by [[doc]]" links. Real remaining risk = canon drift, migration gates, coordinator cost semantics, second-eyes governance.

## Phase 4 — Audit

## §1 — Stage 0 = kernel

**Verdict:** ADDRESSED

**Evidence:**
- `docs/state-store-options.md` — Defines local runtime: "ONE daemon, ONE socket, ONE state.db per machine".
- `docs/monorepo-migration.md` — Assigns `packages/core/` ownership for daemon, state engine, socket protocol.
- `docs/devops/devops-system.md` — DevOps is "cross-cutting su `xt`+`sp`+`sb`", not separate package.

**Reasoning:** Kernel concern is owned outside substrate: core owns daemon/store/socket, devops owns cross-cutting operations. Substrate should not absorb full kernel spec, only link it and state assumptions.

**Revised recommendation:** Fold references into `substrate_design_it.md` Stage 0 / §13: link `state-store-options.md` §1 and `monorepo-migration.md` §3.0 as kernel ownership.

## §2 — Design drift

**Verdict:** PARTIALLY_ADDRESSED

**Evidence:**
- `docs/xtrm-MOC.md` — States every doc has "casa" and "stato".
- `docs/xtrm-MOC.md` — Lists unresolved "Drift & buchi da chiudere".
- `docs/temp_roadmap.md` — Declares "decision record" and retargeted reads-forward after rev10.

**Reasoning:** Drift is actively tracked, not ignored. Gap remains: MOC itself records unresolved duplicate canon for channels/chain-templates and stale telemetry line.

**Revised recommendation:** Keep premortem risk, but downgrade severity. Add substrate "canon ownership table" pointing to MOC §1/§7 and block substrate edits that duplicate owned docs.

## §3 — Clean cutover never cuts

**Verdict:** PARTIALLY_ADDRESSED

**Evidence:**
- `docs/monorepo-migration.md` — Chooses "fresh umbrella" plus history-preserving grafts.
- `docs/temp_roadmap.md` — Says throwaway bridge can repay cost before retirement.
- `docs/temp_roadmap.md` — Notes bd patches retire only at later "bd→substrate migration".

**Reasoning:** Vault rejects fantasy big-bang cutover. Still missing explicit cutover gates: freeze criteria, rollback, data migration acceptance, deprecation deadlines.

**Revised recommendation:** Replace "clean cutover" ask with migration-gate appendix: bridge period, retirement criteria, owner, rollback, and MOC update trigger.

## §4 — Total rebuild vs targeted fixes

**Verdict:** ADDRESSED

**Evidence:**
- `docs/devops/devops-system.md` — "coexist, NON rebuild"; integrate Grafana/Prometheus/OTel/Terraform.
- `docs/temp_roadmap.md` — Patch rule: reduce friction now, survive substrate, or be honest throwaway bridge.
- `docs/state-store-options.md` — Keeps local SQLite authoritative, projects upward only for shared tier.

**Reasoning:** Wider vault consistently favors targeted bridges and standard infra reuse. Premortem rebuild concern does not hold as system canon.

**Revised recommendation:** Fold "coexist, not rebuild" into substrate intro/non-goals and Stage plan; cite devops §2 and temp_roadmap scope discipline.

## §5 — Node-coordinator load-bearing

**Verdict:** PARTIALLY_ADDRESSED

**Evidence:**
- `docs/specialists/specialists.scheme.md` — Orchestrator keeps global thread; specialists return structured handoffs.
- `docs/chains.md` — Current chain identity is worktree-rooted lineage, not final substrate identity.
- `docs/tether.md` — Shepherd "does not author work and does not schedule".

**Reasoning:** Vault separates orchestration, lineage, and prompt hints. Gap remains around node-coordinator failure model, scheduling authority, and load limits in substrate terms.

**Revised recommendation:** Keep finding as architecture gap. Add node-coordinator responsibilities/non-responsibilities table and failure budget; link `chains.md` as bridge-era only.

## §6 — Chain coordinator over-specified

**Verdict:** ADDRESSED (revised 2026-06-13 — was PARTIALLY_ADDRESSED)

**Evidence:**
- `docs/substrate/substrate_design_it.md` §4.3 — four coordinator roles enumerated: entry gate, borderline judge, cross-chain hygiene via pulse, close-time judge (contract validation + memory distillation + atomic `coordinator.release`).
- `docs/substrate/substrate_design_it.md` §3.1 — invariant "due layer di giudizio sempre presenti: approvazione + chain coordinator `verdict: ready`".
- `docs/substrate/substrate_design_it.md` §5.9 — kill+respawn-via-`coordinator_journal_json` at ~80% context-window threshold; coordinator survives its own death.
- `docs/channels/channels_plain_it.md` §8 — `audience_json.action_targets` + `kinds`; coordinator subscribes to `work.verdict`, `work.proposal`, `control.escalation`, `system.*`, `coordinator.release` precursors — NOT `work.turn` token streams.
- `docs/channels/channels_plain_it.md` §10 — `readSince` observation-only; `markSeen` effectful only when coordinator decides.
- `docs/channels/channels_plain_it.md` §11 — reducer pure + after-hook with idempotency keys.
- `docs/channels/channels_plain_it.md` §15 — attenzione opportunistica with hard limits (2 attention requests + 1 self-activation per epoch).

**Reasoning:** Initial PARTIAL verdict was driven by reading substrate §4.3 in isolation. Channels §8/§10/§15 provide the cost-bounding mechanism missed in the first pass: the coordinator's LLM cost isn't "always-on judge reading everything" — it's "wakes only on kinds it subscribes to, decides, writes one event, sleeps". Plus `coordinator_model: null` waives the LLM entirely for `code-quick`. Plus kill+respawn-via-journal handles long chains without context bleed. The dual framing (entity always exists; model may be null) is explicit in spec, not ambiguous. R6 dissolves once channels' selective-subscribe is on the table.

**Revised recommendation:** Keep coordinator entity, keep four roles as specified. **Follow-up:** `xtrm-1jp` proposes folding a 5th role (runtime incident handler) into §4.3 plus `runtime.*` failure kinds in channels §7 plus a `closed:failed`-as-verdict invariant in §3.1. That work is a clean extension of the existing design, not a revision of R6's verdict.

## §7 — Two-tier no v0 / forensic events

**Verdict:** NEW_FINDING

**Evidence:**
- `docs/telemetry/forensic-event-contract.md` — Shipped bridge includes "canonical `xtrm.forensic.v1`" and `specialist_forensic_events`.
- `docs/telemetry/prometheus-projection-contract.md` — Ships `sp metrics --prometheus` and `GET /metrics`.
- `src/specialist/forensic-events.ts` — `createForensicEvent` writes `schema_version: FORENSIC_SCHEMA_VERSION`.
- `src/cli/forensic.ts` — `sp forensic` reads persisted forensic events.
- `docs/xtrm-MOC.md` — Still says telemetry contract "DA CREARE".

**Reasoning:** Premortem missed shipped v0. New visible issue: MOC stale versus telemetry/code reality.

**Revised recommendation:** Mark substrate telemetry section as "owned by telemetry contract; shipped bridge exists". Update MOC telemetry row; fold only correlation/identity summary into substrate §2.7/§2.8.

## §8 — Console deferred

**Verdict:** ADDRESSED

**Evidence:**
- `docs/console/console-product-contract.md` — "single source of truth" for console surface.
- `docs/console/console-product-contract.md` — Product contract "remains stable across that migration".
- `docs/console/specialists-console-handoff.md` — Splits specialists runtime emission vs gitboard materializer projection.

**Reasoning:** Console is not deferred in vault; it has product contract, IA, object model, and data handoff. Substrate should avoid UI detail and link console canon.

**Revised recommendation:** Fold explicit substrate §dashboard note: console product owned by `console-product-contract.md`; data handoff owned by `specialists-console-handoff.md`.

## §9 — Author = implementer

**Verdict:** STILL_HOLDS

**Evidence:**
- `docs/_meta/vault-workflow.md` — Obsidian edits auto-commit; day-to-day notes can go direct to main.
- `docs/temp_roadmap.md` — Review pass marks decisions as closed by same design stream.
- `docs/xtrm-MOC.md` — Multiple docs from deliberation sessions exist, but no mandatory external reviewer gate.

**Reasoning:** Vault shows deliberation, not independent second eyes. Multiple docs help trace decisions, but do not create adversarial review or sign-off separation.

**Revised recommendation:** Keep meta-finding. Add required reviewer/researcher pass for substrate rev13+ and MOC-changing canon moves.

## Sub-question: user's note under §6

The user wrote: "does this mean that instead of making the reducer llm/programmatic, we can handover and switch to only coordinator doing that job?"

**Your answer (≤200 words):** No. Better framing: coordinator entity always exists; implementation mode varies. `substrate_design_it.md` already says `coordinator_model: null` = no-LLM reducer + mechanical checks. `chain_templates.md` says coordinator judges borderlines during execution. So do not collapse into "coordinator is always-LLM"; cost explodes and cheap deterministic cases become wasteful. Also do not collapse into "coordinator is always deterministic"; borderline verdicts, architecture conflicts, multi-writer attribution, and high-scrutiny release judgment need LLM/adjudicator capacity. Best model: coordinator owns continuity and final chain state; deterministic reducer handles normal aggregation; LLM coordinator/adjudicator activates on explicit triggers. This matches docs: permanent coordinator entity, nullable model, templates declare coordinator model/policy.

**Addendum (2026-06-13):** Once channels §8/§10/§15 selective-subscription is on the table, the coordinator CAN take on more judgment than this answer originally admitted without runaway cost — the cost ceiling lives in the kind-subscription model, not in substrate. The reducer keeps mechanical aggregation (cheap, high-volume); the coordinator subscribes to the kinds that matter and judges them. Not a handoff, a clean role split with bounded subscription. R6 verdict reclassified PARTIALLY_ADDRESSED → ADDRESSED.

## Roll-up

- Count by verdict (revised 2026-06-13): ADDRESSED=4, PARTIALLY_ADDRESSED=3, STILL_HOLDS=1, NEW_FINDING=1. R6 reclassified PARTIALLY_ADDRESSED → ADDRESSED after re-reading substrate §4.3 in full + channels §8/§10/§11/§15 selective-subscription model.
- Top 3 still-real risks after cross-doc audit, ranked (revised 2026-06-13):
  1. Canon drift: MOC stale, duplicate chain-template ownership, substrate missing owned-by links.
  2. Migration gates: bridge retirement and cutover criteria still underspecified.
  3. Independent reviewer (R9): deliberation docs ≠ second-eyes review.
- Top 3 docs to fold back or link:
  1. `docs/telemetry/forensic-event-contract.md` — shipped bridge status; substrate §2.7/§2.8 telemetry identity.
  2. `docs/state-store-options.md` + `docs/monorepo-migration.md` — Stage 0/kernel/store ownership; substrate §13.
  3. `docs/console/console-product-contract.md` + `docs/console/specialists-console-handoff.md` — dashboard/console ownership; substrate dashboard/API sections.
- Meta-finding stands: deliberation docs count as traceability, not independent second-eyes review.
- New follow-up (xtrm-1jp): runtime incident handler as 5th coordinator role in §4.3 + `runtime.*` failure kinds in channels §7 + `closed:failed`-as-verdict invariant in §3.1. Discovered post-audit; clean extension of the existing design.

## Status

No files changed. GitNexus detect shows pre-existing touched `docs/channels/channels.md`; not caused here.

## Verification

Read via GitNexus: requested vault docs, telemetry docs, console docs, substrate §4.3 evidence, specialists forensic code. Ran `gitnexus_detect_changes()`.

## Risks

`docs/premortem-substrate/synthesis.md` not indexed by GitNexus, so original recommendation wording inferred from provided § titles and adjacent canon. No shell/read tool exposed, so no direct file cat.

## Final Answer

Distilled recommendation: do not expand substrate into all canon. Add owned-by links and short integration summaries. Fix MOC staleness first, then add migration gates and coordinator policy matrix. Keep independent-review finding alive.  

```json
{
  "status": "success",
  "summary": "Completed cross-doc audit with 9 verdicts, sub-question answer, roll-up, and verification notes.",
  "files_changed": [],
  "follow_ups": [
    "Update MOC telemetry row; it conflicts with shipped forensic contract/code.",
    "Add owned-by links from substrate_design_it.md to telemetry, console, state-store, monorepo, chain_templates.",
    "Add cutover gates and coordinator deterministic-vs-LLM policy."
  ],
  "risks": [
    "synthesis.md not indexed by GitNexus; original recommendations inferred from prompt sections.",
    "No shell/read tool available; audit used GitNexus indexed content only.",
    "Pre-existing docs/channels/channels.md changes detected, not touched."
  ],
  "verification": [
    "gitnexus_query/context used for vault docs and specialists forensic code.",
    "gitnexus_detect_changes(scope=all) run for /home/dawid/dev/xtrm."
  ]
}
```