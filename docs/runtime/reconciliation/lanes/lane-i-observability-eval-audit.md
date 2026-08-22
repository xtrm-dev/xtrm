# Lane I — Memory / Eval Core / Telemetry / Console Observability Audit

Lane: lane-i of the XTRM runtime canonicalization programme (bead `xtrm-cn8`).
Read-only audit; outputs under `docs/runtime/reconciliation/lanes/lane-i-*`.
Repo HEADs and blob SHAs: see `lane-i-source-register.json` (companion file).
Eval-subject expansion matrix: see `lane-i-eval-extension-map.json`.

---

## 1. Memory — current ontology and promotion rules

### 1.1 Ontology today (per `core:docs/design/memory-system-r6g.md`, measured 2026-07-17/18)

Four distinct things are called "memory" in the corpus; they must not be conflated:

| # | Surface | Storage | Write path | Read path | Scope |
|---|---|---|---|---|---|
| M-a | `bd remember` durable memory ("raw truth") | Per-repo Dolt under `.beads/` | Any agent, append-only (`bd remember`, `bd forget`) | `bd memories`, `bd recall <key>` (exact key) | Per-repo |
| M-b | Synthesized project memory (r6g calls this "Core") | `.xtrm/memory.md` (~100–200 lines target) | **Only** the `memory-processor` specialist | Auto-read at session start | Per-repo |
| M-c | Claude Code file-based auto-memory | `~/.claude/projects/<slug>/memory/MEMORY.md` + typed files (`user_/feedback_/project_/reference_`) | Agent `Write` tool | Auto-loaded by harness | Per-project-slug |
| M-d | Substrate/console "Memory" entity | substrate `memories` (console product contract §3/§11.4) | Chain coordinator distillation **at chain close** (`type: failure/hint/best_practice/bug`, `created_by_role/job`, `in_container`) | Memory Drawer, failure-cluster queries, FTS5 | Per-container/project |

M-a/M-b/M-c are the r6g audit scope and are mutually disjoint (no read edge from
M-b or M-c back into `bd`). M-d is a separate, close-time-distilled entity used
by the console; the reconciliation amendment (§16 item 4) already demands that
memory canonicalization distinguish *promoted reusable knowledge* from
*session/history/evidence* — M-d sits on the evidence side of that line.

### 1.2 Failure modes inventoried by r6g (verified against its current-state section)

F1 large audits time out (per-key recall ~150–300ms); F2 silent forgets
(count-only completeness gate); F3 inconsistent processor instructions; F4
cross-repo isolation; F5/F11 no semantic retrieval (`bd search` missing); F6 two
schemas/two write paths (M-b vs M-c); F7 no ingestion connectors (git knowledge
invisible); F8 no decay/age signal; F9 no ACL/redaction; F10 no versioning
beyond file git history; plus the W5 safety fixes (schema+key-set validation,
deterministic batching, hash-guarded prune, restore-on-mismatch) which r6g
declares orthogonal and ship-regardless.

### 1.3 Promotion rules (explicit and implied)

- **Explicit tier vocabulary (r6g §4.6, Letta-derived):** Archival = every row in
  `bd`/SQLite index; Recall = recent session reports/ADRs/merged-PR set; Core =
  `.xtrm/memory.md`. The memory-processor is reframed as a **promotion tool,
  not a delete tool**: promotion Archival → Core happens when it rewrites Core;
  deletion becomes rare, evidence-heavy, opt-in, behind W5 safeguards.
- **mem0-derived rule:** ADD-only extraction; conflicts resolved at *retrieval*
  time (freshness/entity/rank fusion), not by deletion. Old-and-wrong rows may
  stay if search ranks them below correct ones.
- **Console-side rule (M-d):** memories are distilled by the chain coordinator
  at chain close only; a memory encoding an anti-regression rule legitimately
  appears in *both* Evidence and Memory drawers (product contract §7.4) — i.e.
  M-d promotion is gated on chain close + verdict evidence.
- **Programme gate:** automatic memory writes are prohibited before precision
  calibration (execution plan §12); memory candidate promotion is evidence-gated
  (reconciliation Phase 5; R1.8 memory promotion/provenance amendment).
