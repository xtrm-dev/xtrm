# Changelog — service-knowledge

All notable changes to the `service-knowledge` package.

## [0.6.0] - 2026-07-24

### Added — PR5a: eval corpus + telemetry dashboards + alert-to-service routing
- Labeled eval corpus at `src/service_knowledge/eval/corpus/`: 88 cases (≥ 80 floor) spanning the
  §3.9 source categories (closed issues bug+feature, merged PRs, real alerts, incidents, drift
  history, diagnostics, past wrong-command questions) fanned over the 17-service mercury-infra
  shape, plus the **three anchor regression cases** from the observed api-gateway/runners specialist
  failure (`regression-api-gateway-wrong-claims`, `regression-runners-wrong-commands`,
  `regression-alertmanager-stale-webhook`). Every case carries the full §3.9 label set
  (`query_or_task`, `touched_paths`, `expected_services`, `required_evidence`, `forbidden_evidence`,
  `expected_probes`, `cross_repo_required`, `outcome`) and a provenance permalink.
- Eval harness (`service_knowledge.eval.harness`): materializes a throwaway consumer from the corpus,
  builds the real FTS5 index, drives every case through `index.evidence_for_files` (routing +
  retrieval + probes + stale-claim escape) and the PR1 verifier gate (FP/FN accounting), and
  aggregates the **twelve §3.9 metrics** (`service_knowledge.eval.metrics`, exact §3.9 names +
  green/yellow/red threshold bands). CLI: `service-knowledge eval run --corpus … --out …`.
- Weekly report renderer (`service_knowledge.eval.report`): raw values, week-over-week delta,
  threshold status, and corpus-expansion suggestions from unclassified failures. Written to
  `.beads/eval-reports/YYYY-WW.md` (+ JSON sidecar). Baseline week-0 sample report included.
- Retrieval telemetry now covers **every** retrieval surface: `knowledge_get` / `get_full_skill`
  append a `sk_retrieval_events` row + a `component=knowledge-index event=get` line (hashed ref, no
  raw text), and every `skill_activator` invocation appends a best-effort `sk_retrieval_events` row
  (`source_ref=activator`). `knowledge_search` / `evidence_for_files` already recorded via PR3.
- Verifier FP/FN accounting hooks (`scripts/verifier/accounting.py`): confusion-matrix classification
  + `component=verifier-accounting` telemetry, used by the harness for the §3.9 FP/FN rates.
- New MCP tool `incident_routing` (advisory only): Alertmanager-shaped payload → `knowledge_search`
  → top-K candidate services + runbook probes + §3.2 evidence bundle. Label-named services get a
  routing bonus over noisy lexical matches. Performs **no mutation** (canary policy is PR5b).
- `.github/workflows/eval-weekly.yml`: Monday cron + `workflow_dispatch` running the harness,
  publishing the report as an artifact and sticky-commenting the summary on a long-lived tracking
  issue (`EVAL_TRACKING_ISSUE`). Structured telemetry: one `component=eval-harness` line per run +
  one per computed metric.

### Notes
- Post-merge reindex stays wired via PR3's `_rebuild_knowledge_index` hook (advisory, ≤ 60s budget
  enforced by `index/tests/test_timing.py` on the 17-service consumer); real mercury-infra +
  wave-2 consumer measurement is an operator step.
- Input to PR5b: baseline metric bands in `eval/metrics.py THRESHOLDS` inform canary thresholds.
- 90-day telemetry retention: inherits the `.beads/` / `.xtrm/state/` default (no separate policy).

## [0.5.0] - 2026-07-24

### Added — PR4: dispatch integration + PreToolUse activator upgrade (retrieval + narrow blocking)
- The retrieval surface (PR3) is now *demanded*, not passive. `skill_activator.py` no longer
  injects a "please read SKILL.md" reminder: on a territory match it invokes
  `knowledge_evidence_for_files` (`index.evidence_for_files`) and injects the resulting §3.2
  evidence bundle into the PreToolUse context. The matcher is unchanged; the behaviour is replaced.
- Narrow §3.7 block matrix (overblocking pushes agents around the system):
  - Read / Glob / Grep → evidence-inject, **never** block (even on a broken index).
  - Write / Edit in registered territory → block **only** if retrieval fails (broken index, no
    bundle constructible).
  - Bash read-only → evidence-inject, never block.
  - Bash mutating (`rm`/`mv`/`docker rm`/`systemctl`/`kubectl apply`/`gh pr merge` …) → bundle +
    conflict-check; block on a conflicted high-risk claim.
- Blocks fail LOUDLY with an actionable message: which service, which territory, which bundle was
  expected, why retrieval failed, and the operator override path.
- Operator override: `OVERRIDE_KNOWLEDGE_BUNDLE=1` proceeds with a warning and is recorded in
  telemetry as an `override` event with the reason (matches the `--allow-unready` pattern).
