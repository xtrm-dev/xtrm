---
title: Console Data Handoff — Specialists runtime vs Gitboard materializer
project: xtrm
area: console
status: handoff
created: 2026-06-04
updated: 2026-06-09T01:35
source_of_truth_for:
  - "what the xtrm console needs, split by owner: specialists runtime emission vs gitboard materializer projection"
related:
  - console/console-product-contract.md
  - telemetry/agentops-event-catalog.md
  - telemetry/prometheus-projection-contract.md
  - telemetry/prometheus-infra-console-handoff.md
tags:
  - xtrm
  - specialists
  - gitboard
  - materializer
  - console
  - forensic
  - telemetry
---

# Console data handoff — two owners

The console renders specialist activity as a per-job **activity card** (live forensic
stream while running; on completion: verdict + role path + view-details + result + files/diff),
a unified cross-source **Feed**, and **Operations** aggregate panels.

A first version of this handoff targeted the `specialists` repo wholesale. That was too coarse.
**The work splits across two owners**, and most of it lands in the **gitboard materializer**, not
in specialists. This document is the corrected split.

## 0. The split, in one paragraph

Only the **specialists runtime** can *emit* the events it alone observes — that sets the **ceiling**
on how rich the forensic stream can be. Everything downstream of that — **normalizing** to the
`xtrm.forensic.v1` envelope, **deriving** files/diff from git, **merging** cross-source, the
**read endpoints**, and the **table-derived metrics** the console reads — is **gitboard materializer**
work, because gitboard already owns the cross-source read model (beads + specialists `observability.db`
+ github + git) that the console consumes. **Gitboard normalizes and projects; it never fabricates
events the runtime never recorded.**

## 1. Ownership matrix

| Need | Owner | Notes |
|---|---|---|
| Emit `xtrm.forensic.v1` events as work happens (`job.*`, `tool.call.*`, `command.*`, `review.verdict.*`, `model.token_usage.recorded`, policy/identity/eval) | **specialists / runtime** | Only the runtime observes these. At minimum, record them so they're recoverable. This is the richness ceiling. |
| Define the semantic contract (event families, body fields, redaction, label policy) | **specialists** (catalog + projection contracts) | Already written in `telemetry/`. |
| Normalize recorded events (or legacy timeline) into the `xtrm.forensic.v1` envelope for the console | **gitboard / materializer** | Projection contract §2 explicitly allows reading legacy timeline + normalizing through the envelope. |
| `GET /jobs/:job_id/feed-events` (ordered, normalized) and `GET /api/feed` (cross-source merge) | **gitboard / API** | Same admin gating as `/result`. |
| Files/diff per run (changed-file list +/−, diff hunks, commit SHA, PR id) | **gitboard / materializer** | Comes from **git** — gitboard already materializes git/github. Not a runtime concern beyond emitting `command.completed{git}` / `worktree.merged`. |
| Join `specialist_job_metrics` (turns/tools/model + token split) into `SpecialistJob` | **gitboard / materializer** (data **recorded** by runtime) | `loadJobs()` currently returns `NULL` for turns/tools/model — wire the join. |
| Table-derived low-cardinality metrics for Operations panels | **gitboard / materializer** (semantics from specialists) | Projection §6.2 already describes table-derived counters; the console reads these. |
| Canonical `sp metrics --prometheus` / `sp serve /metrics` exporter + infra scrape | **specialists** + **mercury/infra** | Unchanged; for infra dashboards/alerts. |
| `trace_id` assignment + propagation in events | **specialists / runtime / core** | gitboard stitches job→chain where derivable. |
| Prometheus deploy / scrape / Grafana / Alertmanager | **mercury/infra** | Unchanged. |

## 2. Specialists / runtime — the genuine dependency

This is the only part gitboard cannot do. Emit (or durably record) the AgentOps catalog families
with the `xtrm.forensic.v1` envelope:

- families: `job.*`, `tool.call.*`, `command.*` (incl. `command_kind=git`), `review.verdict.*`,
  `model.token_usage.recorded`; later `process.*`, `worktree.*`, `mcp.*`, `pulse.*`.
- per event: `event_family`, `event_name`, `resource` (`participant_kind`, `participant_role`),
  `correlation` (`job_id`, `chain_id`, `issue_id`, `trace_id`, `span_id`), `body` (catalog *Body fields*),
  `redaction`.
- record `specialist_job_metrics` (turns, tools, model, token split + `usage_source`).
- assign/propagate `trace_id` / `span_id`.

**Until these are recorded, the console can only show what exists.** Today `specialist_job_events`
holds only `result` / `terminal_output` — so the live stream and "view details" are gated on this.

## 3. Gitboard / materializer — most of the work

Everything the console actually reads. Can proceed **now**, in the gitboard repo, against what's
already recorded (normalizing legacy where the rich events aren't emitted yet):

- **Normalize** `specialist_job_events` (and legacy timeline) → `xtrm.forensic.v1` envelope, with body + redaction.
- **`GET /jobs/:job_id/feed-events`** — ordered `(t, seq)` normalized events for one job (today only the latest `result`/`terminal_output` is exposed via `/result`).
- **`GET /api/feed`** — cross-source, time-ordered, cursor-paginated merge of specialist forensic + bead interactions + materialized GitHub events. Activity-rollup granularity (one row per meaningful unit), not a raw firehose.
- **Files/diff per run** — derive the changed-file list (path + added/removed counts) and diff hunks from **git**; surface `commit`/`pr` evidence. Paths/diff live in the forensic body/links — never as metric labels.
- **Job metrics join** — wire `specialist_job_metrics` so `SpecialistJob` carries turns/tools/model/tokens (currently `NULL` in `loadJobs()`).
- **Table-derived metrics** for Operations (semantics per projection contract):
  - `xtrm_chains_total{chain_template, result}`, `xtrm_chain_duration_seconds{chain_template, result}`;
  - confirm/derive `xtrm_jobs_total`, `xtrm_job_duration_seconds`, `xtrm_llm_tokens_total{direction}`, `xtrm_gate_verdicts_total`, `xtrm_evidence_refs_total{evidence_kind}`;
  - allowlist `chain_template` + `gate_kind`; `participant_role`/`participant_kind` primary; **no `*_usd_total`** (cost = token-derived estimate);
  - chain/per-job rollups derived by `chain_id`/`job_id` at the read-model layer — never Prometheus labels.

## 4. Boundary (mandatory)

- Gitboard **normalizes and projects**; it does **not** synthesize events the runtime never recorded.
- Drill-down to a specific chain/job/file/diff goes through forensic events + evidence (which keep
  correlation IDs and paths), **never** through Prometheus labels. Forbidden as labels: `job_id`,
  `chain_id`, `bead_id`, `issue_id`, `trace_id`, `span_id`, `tool_call_id`, raw path/command/diff
  (projection §3.2).

## 5. Definition of done

- specialists records the catalog events (+ metrics + trace_id) — the richness ceiling is in place.
- gitboard exposes `/jobs/:id/feed-events` (normalized + redaction) and `/api/feed`.
- a finished job exposes: verdict, role path, full event stream, result, changed-file list (+/−), inline diff, commit/PR refs.
- job metrics non-null; new metrics pass cardinality/label tests; `chain_template`/`gate_kind` allowlisted; no USD; `trace_id` available as exemplar/correlation.
