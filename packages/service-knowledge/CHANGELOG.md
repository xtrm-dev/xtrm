# Changelog — service-knowledge

All notable changes to the `service-knowledge` package.

## [Unreleased]

### Fixed — the layout migrator never loses data (XTRM-849)
- **Behaviour change:** `layout_migrator.migrate_pack` now runs a READ-ONLY
  preflight over the whole pack before any mutation. For every service it
  compares the flat tree to the umbrella tree by relative path plus sha256
  (previously only the two `SKILL.md` files, where two missing files compared
  `None == None` and passed). Any differing or flat-only path refuses the pack
  ONCE and lists every offending path of every service; nothing is written,
  moved or regenerated before that verdict. `layout_migrator.py --preflight`
  runs the SAME registry resolution (both registries, merged, compared) and the
  same tree comparison, so the dry run cannot answer `ok` where the real run
  refuses, and it prints every offending path without changing a byte.
  Stated limits of that proof: it compares relative paths and file content —
  file mode, empty directories and the *resolution* of a symlink target are not
  part of the digest, so a mode or empty-dir difference alone does not block a
  dedupe. Nothing is lost when it happens, because the flat tree is moved aside
  whole (modes and empty directories included).
- A malformed registry is now a clean `MigrationRefused` naming the file, not an
  uncaught `JSONDecodeError` traceback (still before any mutation).
- An equal tree is **moved aside** to `<svc>.legacy-<UTC timestamp>` inside the
  pack instead of being `rmtree`d, so a dedupe stays recoverable.
- Two registries must agree on every top-level field and every service entry
  (`skill_path` excluded — the migration rewrites it) or the pack is refused;
  compatible registries merge **by service id**, umbrella copy winning
  `skill_path`. Previously the umbrella copy silently overwrote the flat one.
- `PACK.json` is **kept** and reported. Its retirement is not proof of
  redundancy: nothing in-tree declares its schema, so the migrator cannot show
  that every field it carries is reproduced by the registry. Removing it is now
  a human decision.
- `cli.common._git_mv_or_rename` refuses an existing destination instead of
  letting `git mv` nest the umbrella inside it
  (`service-knowledge/service-skills`, a pack with no registry where the
  resolver looks). `migrate_umbrellas` removes a provably empty destination and
  proceeds; a non-empty destination without a registry is refused with a
  message and both trees are left untouched. `service-knowledge migrate` exits
  1 and names every refused destination when ANY pack is left in the old
  layout — it no longer prints "already migrated" or a bare "migrated" line
  that hides a refusal.

### Fixed — line endings survive every write path (XTRM-850)
- New `scripts/_textio.py`: `detect_newline`, `render_for`, `write_text` and
  `atomic_write` sniff the existing target for `b"\r\n"` and write with the
  matching convention. Reads stay text mode; only the write side is aware.
- Every read-modify-write uses it: `reconcile.atomic_write` (and therefore
  `gated_write` for `SKILL.md`, plus the YAML registry stamp),
  `umbrella_generator.write_umbrella`, `skill_migrator.migrate_skill_file`,
  `layout_migrator` (SKILL.md ref rewrite and registry relocation),
  `bootstrap.save_registry` and `cli.common.rewrite_registry_paths`.
  Previously a CRLF file was silently rewritten as LF. A registry RELOCATION
  sniffs the file it was read from, not the not-yet-existing target, so a CRLF
  flat registry stays CRLF under the umbrella.
- `detect_newline` selects CRLF when the target contains any CRLF pair, not by
  majority: a file with one CRLF line was written by a CRLF writer, and
  re-emitting it as LF would rewrite every line. Lone `\r` cannot be preserved
  (the unchanged text-mode read folds it), and that limit is now stated in the
  helper.