- **Proposed (not yet built) schema:** `memory_item {id=content-hash, raw,
  summary, source∈{bd,pr,release,adr,report,hook,user}, kind∈{feedback,project,
  user,reference,howto,do-not-repeat}, tags[], entities[], created_at,
  updated_at, provenance json, content_hash, embedding?}` — a superset of both
  existing typed systems; ship-in-order = PR1 typed `bd remember` flags, PR2 OKF
  frontmatter on `.xtrm/memory.md`, PR3 `bd search` over SQLite FTS5, PR4 MCP
  `memory_*` tools, PR5 report/release connectors; embeddings/cross-repo hub/
  event-log replay gated on operator greenlight.
- **Status:** r6g self-declares "Design / research. Not a plan of record."
  It is the best available statement of the memory ontology but is NOT canon;
  the canon-level obligations are the reconciliation §16.4 canonicalization
  requirement and R1.8.

---

## 2. Eval Core — located canon and current ontology

### 2.1 Location finding (grep evidence)

Grep `"Eval Core|eval-core|eval core"` (-i) across `xtrm/docs`,
`core/docs`, `specialists/docs` produced ~40 hits in **reference/planning
docs only** (`xtrm-local-coordinator-bootstrap.md`, `xtrm-current-execution-plan.md`,
`xtrm-v1-runtime-reconciliation…md`, `native-chain-runtime-audit-2026-08-19/*`,
`current-release-snapshot.md`, `chains-prompt-evals.md`, `enhanced-prd.md`, and
prior lane-b output). **No dedicated standalone `eval-core*.md` document exists
in any of the three trees.** The concept's owning text is a workstream inside
the Specialists roadmap pair:

- **Canonical owner:** `specialists:docs/design/roadmap/enhanced-prd.md`,
  "# 9. Workstream E — Evaluation platform" (§9.1–§9.17).
- **Identical twin:** `specialists:docs/design/roadmap/chains-prompt-evals.md`
  §9 — diff-verified near-verbatim (only list-marker `*` vs `-` and one table's
  column alignment differ). Lane-b classifies chains-prompt-evals as
  superseded-historical overall; its §9 nevertheless remains the fullest
  reference text.
- **Authoritative disposition of the extension question:** native-chain audit
  register **C-09** — "Eval Core is not missing; its subject model is
  incomplete." Native-chain PRD draft §17 adds the governing rule: *"Do not
  create a second eval subsystem. Extend current Eval Core subjects."*
- **Delivery state:** not implemented. Snapshot and execution plan agree: Eval
  Core and `sp eval` are residual; V1.2 scopes eval storage, candidate
  fingerprints, grader interfaces, historical backfill, compare/promotion
  reports, observe-only start; KAN-121 blocks prompt promotion on Eval Core.

### 2.2 Current ontology (Workstream E)

- **Evaluation subject** is not the model: it is the resolved combination
  `model × specialist version × system prompt × mandatory rules × skills ×
  runner injections × tool catalog × permission tier × thinking level × chain
  position × task/environment`, each candidate requiring a deterministic
  fingerprint.
- **Entities (§9.3):** suite (versioned case collection; kind
  regression|capability|telemetry|chain|external), case (pinned task +
  environment_spec + expected_outcome + grader_config + is_held_out),
  experiment (candidate comparison, seed, trials_per_case), trial (one
  candidate × one case × one attempt; carries job_id/chain_id/prompt_hash/
  rules_hash/skills_hash/runtime_version/environment_hash), artifact (ref to
  output/trace/diff/commit/tests/logs/env state), score (one grader × one
  trial × one dimension, with grader version + confidence + evidence_json),
  pairwise comparison (blinded judge preference, winner
  A/B/tie/insufficient_evidence), human annotation (gold label/adjudication/
  override with provenance). Proposed SQLite tables mirror these seven.
- **Evaluation levels (§9.2):** outcome quality; role behavior; chain
  contribution; efficiency/reliability — efficiency reported separately and
  never compensates failed hard gates.
- **Grader hierarchy (§9.6):** environment/state → deterministic trace →
  deterministic artifact → model grader → human adjudication,
  cheapest-reliable-first; model graders must be calibrated against human
  labels and versioned.
- **Hard gates before quality vector (§9.7):** outcome correct / no forbidden
  action / schema valid / no critical requirement missed / no critical
  security-scope violation; then quality vector (contract compliance, role
  adherence, evidence quality, chain-context use, handoff quality, operational
  reliability); then cost reported separately.