- bd-tracking paths (`.beads/**`, `.xtrm/state`, `.xtrm/cache`) never block, so the promotion gate
  cannot lock itself out.
- New `service_knowledge.dispatch` module: evidence-bundle → bead-body renderer using the marker
  block `<!-- knowledge:evidence:BUNDLE_ID -->…<!-- /knowledge:evidence -->` (find / replace /
  strip), deterministic `bundle_identity` (`bundle_id` + `evidence_hash`), and the
  contract-promotion gate.
- Contract-promotion gate (`service_knowledge.dispatch.validate_promotion`, CLI
  `python3 -m service_knowledge.dispatch validate`): a bead whose SCOPE references a registered
  territory cannot leave `contract:draft` without `matched_services` attached. Regex over `bd show`
  output — **no bd schema change**. `matched_services` without a bundle id is advisory.
- Dispatch CLI `python3 -m service_knowledge.dispatch attach --paths …` builds a bundle and attaches
  the marker block to a bead body so a specialist reads it via `bd show` in the same surface as the
  rest of the contract.
- Structured telemetry: `component=activator` and `component=bead-validator` lines in
  `.xtrm/state/service-knowledge/events.jsonl` — `{timestamp, component, event, tool_name,
  service_ids, bundle_id, decision=inject|block|allow|override, override_reason?, duration_ms}`.

### Notes
- Backward compat: in-flight beads created before the gate's effective cutoff (2026-07-24) are
  carried over — the gate applies to draft → ready transitions from this merge, not retroactively.
- NO session cache in this release (deferred pending latency measurement); NO bd schema change.
- Post-merge index rebuild already shipped in PR3 (`post_merge_drift_sweep.py`); unchanged here.
- Cross-repo handoff (NOT in this PR): orchestrator + coordinator specialist `task_template`s under
  `~/dev/specialists/config/specialists/` gain one line — "if the bead body contains a
  `<!-- knowledge:evidence:… -->` marker, treat it as authoritative context; do not re-fetch".

## [0.4.0] - 2026-07-24

### Added — PR2: deterministic verifier gate in reconcile.py + specialist parity
- New `service_knowledge.scripts.verifier.gate` module: the §2.7 6-tier gate lattice
  (`EVIDENCE_RACE` / `INVALID` / `CONFLICT` / `INSUFFICIENT_EVIDENCE_HIGH_RISK` /
  `PASS_WITH_ADVISORIES` / `PASS`) with `compute_gate(manifest, evidence_race=...) ->
  GateDecision`. Deterministic only — **no residual LLM critic** (REVISION 3; deferred to a
  follow-up bead if measured verifier FN > 0.10). `critic_calls` / `critic_tokens` reserved in
  the telemetry schema, pinned to 0.
- `reconcile.py` now gates every SKILL write: the candidate is written to a temp path first,
  the PR1 verifier runs in-process, the gate is computed, and **only `PASS` /
  `PASS_WITH_ADVISORIES` reach `atomic_write`**. New helpers `run_verifier()` (with
  EVIDENCE_RACE fingerprinting) and `gated_write()` (verify → gate → conditional write).
- **Single write path / specialist parity:** `atomic_write` for SKILL content is reachable only
  through `gated_write()`. The `service-skills-sync` specialist, the auto-reconcile workflow and
  the manual CLI all funnel through `reconcile.py`, so a local run cannot bypass what CI
  enforces. No override flag exists (guarded by `test_no_gate_bypass_flag_exists`).
- **EVIDENCE_RACE:** source territory SHAs are fingerprinted at the start + end of each verifier
  run; a mismatch invalidates + retries the whole run once, then fails.
- Verifier CLI `--gate-mode`: emits the gate verdict (JSON `{gate, manifest}` or a Markdown
  banner) and exits non-zero on blocking verdicts (`INVALID` / `CONFLICT` / `EVIDENCE_RACE`)
  for clean CI gating; `INSUFFICIENT_EVIDENCE_HIGH_RISK` exits 0 (draft-PR path).
- GHA workflow template `packages/service-knowledge/.github/workflows/service-skills-drift-sweep.yml`:
  runs the gate **before** `peter-evans/create-pull-request`, publishes `manifest.json` +
  `report.md` as the `service-skills-verify` artifact, adds a `service-skills-verify` status
  check, fails on `INVALID`/`CONFLICT`/`EVIDENCE_RACE`, and opens a draft `do-not-merge` PR on
  `INSUFFICIENT_EVIDENCE_HIGH_RISK`. `PASS` never auto-merges (canary policy is PR5b).
- Gate telemetry: one `component=reconcile-gate` line per decision to
  `.xtrm/state/service-knowledge/events.jsonl` (`event=gate_decision`, verdict + counts +
  service_id + duration_ms; no claim text).
- Docs: `docs/devops/service-knowledge-verifier-gate.md` (lattice + CI gate + override path).

