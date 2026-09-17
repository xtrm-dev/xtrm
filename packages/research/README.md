# xtrm-research

Workload-agnostic experimentation and evaluation platform. Workloads,
experiments, datasets, evaluators, variants and charts are versioned data
contracts over a generic run and observation model. System One research
(Jev/TypeSafe) is the first application, not the schema boundary — a Pi
pruning benchmark can use this package with no System One question at all.

Independent CLI (`xtrm-research`), own versioning, own CHANGELOG. This
package is a standalone research tool: it is not integrated into the XTRM
standard runtime, Specialists runtime, Pi, or xtrm-app.

## Principles

- **A settled run is immutable.** Re-running, retrying, re-evaluating or
  annotating a run never mutates its execution evidence (`manifest.json`,
  `samples.jsonl`, `events.jsonl`); each of those actions creates a new run,
  a new assessment set, or a new annotation row.
- **Execution is separate from evaluation.** A run captures what happened;
  an assessment set captures what a given evaluator concluded about it —
  new evaluators can assess old runs months later.
- **Views are derived, never authoritative.** `metrics`, `compare` and
  chart datasets are recomputed from samples, events and assessment sets on
  every call.

## Install

```bash
cd packages/research
pip install -e '.[dev]'   # or: uv pip install -e '.[dev]'
```

## Layout

- `src/xtrm_research/schemas/` — the JSON Schemas that are the contract.
  Python code validates against these; it does not hand-roll a parallel
  check.
- `src/xtrm_research/definitions.py` — loading and content-hashing
  WorkloadDefinition, Experiment, Variant, Dataset, Evaluator, QuestionSpec.
- `src/xtrm_research/manifest.py`, `runner.py` — building a fully
  version-resolved manifest and refusing to execute samples before it is
  written.
- `src/xtrm_research/store.py`, `jsonl.py` — the run directory layout
  (`manifest.json`, `samples.jsonl`, `events.jsonl`, `refs.json`,
  `artifacts/`) with torn-trailing-line tolerant readers.
- `src/xtrm_research/assessments.py`, `annotations.py`, `lineage.py`,
  `views.py` — assessment sets, append-only annotations, lineage
  traversal, and derived metrics/compare views.
- `src/xtrm_research/cli/` — the `xtrm-research` CLI.

## Run directory

```
~/.xtrm/research/runs/<run-id>/
  manifest.json       # fully version-resolved before any sample executes
  samples.jsonl        # one row per evaluated item
  events.jsonl          # execution observations, monotonic seq
  refs.json              # cheap run-identity/lineage index, derived from manifest.json
  annotations.jsonl       # append-only conclusions/caveats/evidence status
  artifacts/
  assessments/<assessment_set_id>/assessment_set.json
```

The default root is `~/.xtrm/research/runs`; every API here takes the root
explicitly, and tests always point it at a tmp directory.

## CLI

Every `--json` command returns:

```json
{"schema": "xtrm-research-cli/v1", "command": "...", "ok": true, "data": ..., "error": null}
```

```bash
xtrm-research runs --json
xtrm-research runs --lineage <run-id>
xtrm-research run show <run-id> --json
xtrm-research run annotate <run-id> --author me --kind conclusion --text "..."
xtrm-research experiment show <id> --registry-root <dir>
xtrm-research workload show <id> --registry-root <dir>
xtrm-research tail <run-id> --after <offset>
xtrm-research metrics <run-id>
xtrm-research compare <run-id> [<run-id> ...]
```

## Non-goals of this package (see XTRM-426 / XTRM-424)

Backends, guards, cache/prices, porting the original experiments, and Pi
capture are separate follow-up issues. This package ships the data contract
and a read/write skeleton, not a full research harness.
