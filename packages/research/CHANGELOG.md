# Changelog — xtrm-research

All notable changes to the `xtrm-research` package.

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
