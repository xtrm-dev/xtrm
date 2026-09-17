# Changelog — xtrm-research

All notable changes to the `xtrm-research` package.

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