- **Role scorecards (§9.8)** for reviewer/executor/seconder/test-engineer/
  researcher/overthinker (false PASS is the primary reviewer safety metric);
  initial suites S01–S08 incl. `telemetry-integrity-v1`; dataset sources =
  real system failures first, then generated mutations; retrospective vs
  continuous evaluation split with recursion exclusion and backfill commands
  (`sp eval backfill --repo .|--all-repos`); paired/factorial A/B design;
  pairwise-judge discipline; statistical reporting requirements; YAML
  promotion policy with hard_requirements (e.g. critical_false_pass_increase: 0,
  regression_suite_lower_bound: 0.97).
- **Forensic eval events (§9.5):** 19 fine-grained names
  (`eval.experiment.started/completed/failed`, `eval.trial.*`, `eval.grader.*`,
  `eval.score.recorded`, `eval.assertion.passed/failed`,
  `eval.comparison.recorded`, `eval.judge.disagreement`,
  `eval.human.annotation.recorded`, `eval.human.override.recorded`,
  `eval.regression.detected`, `eval.promotion.recommended/blocked`).
- **Extension layers already decided (native-chain PRD §17 / C-09):**
  1 SpecialistDefinition/ActivationProfile; 2 ChainDefinition/compiler;
  3 ChainRun/Container; 4 End-to-end promotion — plus whole-chain deterministic
  graders (topology equivalence, no unauthorized transitions, no duplicate
  authoritative activation, no evidence-less satisfaction, no leaked resources,
  recovery state equivalence, message/ack consistency, reproducible digests).
  How each requested subject (compiler determinism … end-to-end outcome) maps
  onto entities/graders/metrics is tabulated in
  `lane-i-eval-extension-map.json`; summary verdict: **no new tables are
  required** — all sixteen subjects fit as new eval_kinds/dimensions plus at
  most additive trial columns (`replay_of_trial_id`, `fault_injection_ref`),
  with ground-truth dependencies only for memory-promotion precision (needs the
  R1.8 promotion ledger) and replay equivalence (needs effect receipts/journal).

---

## 3. Telemetry — `xtrm.forensic.v1` shape and catalog conflicts

### 3.1 Envelope shape (canonical: `xtrm:docs/telemetry/forensic-event-contract.md` v1.0.0)

Required top level: `schema_version:"xtrm.forensic.v1"`, `timestamp` (RFC3339),
`t_unix_ms`, `seq` (monotonic per ordered stream, tie-breaker after timestamp),
`severity∈{debug,info,warn,error,critical}`, `event_family` (bounded taxonomy),
`event_name` (`<family>.<action>` dot-delimited), `event_version`, `resource`
(bounded emitter attrs), `correlation` (high-cardinality by design),
`body`, `redaction{status∈clean|redacted|unknown[,fields,rules]}`. Optional:
`trace`, `otel`, `links`, `diagnostics`. Identity is pinned by kj651 Opp 18 as
five layers: L1 `participant_kind` (bounded, label-safe) / L2
`participant_role` (bounded, label-safe) / L3 `participant_id` (opaque, stable
per `(scope,role)`, derived e.g. `${chain_id}::${participant_role}`) / L4
`job_id` (= activation, new per run) / L5 `turn_id`/`tool_call_id`/`event_id`.
Invariant: same role re-activated in-scope ⇒ identical participant_id, distinct
job_id. Emission must go through one shared envelope writer
(`src/specialist/forensic-events.ts`); hand-built JSON is banned. Families
added 2026-06-13: `chain.incident.*`, `design.review.*`,
`migration.rollback.*` with explicit label-safe vs never-label field splits.
Ordering: sort `(t_unix_ms, seq)` within stream; duplicates idempotent by
`(event_name, correlation.job_id, seq)`; replayed events carry
`body.replayed=true`. Redaction precedes persistence/shipping.

### 3.2 Prometheus low-cardinality projection rule (canonical:
`prometheus-projection-contract.md`; sibling guards elsewhere)

