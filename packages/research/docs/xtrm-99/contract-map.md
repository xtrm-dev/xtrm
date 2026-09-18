# XTRM-99 System One: contract map, runtime boundary, OQ1 and OQ2

Issue: Substrate `XTRM-501`. Source PRD: Jira `XTRM-99`.
Verified against the live tree at commit `78006cf` (branch `xt/hguv`), 2026-09-18. §6 records what the XTRM-492 branch changed afterwards.
Every field, column, and path below was confirmed by grep before citation.

Labels used in this document:

- **Fact**: observed in the named file.
- **Gap**: a contract element with no implementation, or a partial one.
- **Recommendation**: a proposal. It is not implemented.

Path abbreviations:

- `R/` = `packages/research/src/xtrm_research/`
- `S/` = `packages/substrate/src/`
- `SP/` = `~/dev/specialists/src/` (separate repository)

## 1. Contract element map

Owners proposed in column (c):

- **research**: `packages/research`. It owns experiments, adapters, and calibration.
- **runtime**: a future System One runtime package. §3 describes it.
- **caller**: the XTRM surface that calls System One.

### 1.1 Request

| Element | (a) Exists today | (b) Gap | (c) Future owner |
|---|---|---|---|
| `state` | Fact: `R/system_one.py` `SystemOneBackend.system_one(state, questions)`. `R/jev.py` sends `payload["state"]`. | None. | runtime (the call); caller (the content) |
| `questions[].id, type, instructions, criteria` | Fact: `R/schemas/question_spec.schema.json` requires `id, version, content_hash, type, instructions`, and has the optional fields `criteria, options, legend`. `R/jev.py` `_question_body` sends only `type, instructions, criteria`. | None. The spec is a superset of the PRD. | research (spec authoring and versioning); runtime (consumes the specs) |
| `metadata.workload` | Fact: this element is run-level only. It exists as `manifest.schema.json` `workload` (a `version_ref`) and as `R/schemas/workload.schema.json`. | The per-call event has no workload field. | runtime (per-call field) |
| `metadata.risk_class` | Absent. A grep over `R/` finds no match. | Missing. | runtime |
| `metadata.deadline?` | Absent. | Missing. `JevBackend` has no timeout or deadline argument. | runtime |

### 1.2 Response

| Element | (a) Exists today | (b) Gap | (c) Future owner |
|---|---|---|---|
| `model` | Fact: `usage_record` fields `gen_ai.request.model` and `gen_ai.response.model` (`R/telemetry.py`). The transport copies `response.model` (`R/transports.py`). | None. | runtime |
| `model_version` | Fact: run-level only, in `manifest.schema.json` `backend.{provider, model, model_version}`. `R/importers.py` writes `"unrecorded"`. The Jev call event records `sdk_version`, which is the client version and not the model version. | Correction (verified 2026-09-18, `typesafe-sdk` 0.7.0 in this tree): a request for the alias `jev-latest` returns `response.model = "jev-1.13.0"`, the resolved version, on every observed call. The per-call model version is therefore available; the research event did not record it until XTRM-502. | runtime |
| `request_id` | Absent from every research schema. Fact: `typesafe-sdk` exposes `response.request_id`, which is read from the `x-typesafe-request-id` header (`typesafe_sdk/_core/schemas/base.py`). `R/transports.py` `typesafe_system_one` discarded this value at `78006cf`; this branch returns it (XTRM-497/502). | Resolved for research: recorded in the `system_one_call` event of the XTRM-502 telemetry run. | runtime (see OQ2) |
| `answers` (Choice / Score / Noul) | Fact: `R/schemas/common.schema.json` `$defs.choice_answer {choice, probabilities, confidence}`, `score_answer {score, legend, probabilities, confidence}`, and `noul_answer {noul}`. `R/jev.py` `_answer` refuses an answer whose type does not match the question. | The answers are returned to the caller only. `emit_system_one_call` does not write them to the `system_one_call` event. A caller can persist them in `sample.schema.json` `output` or in `assessment_set.schema.json` `assessments[].answer`. | research (schema); runtime (durable answer record) |
| `usage.input_tokens / output_tokens` | Fact: `usage_record` fields `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`, filled from `response.usage` (`R/jev.py` `_usage`). | None. | runtime (reuse `usage_record`) |
| `latency` | Fact: `data.latency_ms` on the event and `usage.latency_ms`. `R/jev.py` measures both around `send_through_run`. | The value includes guard time. This is acceptable for research and must be documented for runtime. | runtime |

