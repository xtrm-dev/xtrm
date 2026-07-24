# Changelog — service-knowledge

All notable changes to the `service-knowledge` package.

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