Signal separation is mandatory: forensics answer "what exactly happened";
metrics answer "is the system healthy/trending/SLO-breaching"; traces/exemplars
bridge. Exact-ID discipline: every opaque identifier (`participant_id`,
`job_id`, `bead_id`, `issue_id`, `container_id`, `chain_id`,
`chain_root_job_id/bead_id`, `epic_id`, `node_id`, `pulse_id`, `turn_id`,
`tool_call_id`, `trace_id`, `span_id`, `parent_span_id`, `session_id`,
`conversation_id`, `mcp_session_id`, `jsonrpc_request_id`, `eval_id`,
`policy_decision_id`, `identity_request_id`, `commit_sha`, raw paths/commands/
URLs/error text/diffs/prompts, credentials) is **forbidden as a metric or Loki
label** and lives only in forensic `correlation`/`body`, evidence refs, or
`trace_id` exemplars. Labels come only from the §3.1 allowlist (bounded enums:
service_name, repo, participant_kind/role, state/result/status, model_provider,
allowlisted model, normalized tool_name/mcp_server/mcp_method/error_type,
drift_tier, pulse_kind, direction, policy_kind, action_kind, credential_kind,
eval_kind, chain_template, gate_kind). Metrics use `xtrm_` prefix, base-unit
suffixes, seconds histograms with documented buckets; counters must survive
exporter restarts (persistent cursor + replayable history preferred); gauges
read current state; token totals sum split directions with `direction="total"`
only as unsplit fallback and never mixed; **no USD metric until direct-billing
provenance exists**. Prometheus is explicitly *not* the source of truth.
Parallel statements of the same rule exist in `core:docs/observability/
prometheus-labels.md` (adds `parent_job_id`, `agent_instance_id`, `host_id`,
tmux session/window/pane ids, branch name; adds a >10k-series redesign
threshold) and `console-architecture.md` §8.1 (self-declares "single source of
truth for this repo", deferring to the projection contract upstream). The rule
is consistent everywhere; the *lists* diverge per repo (finding C-6).

### 3.3 Conflicts between the AgentOps event catalog and the forensic contract

- **C-1 MCP emitter liveness (direct contradiction).** Catalog §7 (2026-06-06):
  "specialists now emits live MCP forensic events from the MCP gateway/integration
  path" with a live coverage matrix. Forensic contract §16 follow-up 2: "Add actual
  live MCP emitters … the current bridge only normalizes future `type:\"mcp\"`
  events." Projection contract agrees with the latter ("projection-ready but not
  live"). Two canon docs assert opposite shipped-state for the same surface.
- **C-2 Family-taxonomy drift.** Contract §6 declares the bounded family list and
  states new families require updating it. The catalog defines events under
  families absent from §6: `command.*`, `review.*`, `chain.*`, `epic.*` (the
  console product contract rev 41 even counts "21 families" including those four,
  which §6 does not contain — §6 instead contains `chain.incident`,
  `design.review`, `migration.rollback` which the catalog lacks entirely).
- **C-4 Eval event naming.** Catalog §10.3 defines four coarse events
  (`eval.started/completed/failed/score.recorded`); Workstream E §9.5 defines
  nineteen fine-grained ones including none named `eval.started`. Whichever
  ships, one canon text is wrong; unresolved.
- Minor: catalog `job.created` has no counterpart in the contract's
  TimelineEvent mapping table (acceptable — new-native emission — but the
  family-table gap feeds C-2).

Non-conflicts worth recording: the research note
(`agentops-telemetry-for-specialists.md`) proposing `specialist_*` metric names,
USD burn metrics and `cost_usd` display is superseded by the token-first/no-USD
rule in three canon docs; `observability-metrics.md` v2.0 still documents
`cost_usd` CLI display and self-declares legacy-compat status — consistent, but
a reader must not treat it as current metric design.

---

## 4. Console — operator read-model boundary and second-authority risk

### 4.1 Documented boundary (consistent across five sources)

1. **Ownership split** (infra-console-handoff; observability-spec §A.1):
   xtrm/specialists own metric semantics and label policy; mercury/infra owns
   scrape/storage/alert plumbing; console owns panels/datasource descriptors/
   dashboard JSON/drill-down/approval UX only.
2. **Read-model shape** (console-architecture): UI reads API DTOs only; API
   routes read materialized state only and never advance cursors; the
   materializer (temporary bridge) is the sole writer into `xtrm.sqlite`
   (`substrate_*`, `specialist_*`, `xtrm_forensic_events`,
   `xtrm_evidence_refs`, `materialization_state`); `/api/feed` is a
   cursor-paginated rollup carrying drilldown pointers, never raw
   body/correlation/envelope blobs; future substrate is read live via
   daemon/API with last-successful cache and must **never be copied into a
   second SQLite projection**.
3. **Telemetry boundary LOCKED** (product contract §17): aggregate panels read
   low-cardinality Prom projections; every per-entity view reads the forensic
   layer; per-chain duration/tokens derived from state aggregation by opaque
   `chain_id`, never a Prom label; no authoritative USD.
4. **Anti-second-authority clauses** (observability-spec): console "consumes
   telemetry; it does not own telemetry production"; a missing signal becomes
   `status:"missing_signal"` evidence routed to the owning repo — "It must not
   patch local fake metrics into existence"; upstream names preserved verbatim;
   Grafana linked/deeplinked, "not recreated as the authority"; agent-authored
   dashboards are drafts until operator acceptance; journals stay evidence and
   recommendations become work only through explicit promotion whose blocking
   effect is chosen by runtime effect, not wording. Reconciliation §14
   non-adoption: "making Console a source of truth."
5. **Retirement gating** (daemon-read-model-contract): five named contracts
   (substrate.issue-graph, specialists.activity-evidence, feed.rollups,
   graph.console-joins, source-health.freshness); bridge tables retained until
   each is daemon-served **and** route-to-core parity tested; GitHub adapter
   state is durable external adapter state, never bridge cleanup.

**Verdict:** yes, there is a documented, layered, repeatedly-reaffirmed boundary
against the console becoming a second authority. Its weak points are process,
not prose: the boundary depends on test guards (cardinality fixture, feed-rollup
contract, separation-boundary tests) and on the bridge being genuinely
disposable.

### 4.2 Boundary drift found (contradiction C-3)

The two copies of `console-architecture.md` disagree about who hosts the
runtime: the **xtrm copy** (bridge-era) says `apps/gitboard` is the running
backend/materializer service and `apps/console` owns UI only (and
`apps-console-scaffold-preflight.md` hardens that into scaffold rules); the
**console-repo copy** (post-host-retirement) says `apps/console` is *both* the
production host and UI package, with the composition root at
`apps/console/src/server/index.ts`, one writer lease, `/gitboard` reduced to a
308 redirect. The console-repo `console-observability-spec.md` copy likewise
ends "Console is the deployed service and sole frontend/runtime owner" where the
xtrm copy says "`apps/gitboard` remains reference". The daemon-read-model
contract (2026-07-23) confirms the host migration happened. Consequence: any
reader starting from the xtrm tree is told the opposite ownership model from
reality; the anti-second-authority argument now rests on `packages/core/state`
ownership + writer lease rather than app separation, and the xtrm-side console
docs have not been reconciled to that.

---

## 5. Duplications

- **agentops-suite pair:** `xtrm:docs/specialists/agentops-suite.md` ≡
  `specialists:docs/design/specialist-agentops-suite.md` content-identical
  except frontmatter; the xtrm copy additionally corrupts `§10.1` to `-10.1`
  ("channels -10.1 already rejects body-text authority"). One must become a
  pointer.
- **Eval ontology pair:** enhanced-prd.md Workstream E ≡ chains-prompt-evals.md
  §9 (near-verbatim). Already known to lane-b; recorded here because it makes
  the C-4 eval-naming fix a one-place edit once the surviving text is chosen.
- **Forbidden-label lists:** declared independently in ≥5 docs (projection §3.2;
  forensic §7; core prometheus-labels.md; console-architecture §8.1; handoff
  checklist). Consistent in spirit, divergent in membership (C-6).
- **Console architecture/test-guards/observability-spec/scaffold-preflight**
  exist in both `xtrm/docs/console/architecture/` and `console/docs/architecture/`
  with real drift (C-3), not just formatting.
- **Observability PRDs:** `console:docs/xtrm-observability-prd.md` (platform
  PRD, planning-ready + addendum) overlaps the observability-spec Slices A–F;
  the spec supersedes it functionally (descriptor/query types, approval flow)
  but neither marks the other superseded; the PRD remains the strategic/product
  layer (multi-tenancy, bundle budgets) and the spec the implementation layer.

## 6. Contradictions (summary)

- **C-1** MCP emitter live vs not-live (catalog §7 vs forensic §16 / projection §2).
- **C-2** Family taxonomy: catalog families `command/review/chain/epic` absent
  from contract §6; contract families `chain.incident/design.review/
  migration.rollback` absent from catalog; product contract counts "21 families"
  matching neither exactly.
- **C-3** Console host ownership: gitboard-hosted (xtrm copies) vs
  apps/console-hosted (console repo, confirmed by daemon-read-model contract).
- **C-4** Eval event naming: 4 coarse (catalog §10.3) vs 19 fine-grained (PRD §9.5).
- **C-5** Cost: research note/legacy metrics doc show USD surfaces; canon forbids
  authoritative USD (three docs). Legacy doc is honest about it; research note is not.
- **C-6** Forbidden-label membership differs between core's guardrail (adds
  parent_job_id, agent_instance_id, host_id, tmux ids, branch name) and the
  projection contract (adds pulse_id, turn_id, issue_id, container_id, …);
  console-architecture claims single-source-of-truth status locally while
  deferring upward.

