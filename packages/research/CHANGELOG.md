# Changelog — xtrm-research

All notable changes to the `xtrm-research` package.

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