### 1.3 Minimum durable telemetry

| Element | (a) Exists today | (b) Gap | (c) Future owner |
|---|---|---|---|
| `request_id` | Absent (see §1.2). | Missing. | runtime |
| `model`, `model_version` | See §1.2. | `model_version` is missing per call. | runtime |
| `backend` | Fact: `system_one_call` `data.backend`. For example, `JevBackend.backend_id = "jev-typesafe-v1"`. | None. | runtime |
| `question_spec_hash` | Fact: `data.questions[].content_hash`. The manifest also has `question_specs[]` (`version_ref`). | None. | research (hashing, `R/hashing.py`) |
| `state_hash` | Fact: `data.state_hash`, produced by `R/system_one.py` `state_hash()` as `sha256:` over canonical JSON. | None. | research (function); runtime (reuses it) |
| `workload` | Run-level only (see §1.1). | The per-call field is missing. | runtime |
| `answers` | Not in the event (see §1.2). | Missing from telemetry. | runtime |
| `usage` | Fact: the event field `usage` (`usage_record`), validated by `common.schema.json` `$defs.usage_record`. | None. | runtime (reuse) |
| `latency` | Fact: `data.latency_ms`. | None. | runtime |
| `cost` (null with reason) | Fact: `usage_record` fields `cost`, `cost_currency`, `null_reason` (enum `no_price_entry`, `not_exposed_by_provider`), and `null_detail`. Jev always writes `cost=None`. | The price table does not exist (the code comments point to XTRM-432). | research (price table); runtime (applies it) |
| `policy_action` (separate record) | Absent. Note: `R/evaluators.py` `policy()` is an offline quality metric (`executable * (1 - open_decision) ...`). It is not a policy action. | Missing. No research event kind exists for policy. | caller (emits); runtime (schema) |
| `outcome` (separate record) | Partial analogue only. Research has blind labels imported by `R/importers.py` and scored as `assessment_set.schema.json` `assessments[]`. Substrate has `issue_closures.outcome` (`S/store/migrations/011_closure.ts`, enum `CLOSURE_OUTCOMES` in `S/domain/closure.ts`). The closure outcome is a work-item outcome, not a System One outcome. | No record links an outcome to a System One call. | runtime (schema); caller (supplies the source) |
| `resolved_at` | Absent. The nearest field is Substrate `issue_closures.closed_at`. | Missing. | runtime |
| `calibration_bucket` | Offline only. `R/evaluators.py` computes ECE with `ECE_BIN_COUNT = 10` and assigns `min(int(p * 10), 9)` at assessment time. | Not stored per call. | research (bucketing rule); runtime (stores the bucket) |

### 1.4 Adjacent surfaces (facts)

- **Research event envelope.** `R/schemas/event.schema.json` requires `schema_version, seq, ts, kind`. Its optional fields are `sample_id, data, telemetry_refs, telemetry_snapshot, usage`. The version is `xtrm-research-event/v1`. The event kinds that exist include `system_one_call` and `guard_pass` (`R/guards.py`). Events are sequenced per `run_id` under `~/.xtrm/research/runs`.
- **Research cross-reference fields.** `common.schema.json` `$defs.telemetry_refs` has `specialists_job_id, specialists_attempt_id, specialists_activation_id, pi_session_id, event_seq`. It has no Substrate reference field. `R/telemetry.py` states that research reads only closed snapshots and never writes to Specialists tables or to `~/.xtrm/state.db`.
- **Substrate (work authority).** Every durable table is keyed by `issue_id NOT NULL`:
  - `issue_journal` has `id, issue_id, issue_revision, sequence, run_id, participant_id, activation_id, session_id, kind, mechanical_json, semantic_json, refs_json, created_at`, plus `result_json` (migration 009) and `execution_context_json` (migration 010). `kind` takes a `JOURNAL_KINDS` value.
  - `execution_bindings` and `work_receipts` are in migration 006.
  - `issue_events` has `id, issue_id, type, payload_json, created_at`.
  - `issue_closures` and `closure_attempts` are in migration 011.
- **Specialists (agent-run observability).** Rows are keyed by `job_id`:
  - `SP/specialist/observability-sqlite.ts` `specialist_events` has `id, job_id, seq, specialist, bead_id, t, type, event_json`.
  - `specialist_job_metrics` includes `model, elapsed_ms, token_trajectory_json`.
  - The only request identifier is `jsonrpc_request_id` (`SP/specialist/forensic-events.ts`). It identifies an MCP request, not a model call.
