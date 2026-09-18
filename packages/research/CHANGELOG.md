# Changelog — xtrm-research

All notable changes to the `xtrm-research` package.

## [Unreleased]

### Added — reference labeling machinery: brief, sampler and agreement statistics (XTRM-478)
- `agreement.py`: `percent_agreement`, `cohens_kappa` (two-labeler) and
  `krippendorff_alpha_nominal` over an items × labelers nominal label matrix.
  Missing labels go through Krippendorff's coincidence matrix — an item rated
  by two of three labelers still contributes, and a test pins that
  "drop incomplete items" gives a different alpha. Plain Python; no
  numpy/scipy/pandas. `dispatchable_rate_by_length_quartile` reports the
  dispatchable rate per length quartile so verbosity bias is visible.
- `sampling.py`: `stratified_sample(population, target_size, seed)` returns a
  sample spread across score quartiles and strata together with the seed.
  Selection is a hash keyed on `(seed, item_id)`, so the sample is
  reproducible from the seed alone; every non-empty `(stratum, quartile)`
  cell is represented when the target allows.
- `registry/experiment/reference-labeling-v1.json` and the fixed
  `registry/labeler-brief-v1.json`. The brief asks for exactly `dispatchable`,
  `main_gap` and `execution_mode`, its `content_hash` is
  `hashing.compute_content_hash` of its own content, and the experiment
  records that hash so a run states which brief it used.
- Agreement statistics are checked against quoted published worked examples
  (percent agreement 0.70 and Cohen's kappa 0.40 from the standard 50-item
  two-rater example; nominal Krippendorff's alpha 0.743 from Krippendorff's
  2011 12-unit/4-coder example), not against this implementation's output.

### Added — compare metric deltas with per-run tolerance (XTRM-477)
- `views.compare_runs(root, run_ids, baseline_run_id)` now computes real
  per-metric deltas instead of returning runs side by side. Each run's
  summary keeps its existing `metrics`, `sample_count` and `event_count`
  keys unchanged and gains two additive blocks: `deltas` (shared metric
  keys only — `value_delta` = run minus baseline, `baseline_n`, `run_n`,
  `within_tolerance`) and `unpaired_metrics` (`{metric, missing_side}` for
  keys present on only one side, never zero-filled).
- Deltas state no direction of merit: no `improved`/`regression`, no sign
  interpretation — the data does not say whether higher is better.
- Per-run tolerance is read from an optional, non-negative top-level
  `tolerance` on `manifest.json` (`manifest.schema.json` now permits it;
  optional, so every existing run stays valid). `within_tolerance` is
  `true`/`false` against the run's own tolerance, `null` when it declares
  none.
- `compare` refuses runs from different experiments with `ok: false`,
  naming both experiment ids, rather than comparing incomparable metric
  namespaces.
- `compare` gains `--baseline <run-id>`, defaulting to the first listed
  run id so the existing bridge invocation (`compare <ids>`) is unchanged.
  The top level remains a mapping of run id to run summary — no baseline
  id or shared delta block is added beside it, so the app consumer's
  `Object.entries(wire)` mapping keeps working unchanged.

### Added — import recorded Jev outputs as immutable Runs (XTRM-480)
- `importers.py` plus the `import` CLI verb. `import board-duplicates`
  converts a `board-duplicates-v1` `answers.jsonl` (joined to its
  `pairs.jsonl` for the ground truth) into one Sample per pairs row — an
  unanswered pair is an explicit `skipped` Sample, never a silent drop;
  `import contract-quality` converts a `contract-quality-v3`
  `sb-quality-v3.jsonl` into one Sample per contract row, joined to its
  blind label through the sibling `blind-*.labels.json`/`.key.json` pair
  and left `label: null` when there is none.
- Every imported Run records `manifest.backend` as the Jev backend,
  `manifest.code` as the original scripts (`specialists` @ `a6e55215`),
  and `manifest.code.source_hashes` — a `sha256:` content hash of every
  source file read, so the import is auditable without the data.
- A record that cannot be represented is refused by name and leaves no
  Run directory; a `blind-*.labels.json` with no sibling key file is an
  explicit error naming the missing file; a `.bad-mask` source imports as
  an invalid Run that never merges with a valid one.