### Fixed
- Package now ships `scripts/verifier/schema/*.json` (and the verifier subpackage explicitly) in
  the wheel. Previously the manifest jsonschema was omitted from non-editable installs, which
  would break `validate_manifest()` / the gate at runtime once `reconcile.py` imports the
  verifier in-process.

## [0.3.0] - 2026-07-24

### Added — PR3: per-repo FTS5 evidence index + read-only MCP tools + cataloger reframe
- New `service_knowledge.index` module: a derived per-repo SQLite FTS5 evidence index at
  `.xtrm/cache/service-knowledge.sqlite`, layered on **vaultctl** (reused for the document
  layer, BM25 search and the wikilink resolution graph) with five `sk_`-prefixed domain tables
  (`sk_items`, `sk_items_fts`, `sk_citations`, `sk_conflicts`, `sk_retrieval_events`,
  `sk_index_state`) — no schema collision with vaultctl, no ATTACH needed.
- Index builder ingests registry entries -> `kind=service` items, SKILL `## ` sections ->
  `kind=section` items, PR1 claim manifests (when present) -> `kind=claim` items, health-check
  probes -> `kind=probe` items, and extracted code/config citations -> `sk_citations`.
- Three read-only MCP tools (`knowledge_search`, `knowledge_get`,
  `knowledge_evidence_for_files`) returning §3.2 evidence bundles (routing header + 3-7 top
  items + citations + verification/freshness + probes + full-skill links). No `answer()`
  endpoint. `knowledge_probes` + `knowledge_conflicts` deferred to follow-up beads.
- Interpretable ranking overlay (§3.5): `score = 0.40 T + 0.30 L + 0.15 I + 0.10 A + 0.05 F`,
  with L pulled from vaultctl BM25 and the post-rank penalty lattice. Weights + penalty
  magnitudes live in `index/ranking.py` (operator-tunable).
- Commit-based freshness `F = exp(-ln(2) * changed_commits / 20)` via git (drift_detector helper).
- Provenance (§3.6): mutable current view via `status`, append-only `sk_retrieval_events`,
  claims flip to `superseded`/`invalidated` on source change, default retrieval excludes them.
- CLI `service-knowledge index build|rebuild|query|stats`.
- Cataloger reframed to "Available operational knowledge sources" with per-service
  `last_sync_ref` + index health + item count + verification coverage; the old
  "Available expert personas" output stays behind `--legacy` for one release cycle.
- Umbrella generator emits `index_state` hash + `generator_version` + OKF per-service envelopes
  (outside the protected SEMANTIC block — regeneration preserves human narrative).
- Post-merge hook rebuilds the index on default-branch merges (index_state.source_ref tracks HEAD).
- Secret scrubbing at ingestion (gitleaks-style): AWS keys, credentialed URLs, tokens, private
  key blocks redacted; `.env` files skipped. Env var NAMES indexed, VALUES never.
- Knowledge-index telemetry (`component=knowledge-index`) to
  `.xtrm/state/service-knowledge/events.jsonl` — query hash only, never raw query text.

### Notes
- vaultctl is now actively wired (declared in PR0, imported here).
- 17-service rebuild benchmarks at ~50ms (budget: <= 60s).

## [0.1.0] - 2026-07-24

### Added
- First-class package elevated from the vendored `service-skills` machinery (previously
  shipped into consumer repos via `xt update --apply`). Own CLI, versioning, release
  cadence, and CHANGELOG. **Not** routed through `xt update --apply`.
- CLI `service-knowledge install|update|status|migrate|remove` (stdlib argparse; does not
  depend on xtrm/bd/sp/xt/xtmux).
- Entry point `service-knowledge = service_knowledge.cli:main`; pip-installable.
- All 11 machinery scripts relocated byte-for-byte (bootstrap, cataloger, deep_dive,
  drift_detector, layout_migrator, reconcile, scaffolder, scope, skill_activator,
  skill_migrator, umbrella_generator).
- `contracts/service_skill_contract.json`, reference SKILLs, `install/` machinery, and an
  empty `mcp/` scaffold (PR3 lands the `knowledge_*` tools).
- Per-invocation telemetry (`component=sk-cli`) to `.xtrm/state/service-knowledge/install.jsonl`.
- Declared dependency on `vaultctl>=0.1.0,<0.2` (wired in PR3).

### Changed — BREAKING (one-time hard break)
- **Umbrella name transition: `<repo>-services` → `<repo>-service-knowledge`.** The per-repo
  umbrella skill is renamed and the umbrella subdirectory moves
  `<pack>/service-skills/` → `<pack>/service-knowledge/`. `service-knowledge migrate`
  performs the rename, rewrites registry `skill_path` refs, and regenerates the umbrella.
  The old `<repo>-services` name is **not** recognized after migration.

### Backward compatibility (one release cycle)
- The machinery resolves the per-repo umbrella under **both** `service-knowledge`
  (preferred) and `service-skills` (legacy fallback), so non-migrated repos keep working
  unchanged. The legacy name is dropped next cycle.