- **Other packages.** `packages/xtrm-app/server/research-cli.ts` is a read-only bridge over the `xtrm-research --json` CLI envelope. `packages/service-knowledge` (Python) and `packages/board-audit` (shell and Python) do not reference System One or `xtrm_research`.

## 2. Runtime and extension boundary

These surfaces would call a System One layer (Recommendation). Each call site is a question. The caller owns the policy and the side effect.

| Caller | Candidate questions | Policy owner (deterministic `on(answers)`) |
|---|---|---|
| Substrate (`packages/substrate`, `sb`) | Duplicate detection, contract executability, readiness hints | Substrate service code. Example: a gated suggestion that a human or claim holder accepts. |
| Specialists (`~/dev/specialists`) | Routing a contract to a specialist role, stall or ask triage | Specialists supervisor code |
| Pi extension (`packages/substrate/integrations/pi/extension.ts`) | Tool-call pre-checks, handoff summaries | Extension handler code |
| Claude plugin (`packages/substrate/plugin/substrate/`, Specialists MCP) | The same checks as the Pi extension, on the Claude surface | Plugin and hook code |
| service-knowledge (`packages/service-knowledge`) | Drift relevance, skill routing | service-knowledge drift engine |
| board-audit (`packages/board-audit`) | Batch board-quality judgments | board-audit flow script |
| sre-ops skill (`~/.xtrm/skills/optional/sre-ops`) | Incident triage classification | The operator. The skill only advises. |

**Rule (binding on every caller).** A System One answer is evidence. It is never authority.