### Added — System One backend protocol and deterministic baseline (XTRM-475)
- `system_one.py`: the provider-independent contract
  `system_one(state, questions) -> answers`. A backend declares
  `supported_types` and raises `UnsupportedQuestionTypeError` naming the
  type it cannot answer, rather than degrading to a plausible answer; it is
  a `Protocol` class, never a `Callable` parameter, so the package's
  remote-seam guard is untouched.
- Answers validate against `common.schema.json`'s `$defs.choice_answer` /
  `$defs.score_answer` / `$defs.noul_answer`. A Noul answer carries no
  `confidence` field at any point. `score_answer` builds a Score answer
  whose `score` is the probability-weighted mean of the level numbers
  (fractional allowed).
- `DeterministicDupeBackend`: the duplicate-pair baseline ported from the
  original research scripts (commit `a6e55215`), supporting `noul` and a
  two-option `choice` and refusing `score`. Its score is the original
  `sim`: `0.5 * title difflib ratio + 0.5 * token Jaccard` over
  `title + description[:800]`.
- Every completed backend call writes one `system_one_call` event through
  the run's `RunHandle`: `data` carries the backend identifier, each
  question's `content_hash` and `answer_type`, the state hash and
  `latency_ms`; token/cost fields live in the event's `usage` record, with
  `null_reason` `not_exposed_by_provider` for the provider-less
  deterministic backend.

### Added — shipped definitions and question specs (XTRM-476)
- `registry/` ships the real, non-fixture definitions for the two
  experiments named by XTRM-424: `board-duplicates-v1` and
  `contract-quality-v3`. `workload`, `experiment`, `variant` and
  `question_spec` files are all hash-verified and schema-validated by
  `DefinitionRegistry`; `dataset` and `evaluator` definitions arrive with
  the importer and evaluator slices.
- Seven `question_spec` definitions reproduce the wording of the original
  research scripts verbatim from `specialists` commit `a6e55215`
  (`experiments/jev-dupes/dupes.py` and `sb_quality3.py`). Each file
  records its provenance (commit, file, line range) and the wording is not
  tidied.
- `tests/test_shipped_registry.py` walks `registry/` and asserts every
  file loads through `DefinitionRegistry` and validates, every stored
  `content_hash` matches `hashing.compute_content_hash`, and every
  experiment's legend covers its named datasets, variant ids and declared
  status/label vocabularies — dropping any referenced legend entry is
  rejected.

### Added — chart-data, experiments and samples read verbs (XTRM-474)
- `chart-data <run...> --metric <key>` over `views.chart_dataset_rows`:
  one row per run carrying the metric, or an explicit
  `{run_id, state: "no_metric", reason}` entry when the run lacks it.
  Unknown runs and unreadable manifests are `ok: false`, never an empty
  success.
- `experiments --registry-root <dir>` returns `[{id, version}]` read
  straight from the registry directory, so an experiment with zero runs
  is visible; an unreadable registry is `ok: false`.
- `samples <run>` returns the run's `samples.jsonl` records; an unknown
  run or a missing samples file is `ok: false`.

### Added — usage_record cost fields and canonical null_reason vocabulary (XTRM-471)
- `usage_record` gains `cost` (named `cost`, never `cost_usd`) plus
  `cost_currency`, keeping `additionalProperties: false`. A null `cost`
  or `cost_currency` carries a non-empty `null_reason`, like every other
  nullable measurement field.
- `usage_record` gains `cached_input_tokens`, documented in the schema as
  a subset of the `gen_ai.usage.input_tokens` total that is never added
  to it.
- `null_reason` is now a canonical snake_case enum (`no_price_entry` for
  a missing price, `not_exposed_by_provider` for values the provider
  never exposed). The one prose `null_reason` fixture value migrated to
  a canonical value plus `null_detail`, the new optional human-sentence
  string.
- `telemetry.usage_record()` mirrors the new fields; `NULL_REASONS` is
  pinned against the schema enum by `tests/test_enum_parity.py`.

## [0.4.0] - 2026-09-17