## 7. Unique requirements that survive only in one place (loss risks)

- Forensic contract: the 5-layer identity invariant and L3 derivation rules;
  redaction tri-state semantics; seq/idempotency ordering rules; the three
  2026-06-13 governance families' label-safe field lists.
- Projection contract: durable-counter/replay exporter requirement;
  `direction="total"` fallback mixing ban; USD-until-provenance deferral;
  documented histogram buckets.
- Catalog: `idempotency_key_hash` (hash-not-raw) rule; `evidence_kind` enum
  including `deployment` and `memory`; the new-event procedure (§13).
- Core labels doc: the >10k-series-per-family redesign threshold; the "where
  these fields DO live" list.
- r6g: W5 hash-guarded prune/completeness-gate mechanics; ADD-only vs delete
  framing; the memory_item superset schema; connector priority order.
- Suite design: the hard governance invariant (no specialist edits any
  `.specialist.json`); `sp-improve(<name>)` bead convention as capture-telemetry;
  `metadata.optimization` maturity field; golden-set shadow-mode-first.
- Observability spec: `missing_signal` status with owner routing;
  `ObserveFreshness.cacheStatus` honesty rule; recommendation promotion
  target-class-by-runtime-effect table.
- Daemon read-model contract: the five named contracts and mandatory
  route-to-core parity before wrapper retirement.

