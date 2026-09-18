# System One telemetry and outcome attachment (XTRM-502, criterion 7)

Jira XTRM-99 criterion 7: document how System One request telemetry and
outcomes attach to observability and forensics. §4 adds the rule: "System
One answer, policy decision, side effect and realized outcome are different
events and are never collapsed into one record."

## What exists now (verified)

Code: `src/xtrm_research/evidence_gate/telemetry_run.py`. Test:
`tests/test_evidence_gate_telemetry.py` (mutation-proven: moving the
answers into the policy record fails it).

Real run: `~/.xtrm/research/runs/evidence-gate-v2-jev-telemetry/`. It is a
platform run with a write-once manifest, and `xtrm-research tail` and
`metrics` read it. It records the Jev arm of the Evidence Gate over the
frozen dataset v2. It makes no new model call: the recorded answers carry
TypeSafe's own request ids.

Every item yields three events that share `request_id` and `sample_id`.

| Event `kind` | Carries | Never carries |
|---|---|---|
| `system_one_call` | `request_id` (TypeSafe `x-typesafe-request-id`), `backend`, `model` (alias requested), `model_version` (resolved, e.g. `jev-1.13.0`), `question_spec_hash`, `state_hash`, `workload`, `answers` (nouls; no `confidence` for a Noul), `latency_ms`, `cost` (from `prices.json`, version stated), `usage` (`usage_record`: tokens; `cost` null with `not_exposed_by_provider`, because TypeSafe returns none) | the policy decision, the outcome |
| `policy_action` | `request_id`, the policy id, version and content hash, `action` (`retain_evidence` / `retain_contradiction` / `reject`), the calibrated inputs, the thresholds applied, the calibration method and fold, `calibration_bucket`, `side_effect: "none"` | the raw answers, the outcome |
| `outcome` | `request_id`, `resolved` (reference labels per question), `resolver` (label version and labels hash), `resolved_at` | the answers, the decision |

The side effect is the fourth §4 record. The research run performs none,
and says so in `policy_action.side_effect`. In a runtime, the caller writes
the side effect in its own ledger, such as a Substrate journal entry or
closure (see `contract-map.md` §2).

## How it attaches to observability and forensics

1. **Back to the originating agent run.** Each event's `telemetry_refs`
   points at the observation the item came from:
   - `pi_session_id` for Pi `ctx_search` items;
   - `specialists_job_id` for researcher `ddgs` items.

   A forensic reader can go from a System One answer to the Pi session or
   Specialists job whose search produced the passage (`sp feed <job>`, the
   Pi session log).

   Gap, recorded and not patched: `telemetry_refs` has no field for a
   Claude Code session or a Substrate issue or closure. Claude-sourced
   items keep their `source_ref` in `data` only (`contract-map.md` §4).
2. **Forward to decisions and outcomes.** `request_id` is the join key:
   - answer -> `policy_action` (what the policy did with it);
   - answer -> `outcome` (whether it was right).

   Calibration and drift observability (OQ12) is a query over those
   joins:
   - per `question_spec_hash`, `calibration_bucket` against the resolved
     label frequency gives the reliability diagram;
   - a shift in bucket occupancy or in resolved frequency over
     `resolved_at` is drift.
3. **Provider-side forensics.** The provider's `request_id` is kept
   verbatim, so a disputed answer can be traced on the TypeSafe side.
   `contract-map.md` §4 recommends a locally minted call id as well,
   because a request that fails before a response has no provider id.
4. **Who resolves outcomes (OQ11).**
   - Research: here, a versioned reference-label set.
   - Runtime: the source that realizes the truth, such as a Substrate
     closure for a duplicate question, or an operator verdict for an
     incident. It is cited by id in `outcome.resolver`.
   - The outcome record, not the source system, owns the link
     (`contract-map.md` §4).

## What remains for a runtime (not XTRM-99 research)

The following belong to the runtime schema that `contract-map.md` §3.2
places in a future dedicated package:

- `risk_class` and `deadline` request metadata;
- a local call id;
- Substrate and Claude reference fields in `telemetry_refs`;
- live (not replayed) emission.

They are not implemented here. §10.1 of the operator constraints limits
XTRM-99 to research.