### Added — mandatory pre-send guard stage (XTRM-428)
- `guards.py`: the package's only remote-send seam, `guarded_send`,
  enforced by a structural test that scans every module in the package
  for a function taking a `send` parameter or importing a network client
  library. Nothing else in `xtrm_research` may perform or expose a remote
  call.
- Guards: credential redaction on parsed string fields (`redact`,
  `deep_mask` — reproduces the MMD-585 defect fix: redaction never runs on
  serialized JSON, which previously broke escape sequences); known-id
  masking with an abort check (`mask`, `check_mask`) that reproduces and
  catches the 2026-09-17 over-broad-regex defect (an id-shaped regex that
  matched ordinary hyphenated words); configurable label-leak exclusion
  (`LabelExclusionRule`, strip or reject).
- The guard stage fails closed: any exception raised inside it — expected
  or not — aborts the send and is reraised as `GuardFailure`, carrying
  only the failing guard's name and non-secret counts.
- `send_through_run`: runner integration that records a `guard_pass` or
  `guard_failure` event and marks the run `invalid` on failure, through
  the existing `RunHandle` API (no new write path around its lock).
- `guard_versions`: guard versions are content hashes of the active rule
  sets (never hand-set strings), for `manifest.guards` and every guarded
  execution event.
- `cache_key`: folds guard rule versions into a request's cache key, so a
  changed redaction or mask rule can never be served from a
  differently-guarded cached entry. Consumed by XTRM-432.

## [0.3.0] - 2026-09-17

### Changed — review fixes: settle race, torn-tail correctness, schema hardening (XTRM-426)
- **Settle race (breaking, blocker):** `heartbeat`, `finish`, `write_sample`
  and `write_event` now hold a per-run lock (an fcntl.flock on `.lock`,
  wrapped in a same-thread-reentrant `RLock` so nested calls don't
  deadlock) across the gate check, a fresh re-read of `status.json`, and
  the write itself. A concurrent finisher can no longer land between
  another writer's read and its write. `write_json_atomic` now uses a
  unique tmp filename (`tempfile.mkstemp`) instead of a fixed `.tmp`
  suffix, so concurrent writers never collide on the same tmp path.
- **Torn-line repair (breaking fix):** a trailing fragment that already
  parses as JSON (just missing its `\n`) is now kept — a newline is
  appended, nothing is lost. Only a fragment that genuinely fails to parse
  is truncated (never glued onto new data), and the raw dropped bytes are
  now copied into `<file>.torn`, not just their length.
- `retry_run` now forces `intent.trigger = "retry"` and requires every id
  in `retried_sample_ids` to exist among the parent's samples.
- `start_run` rejects an alias-shaped `backend.model`/`model_version`
  unless it's recorded in `manifest.aliases` — defense in depth against a
  hand-built manifest that bypassed `build_manifest`'s own resolution.
  `build_manifest` itself now resolves `model_version` too (not just
  `model`), and any key present in the caller's `alias_resolver` is
  treated as an alias regardless of its shape; the shape heuristic also
  covers `HEAD`, `:latest` and `@latest`.
- `manifest.schema.json` and `status.schema.json` are now
  `additionalProperties: false`, and `run_id`/`assessment_set_id`/every
  definition object `id` must match the allowlist
  `^[A-Za-z0-9][A-Za-z0-9._@:-]{0,127}$` (breaking — narrower than the
  previous no-`..`/no-separators check).
- `null_reason` is now `{type: string, minLength: 1}` inside the null
  branch (null/empty no longer satisfies it, just presence used to).
  Chart specs reject any `url`/`src` key at any depth regardless of value
  (including a relative path); the URL-shape check on `datasets` entries
  now also catches bare `scheme:` prefixes (e.g. `file:/etc/passwd`) and
  leading-whitespace evasion, and is scoped to `datasets` only — `title`/
  `description` may mention a URL in prose. Legend completeness now also
  covers optional `statuses`/`label_values` declarations on
  workload/experiment. `date-time` is validated against a strict RFC 3339
  pattern, not `datetime.fromisoformat`'s more permissive ISO 8601.