- Not yet converted (outside this issue's enumerated list, follow-up):
  `cli.common` still rewrites `.claude/settings.json` and `.gitignore` through
  a text-mode read-modify-write, so those two files normalise CRLF to LF.
- `bootstrap.save_registry` now writes a trailing newline like every sibling
  registry writer (it previously wrote none).
- `bootstrap.py` and `skill_migrator.py` gained the explicit sibling
  `sys.path.insert` the other scripts already had, so `_textio` imports work for
  standalone runs, package-namespace imports and the vendored consumer copy.

### Changed — drift fails closed on unknown sync history (#334, #408)
- **Migration:** a service with `last_sync` but no (or an unresolvable)
  `last_sync_ref` — the pre-ref registry shape — no longer takes the mtime
  fallback. `scan_drift`, `ci_drift_check` and `service-knowledge drift` now
  refuse (exit non-zero, marker kept) with one error naming **every** such
  service. Verify each service, then record a ref once:
  `drift_detector.py sync <service_id>`. `reconcile` calls `scan_drift`
  unguarded, so it refuses too until the refs are recorded.

## [0.8.0] - 2026-10-19

### Changed — post-merge freshness epic (XTRM-641 decision, B0–B7 board)
- B0: dead consumer post-merge hook resuscitated (relative runtime
  resolution, installer self-check, idempotent repair of legacy
  `service-skills` absolute paths).
- B1: read-time `source_ref`-vs-`HEAD` freshness gate on all read paths
  (sidecar lock, 90 s provisional budget, stale-served telemetry). Local
  freshness is now authoritative at read time; fresh clones self-heal on
  first query.
- B2: marker-only touches-gated `post-merge` sweep (tracked-files-only
  gate, live marker reads, `trigger/range/reason/services/files/timestamp`
  marker schema). No-touch exits <1 s silent; touch writes marker only.
- B3: `post-checkout` (`fresh-cache` on clone/worktree) + `post-rewrite`
  touches-gated hooks; worktree-aware installer (`--all-worktrees`,
  `core.hooksPath` handling, stale-path rewrite, per-worktree self-check).
- B4: reconcile stamps regenerate the umbrella (SEMANTIC preserved);
  `last_sync_ref` takes precedence over wall-clock (skew/cherry-pick).
- B5: CI required check for committed drift
  (`.github/workflows/service-knowledge-drift.yml`); Layer-1-vs-CI
  responsibility split documented in `docs/devops/git-hooks-vs-ci-policy.md`.
- B6: dead `post_merge_reindex.py` purged; drift-contract wording corrected.
- B7: hook-invoked auto-reconcile cut (marker + next-session only).

### Fixed
- Retrieval hyphen/case normalization (XTRM-651): raw `per-page`-style
  queries hit FTS5 `MATCH` syntax (`no such column`); queries are now
  sanitized (quoted alnum tokens) across both FTS5 paths, trigger/intent
  matching, and territory routing.
- Installer preserves foreign hook tails on rewrite (XTRM-652): a consumer
  `.githooks/pre-push` trailing `exit "$_gate_rc"` was truncated; the EOF
  branch now ends at the block `fi` terminator and preserves the tail,
  fail-safe no-op otherwise. Regression-tested.

## [0.6.0] - 2026-07-25

### Added — PR5a: eval corpus + telemetry + alert-to-service routing
- Labeled evaluation corpus at `src/service_knowledge/eval/corpus/` (85 cases including
  the 3 mandated api-gateway regression anchors: invented redaction key set, wrong
  redaction literal, mislabeled `http_request_duration_seconds` label set). Every
  case carries the 8-field §3.9 schema (`query_or_task`, `touched_paths`,
  `expected_services`, `required_evidence`, `forbidden_evidence`, `expected_probes`,
  `cross_repo_required`, `outcome`) plus `expected_verifier` and non-empty
  `provenance`. Cases are drawn from real closed bd issues + merged PRs across
  `~/dev/core` and `~/dev/xtrm`, with a small synthetic-alert tail. Corpus size
  meets the ≥80-case floor; the 3 regression anchors are covered.
- `service_knowledge.eval.metrics` — the 12 §3.9 metrics as pure functions
  (routing precision/recall, retrieval precision@K/recall@K, citation-utilization
  rate, ignored-activation rate, stale-claim escape rate, conflict detection
  recall, verifier FP/FN rates, probe execution rate, time-to-first-correct-
  diagnostic proxy, tokens per successful task) with a `THRESHOLDS` map for the
  green/yellow/red status gate.
- `service_knowledge.eval.harness` — CLI (`python -m service_knowledge.eval.harness
  run --corpus <dir> --output-dir <dir>`) that loads the corpus, calls the shipped
  retrieval + verifier surfaces (falling back to a labels-echo stub when the live
  index is absent — keeps CI runnable without a warm index), computes all metrics,
  and emits `<output-dir>/YYYY-WW.md` with per-metric threshold status,
  unclassified-failure list, and corpus-expansion suggestions.
- `service_knowledge.mcp.incident_routing` — thin advisory-only wrapper: takes an
  Alertmanager-shape payload → extracts hinted service/query tokens → calls
  `knowledge_search` → returns the top-K services + probes as an evidence
  bundle. Never mutates; the PR5b canary policy will build on this surface.
- `.github/workflows/eval-weekly.yml` — cron (Mondays 06:00 UTC) +
  `workflow_dispatch`. Installs the package, runs the harness, uploads the
  weekly report as an artifact, and sticky-comments the summary on the tracking
  issue `service-knowledge eval baseline — weekly reports` (auto-created on
  first run).
- `install/git-hooks/post_merge_reindex.py` — post-merge default-branch hook
  invoking `service-knowledge index rebuild` with a 90s budget (60s target +
  30s slack). Silent no-op off default branch, when no registry present, or
  when the CLI is missing. Never fails the merge.
- Verifier telemetry side-channel: `scripts/verifier/telemetry.py` now writes
  the same per-run record it already prints to stderr to
  `.xtrm/state/service-knowledge/events.jsonl` (`component=verifier`), matching
  the emission surfaces of `knowledge-index` (PR3) and `activator` (PR4). Root
  is resolved via `SERVICE_KNOWLEDGE_CONSUMER_ROOT` env or CWD; best-effort,
  never raises into the caller. No raw claim text, no source content — only
  claim_id-level aggregates + content hashes (matches the pre-existing shape).
- Six new test modules under `src/service_knowledge/eval/tests/`:
  `test_corpus_schema.py`, `test_harness_e2e.py`, `test_regression_anchors.py`,
  `test_baseline_thresholds.py`, `test_incident_routing.py`,
  `test_telemetry_shape.py`.

### Notes
- Baseline metrics on the shipped 85-case corpus (harness in stub-fallback mode
  because no live index is present in the eval sandbox): routing_precision 1.0,
  retrieval_precision@5 1.0, stale_claim_escape_rate 0, verifier FP/FN 0. Once
  a warm index runs the harness live, these degrade to real-world values — the
  first weekly workflow run establishes the real baseline for PR5b canary
  threshold selection.
- Canary auto-merge is deliberately out of scope for PR5a; it ships in PR5b
  (bead xtrm-56flm.7) once operator ratifies thresholds.

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