## 8. Suggested dispositions

| File | Disposition |
|---|---|
| xtrm telemetry quad (forensic / projection / catalog / handoff) | Keep canon; fix C-1/C-2/C-4 inside them; make projection §3.2 the single forbidden-label source and demote the rest to pointers |
| xtrm agentops-suite.md | Replace with pointer to specialists origin (or vice versa); fix `-10.1` corruption wherever kept |
| specialists agentops-suite design | Keep as design-draft ancestor; annotate which parts were absorbed by Workstream E (golden-set A/B → §9.13; evaluator/diagnostic split → §5 dual-source) |
| specialists observability-metrics.md | Keep as legacy-compat; strip or footnote `cost_usd` display; ensure no new work cites it |
| core prometheus-labels.md | Keep as core-scope guardrail; reconcile member list with projection §3.2 or cross-reference explicitly |
| core memory-system-r6g.md | Keep as design input to R1.8; do not promote to plan-of-record without operator answers to its §6 open questions |
| chains-prompt-evals.md §9 / enhanced-prd §9 | Keep enhanced-prd as owner; leave chains-prompt-evals as historical reference (lane-b disposition stands); resolve C-4 in enhanced-prd only |
| xtrm console-product-contract.md | Keep canon for product surface; refresh §15.1 statuses after C-3 resolution |
| xtrm console-architecture/-test-guards/-scaffold-preflight/-observability-spec copies | Reconcile to post-host-retirement reality or replace with pointers into `console/docs/architecture/` (single home per topic) |
| console daemon-read-model-contract.md | Keep; it is the operative read-model authority |
| console xtrm-observability-prd.md | Keep as product/strategy layer; add explicit "implementation authority = console-observability-spec" cross-link |
| research note (agentops telemetry) | Archive as research-historical; superseded metric names already retracted |

## 9. Open questions

1. Which repository owns the canonical console architecture/set after host
   retirement (C-3)? Until answered, every xtrm-tree console boundary claim is suspect.
2. Who is the single forbidden-label source of truth, and do core's extra
   identifiers (host/tmux/branch) get adopted into the projection allowlist-forbidden
   list or kept repo-local (C-6)?
3. Do eval forensic events converge on the 4-event or 19-event naming (C-4)?
   This blocks V1.2 emitter work.
4. Is the catalog's live-MCP claim (C-1) true in current code, or did the
   gateway emission land after the contract text was written? Needs code check,
   out of scope for a read-only doc lane.