- `runs` now reports a run whose `manifest.json` fails to load/validate as
  one row with `status: "invalid_manifest"` and an `error` field, instead
  of failing the whole command; every other row still lists. An argparse
  usage error (unknown/missing argument) now returns an `ok: false`
  envelope with a non-zero exit when `--json` appears anywhere in argv.

## [0.2.0] - 2026-09-17

### Changed — review fixes: immutability, path safety, System One shapes (XTRM-426)
- **Immutability (breaking):** `manifest.json` is now write-once. Lifecycle
  state and heartbeat moved out of the manifest into a new, separate
  `status.json`, which also records the manifest's `content_hash` — every
  write re-checks it, catching an out-of-band edit rather than trusting it.
  Every write (`write_sample`, `write_event`, `heartbeat`, `finish`, and
  constructing a fresh `RunHandle`) now raises once a run's status is
  terminal. `event.seq` is enforced strictly monotonic.
- JSONL writers now repair a torn trailing fragment (truncate + record to
  `<file>.torn`) before appending, instead of ever gluing new data onto it.
- `run_id` and `assessment_set_id` are validated as safe single path
  segments; writes to a nonexistent run raise instead of creating one; an
  assessment set is write-once; assessments must reference real sample ids.
- `validate()` now enforces legend completeness and chart-spec
  dataset/URL rules for every caller (not just a private loader helper),
  runs a timezone-aware `FormatChecker` on every `date-time`, and resolves
  a shared `common.schema.json` (telemetry_refs, usage_record, and the new
  Choice/Score/Noul answer `$defs`) via a local `$ref` registry.
- `question_spec`: Noul's `criteria` is optional; Choice `options` requires
  at least one entry; Score `legend` requires at least one entry.
  `assessment_set` answers are now validated as Choice/Score/Noul
  (`additionalProperties: false`, so `confidence` on a Noul answer is
  rejected) — the trivial evaluator now emits Noul answers.
- `DefinitionRegistry` requires every fixture to carry its own
  `content_hash` (never fills one in silently) and compares versions
  numerically in `latest()`; a duplicate `(id, version)` with a different
  `content_hash` now raises.
- Manifest aliases: `build_manifest` detects an alias-shaped `backend.model`
  (e.g. `jev-latest`) and records it resolved or unresolved automatically.
- CLI: `--root`/`--json` are now accepted both before and after the
  subcommand; every failure becomes an `ok: false` envelope with a
  non-zero exit, never a traceback; `runs --lineage` prints a tree in
  human mode; `tail`/`metrics`/`run show` on an unknown run error cleanly.
- `metrics`/`compare` now include `sample_count`/`event_count` and
  namespace metric keys by evaluator id (`"<evaluator_id>::<metric>"`).
- `Experiment` gained a `named_datasets` field; chart specs may only
  reference datasets it declares.

## [0.1.0] - 2026-09-17

### Added — package skeleton and file-based run contract (XTRM-426)
- Installable package (`pyproject.toml`, `src` layout, `tests/`, README) with
  CLI `xtrm-research`. Every `--json` command returns the
  `xtrm-research-cli/v1` envelope.
- JSON Schemas (source of truth) for WorkloadDefinition, Experiment,
  Variant, Dataset, Evaluator, QuestionSpec, RunManifest, Sample, Event,
  AssessmentSet, Annotation, refs and the CLI envelope.
- Content-hashed, versioned definition object loading and a
  directory-backed `DefinitionRegistry`, with legend-completeness
  enforcement for workloads and experiments.
- A runner API that refuses to start a run without `purpose`/`trigger`, and
  refuses to write samples/events before `manifest.json` is on disk.
- File-based run store: `manifest.json`, `samples.jsonl`, `events.jsonl`,
  `refs.json`, `annotations.jsonl`, `artifacts/`, `assessments/`, with a
  torn-trailing-line-tolerant JSONL reader.
- Run status lifecycle (`started`/`success`/`error`/`invalid`) with a
  reporting-time-only `interrupted` view for a stale heartbeat.
- Immutable assessment sets, append-only annotations, run lineage relations
  and traversal, and derived `metrics`/`compare` views recomputed from
  execution evidence and assessment sets.