1. A caller does not perform a side effect as a direct result of an answer. The caller first runs a deterministic `on(answers)` that the caller owns, versions, and tests.
2. A System One answer never claims, closes, merges, or transitions a Substrate issue. Only an actor with the authority that the action already requires can do these things.
3. The four events are recorded separately and are never collapsed:
   - the answer (the runtime call record),
   - the policy decision (the caller's `policy_action` record),
   - the side effect (the caller's own ledger, for example a Substrate journal entry or closure),
   - the realized outcome (the runtime outcome record).
4. A missing, failed, or unsupported-type answer (`UnsupportedQuestionTypeError`) makes the policy take its no-answer branch. The answer is never degraded to a default value.

## 3. OQ1: where the package lives

### 3.1 Research owner

**Decision:** `packages/research`, with no change.

Reasons (facts):

- The package already contains the provider-independent `SystemOneBackend` Protocol (`R/system_one.py`).
- It contains the Jev adapter (`R/jev.py`) behind the only remote-send seam, `guards.guarded_send` / `send_through_run`.
- It contains the versioned QuestionSpec and answer schemas, the evaluators with ECE calibration, and blind-label import.
- The pyproject describes the package as "workload-agnostic ... System One research is the first application, not the schema boundary".
- Its only required runtime dependency is `jsonschema`. `typesafe-sdk` is the optional extra `jev`.

### 3.2 Runtime owner

**Decision:** a dedicated package, for example `packages/system-one`. It is not part of `packages/research`, it is not part of Substrate core, and it is not an extension.

Reasons, one per rejected location:

- **Not research.** `emit_system_one_call` requires a `RunHandle` and a per-run `seq`. Every call therefore belongs to an experiment run under `~/.xtrm/research/runs`. A production call has no run. The research guards (mask and redaction versions pinned into a run manifest) exist to protect experiment sends of board data. A production client needs guards that apply to each caller. Putting production traffic in the research store would mix experiment evidence with live decisions.
- **Not Substrate core.** Every Substrate table is issue-scoped (`issue_id NOT NULL`), and Substrate is the work authority. A model client inside Substrate would place answers next to authority, which the PRD forbids. Also, many System One calls are not scoped to an issue (Specialists routing, sre-ops triage).
- **Not an extension.** The Pi extension and the Claude plugin are consumer surfaces. At least seven callers (§2) need the same client and telemetry. An extension would copy the client into each surface.

The runtime package reuses research code and does not fork it. It imports `state_hash`, the `usage_record` vocabulary, and the answer `$defs`. Research then imports runtime logs as runs for calibration.

**Conditions that change this decision:**

- If the research go/no-go does not produce a production caller, do not create the runtime package. The call site stays in research (YAGNI).
- If only one Python batch caller exists (for example board-audit), that caller uses research's library directly. The runtime package is created when a second caller exists or when a TypeScript caller needs it.
- If `typesafe-sdk` stays Python-only while the callers are TypeScript (Substrate, Specialists, Pi, xtrm-app), the runtime package exposes a JSON CLI envelope. This follows the existing `xtrm-research --json` pattern that `research-cli.ts` consumes. A TypeScript library is not required in that case.

## 4. OQ2: which schema owns `request_id` and outcome linkage

**Decision:** the System One call record owns `request_id`. Outcome linkage is owned by a separate System One outcome record that references `(request_id, question id)`. Neither Substrate nor Specialists owns either field.

- **Today (research).** The owner is `R/schemas/event.schema.json` with `kind: "system_one_call"`. The required extension adds the following to `data`: `request_id` (the value of `response.request_id` from `typesafe-sdk`, which `R/transports.py` currently discards), `answers`, and `workload`. It also adds the event kinds `policy_action` and `outcome`, each of which carries `request_id`. This change is additive to `xtrm-research-event/v1`.
- **Future (runtime).** The owner is a runtime event schema (working name `xtrm-system-one-event/v1`). Its call record is a superset of the research `system_one_call` `data`. Research can then ingest it as a run without a translation layer.
- **Local key.** A locally minted call id is also required. `typesafe-sdk` raises `TypeSafeError("The response did not include a request ID.")` when the header is missing, and a request that fails before a response has no provider id. The provider value is stored as `request_id`. The local id is the join key.

Reasons for rejecting Substrate and Specialists as owners (facts):

- Substrate has no `request_id` field (a grep over `S/` finds no match). Its `outcome` column (`issue_closures.outcome`) is a closure enum (`completed, superseded, duplicate, wont_fix, invalid, cancelled, abandoned`) for a work item. Substrate is the *source* of many realized outcomes. For example, a duplicate question resolves when an issue closes as `duplicate`. Substrate is not the link.
- The outcome record references the Substrate source through ids that exist today: `issue_closures.closure_id`, `issue_journal.id`, and `issue_id`. The Substrate side needs no schema change.
- Specialists `specialist_events` is keyed by `job_id` and `seq` for one agent run. Its `jsonrpc_request_id` identifies an MCP request. Research already links to Specialists through `telemetry_refs.specialists_job_id`, and the runtime schema reuses that pattern.
- **Gap to fix in the same change:** `telemetry_refs` has no Substrate reference. Add `substrate_issue_id` and `substrate_closure_id` (nullable) so that an outcome record can cite its source.

## 5. Unresolved questions

- Resolved: TypeSafe returns the resolved model version per call in `response.model` (for example `jev-1.13.0`).
- Should `latency` exclude guard time in runtime? It includes guard time today.
- Partly resolved: `R/evidence_gate/prices.json` (version `2026-09-18.1`) carries a sourced Jev entry. The general price table and response cache remain XTRM-432.

## 6. Changes on the XTRM-492 branch after this map was drawn

- `request_id`, per-call `model_version`, `workload`, the answers, and
  `cost` (from a sourced price table) are now recorded per call.
  `policy_action` and `outcome` exist as separate event kinds, linked by
  `request_id`. The evidence is the XTRM-502 telemetry run and
  `tests/test_evidence_gate_telemetry.py`; `docs/xtrm-99/telemetry.md`
  describes the attachment.
- `risk_class` and `deadline` are still absent. The contract-fit check
  (XTRM-503) found `deadline` load-bearing for the service-knowledge
  activator hook budget.
- `telemetry_refs` still has no Substrate or Claude Code session field.
  This is recorded as a gap and not added: the only research consumer that
  needs it is the telemetry demonstration, and a runtime schema would own
  the field (§4).
- A generative-model budget policy now sits at the transport seam
  (XTRM-508). A frontier or LLM call needs a declared reason, a budget
  scope and room under the scope's caps; otherwise `BudgetError` is raised
  before any process starts. A future runtime inherits this rule; it does
  not re-derive it.
- `Workflow` (`src/xtrm_research/workflow.py`, XTRM-509) is the research
  form of the control loop: state -> one System One request carrying a
  question battery -> `on(answers)` in code -> optional budget-gated
  escalation -> next state. Its records are the §1.3 minimum telemetry
  plus a separate `escalation` record. A runtime package would host the
  same loop without the run store.