5. Memory: does M-d (substrate close-time memories) fold into the R1.8
   promotion ledger, or stay a separate evidence-side entity? Reconciliation
   §16.4 demands the distinction be canonicalized but does not say how.
6. r6g operator questions remain unanswered (cross-repo hub timing, embedding
   budget, delete-vs-ADD-only, folding M-c into bd) — they change the memory
   ship-in-order.
7. Whole-chain graders need scheduler intent/effect receipts and recovery
   journal semantics (native-chain audit §6 lists these as prototype-only);
   replay-equivalence and duplicate-effect grading are blocked on them.

---

## 12-point closing contract

1. **Files read completely:** xtrm: forensic-event-contract (1046 ln),
   prometheus-projection-contract (419), agentops-event-catalog (360),
   prometheus-infra-console-handoff (128), agentops-telemetry-for-specialists
   (131), specialists/agentops-suite (287), console-product-contract (958),
   console-observability-spec (1124), console-architecture (531);
   specialists: specialist-agentops-suite (323), observability-metrics (152),
   chains-prompt-evals Workstream E (§9 fully, rest header-scanned),
   enhanced-prd (diff-verified §9 + phase sections); core: prometheus-labels
   (64), memory-system-r6g (481); console repo: daemon-read-model-contract
   (179), xtrm-observability-prd (512), console-architecture (50);
   skimmed: console-test-guards (246), apps-console-scaffold-preflight (109).
2. **SHAs:** all blob SHAs + repo HEADs recorded in
   `lanes/lane-i-source-register.json` (25 rows, gathered via
   `git rev-parse HEAD:<path>` per repo; nothing untracked encountered).
3. **Discovered transitively (read beyond the assigned list):** xtrm-v1-runtime-
   reconciliation-and-termination-2026-08-09.md (§13 eval additions, gates),
   native-chain-runtime-prd-draft.md §16–18, native-chain
   source-and-authority-register.md C-09/C-10, xtrm-current-execution-plan.md
   V1.2/KAN rows, xtrm-local-coordinator-bootstrap.md GATE-AUTH, console-repo
   console-architecture.md + daemon-read-model-contract.md +
   xtrm-observability-prd.md, prior lane-b audit (for chains-prompt-evals
   classification).
4. **Excluded and why:** console repo READ_THIS_FIRST (pointer), backend.md /
   deployment.md / console-host-retirement-spec (host/deploy mechanics),
   xtrm-console-visual-contract + graph/* (visual), operations/pr63 (single-PR
   dossier), dependencies/** (dependency dossiers), console-repo copies of
   observability-spec/test-guards/scaffold-preflight (near-duplicates; drift
   recorded, not re-read in full). Full list in register `excluded[]`.
5. **Authority claims:** forensic envelope + identity layers ← forensic-event-
   contract; metric semantics/labels ← prometheus-projection-contract (with
   §8 ownership split); eval ontology ← enhanced-prd Workstream E (C-09 rules
   extension); memory system ← r6g design-input under reconciliation §16.4/R1.8
   gates; console read models ← daemon-read-model-contract + console-
   observability-spec; product surface ← console-product-contract.
6. **Duplications:** agentops-suite pair (content-identical + corruption);
   enhanced-prd §9 ≡ chains-prompt-evals §9; four console arch docs duplicated
   across xtrm/console repos with drift; forbidden-label list in ≥5 docs;
   observability PRD vs spec overlap.
7. **Contradictions:** C-1 MCP emitter liveness; C-2 family taxonomy drift;
   C-3 console host ownership; C-4 eval event naming; C-5 USD surfaces vs
   no-USD canon; C-6 forbidden-label list membership. (Detail §3.3–§6.)
8. **Unique requirements to survive:** listed in §7 (identity invariant, redaction
   tri-state, durable-counter rule, missing_signal routing, parity-before-
   retirement gate, W5 prune mechanics, self-edit invariant, etc.).
9. **Dispositions:** per-file table in §8 (keep-canon / pointer / archive /
   reconcile-to-post-retirement / legacy-compat footnotes).
10. **Open questions:** seven in §9, headed by canonical console-architecture
    ownership (C-3), forbidden-label single source (C-6), and eval event-name
    convergence (C-4).
11. **Evidence paths:** `docs/runtime/reconciliation/lanes/lane-i-source-register.json`;
    `docs/runtime/reconciliation/lanes/lane-i-eval-extension-map.json`; this file.
12. **No canonical files modified.**

