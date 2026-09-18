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

- **A settled run is immutable.** `manifest.json` is write-once and is
  never rewritten after the run starts. Lifecycle state and heartbeat live
  in a separate, mutable `status.json`; once its `state` reaches a terminal
  value (`success`/`error`/`invalid`), every further write to
  `manifest.json`, `status.json`, `samples.jsonl` or `events.jsonl` is
  refused — including through a freshly-constructed `RunHandle`. Retrying,
  re-evaluating or annotating a settled run never mutates that evidence;
  each creates a new run, a new assessment set, or a new annotation row
  instead. Every write re-validates `manifest.json` against the
  `content_hash` recorded in `status.json` at start, so an out-of-band edit
  to `manifest.json` is caught rather than silently trusted.
- **No state reaches a remote model unguarded.** `guards.guarded_send` is
  the package's only remote-send seam; a structural test enforces that no
  other module performs or exposes a network call. Every payload is
  redacted, masked and label-stripped on parsed values before it is
  handed to the injected `send` callable; a guard failure raises before
  `send` is ever called. Guard rule versions are content hashes of the
  active rule sets, recorded in `manifest.guards` and on every
  `guard_pass`/`guard_failure` event, and folded into `guards.cache_key`
  so a changed rule can never be served from a stale cache entry.
  `cache_key` hashes the **pre-guard** payload plus the guard versions
  and `known_ids` — never the guarded/masked output — so a cache lookup
  can happen before the guard stage runs, and two requests that differ
  only in `known_ids` never collide even if they'd guard to identical
  text today. Known limits, both accepted rather than chased with a
  wider rule:
  - The assignment-redaction rule is name-anchored, in two tiers. A
    **strong** keyword (`KEY`, `SECRET`, `TOKEN`, `PASSWORD`, `PASSWD`,
    `CRED`) matches a name that is all-lowercase, all-uppercase, or
    compound (`password`, `TOKEN`, `AWS_SECRET_KEY`) — never sentence
    case (`Password`, `Token:`), since a configuration key is written
    in one of the first three shapes and a prose heading is sentence
    case. A **weak** keyword (`ACCOUNT`, `ACCESS`, `AUTH`, `PRIVATE`,
    `SIGNATURE`, `SALT`, `PASSPHRASE`, `SESSION`) matches only in a
    compound name — `R2_ACCOUNT` and `AWS_ACCESS_KEY`, never a bare
    heading like `Access: the team needs access to staging`, which an
    unqualified weak-keyword list once redacted wholesale. Accepted
    cost of the capitalization rule: a secret assigned to a
    sentence-case name in prose (`Password: hunter2`) is caught only if
    its value itself matches a known format — the same trade as a
    credential assigned to a name carrying none of these keywords at
    all, which is also caught only if the value itself matches a known
    format (a prefixed token, a hex digest, a PEM block, a URL
    credential). An earlier name-agnostic rule covered that second gap
    but redacted ordinary URLs, model ids and version strings instead;
    it was deleted rather than tuned further.
  - An unquoted, multi-word secret assigned in prose (`key: my secret
    phrase`) is not caught: only a quoted value may contain whitespace.
    An earlier, unquoted acceptance let a matching field name treat the
    rest of a prose sentence as its value.
- **Execution is separate from evaluation.** A run captures what happened;
  an assessment set captures what a given evaluator concluded about it —
  new evaluators can assess old runs months later. An assessment set is
  itself write-once: writing an existing `assessment_set_id` raises.
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
- `src/xtrm_research/guards.py` — the mandatory pre-send guard stage:
  credential redaction, known-identifier masking with an abort check,
  label-leak exclusion, and the package's one remote-send seam,
  `guarded_send`.
- `src/xtrm_research/cli/` — the `xtrm-research` CLI.

## Run directory

```
~/.xtrm/research/runs/<run-id>/
  manifest.json       # write-once; fully version-resolved before any sample executes
  status.json           # the one mutable file: lifecycle state, heartbeat, manifest hash
  samples.jsonl           # one row per evaluated item
  events.jsonl              # execution observations, strictly monotonic seq
  refs.json                   # cheap run-identity/lineage index, derived from manifest.json
  annotations.jsonl             # append-only conclusions/caveats/evidence status
  artifacts/                      # created lazily on first artifact write, not eagerly
  assessments/<assessment_set_id>/assessment_set.json   # write-once per set
```

The default root is `~/.xtrm/research/runs`; every API here takes the root
explicitly, and tests always point it at a tmp directory.

Every operator-supplied identifier that becomes part of a path (`run_id`,
`assessment_set_id`) must be a single, safe path segment — no `..`, no `/`,
no absolute paths (`xtrm_research.store.safe_segment`).

Every `.jsonl` writer repairs a torn trailing fragment (from a writer
killed mid-line) before appending: it truncates the fragment off and
records the repair in a sibling `<file>.torn` log, rather than gluing new
data onto it. Readers additionally tolerate a torn *trailing* line on
their own; a corrupt line anywhere else in the file is a real error and
raises.

### `latency_ms` naming

OpenTelemetry's GenAI semantic conventions define `gen_ai.usage.input_tokens`,
`gen_ai.usage.output_tokens`, `gen_ai.request.model` and
`gen_ai.response.model`, all used verbatim in `usage_record`
(`schemas/common.schema.json`). There is no GenAI-standard name for
call latency, so `latency_ms` is this package's own choice — documented
here rather than invented a namespaced pseudo-OTel name.

### `usage_record` cost and null vocabulary

`usage_record` carries an optional `cost` plus `cost_currency` (the field
is named `cost`, never `cost_usd`: the price table carries its own
currency). Money is never computed from token counts here — the price
table is a separate concern.

`cached_input_tokens` is the cached portion of the input token total: a
subset of `gen_ai.usage.input_tokens`, never added to it.

Any nullable measurement field left null must carry a canonical
snake_case `null_reason` (`no_price_entry` for a missing price — the
agreed value; `not_exposed_by_provider` for values the provider response
never exposed). The human sentence that used to live in `null_reason`
now belongs in the optional `null_detail` string. The Python
`NULL_REASONS` vocabulary in `telemetry.py` is pinned against the schema
enum by `tests/test_enum_parity.py`.

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
xtrm-research chart-data <run-id> [<run-id> ...] --metric <evaluator-id::metric>
xtrm-research experiments --registry-root <dir>
xtrm-research samples <run-id>
```

- `chart-data` returns chart dataset rows (`{run_id, value, se, ci95, n,
  method}` per run carrying the metric); a run that exists but lacks the
  metric renders as `{run_id, state: "no_metric", reason}`. An unknown
  run or unreadable manifest is `ok: false`, never an empty success.
- `experiments` returns `[{id, version}]` read straight from the
  registry directory, so an experiment with zero runs is visible.
- `samples` returns the run's `samples.jsonl` records; an unknown run or
  a missing samples file is `ok: false`.

## Known limits

- **content_hash canonicalization.** `content_hash` is computed over
  `json.dumps(payload, sort_keys=True, separators=(",", ":"))`. This is
  stable under key reordering and Unicode escaping, but it is a JSON
  literal hash, not a semantic one: `{"a": 1.0}` and `{"a": 1}` hash
  differently even though the two numbers are equal, because `1.0` and `1`
  are different JSON literals. Definition authors should pick one literal
  form per field and keep it consistent across versions.
- **status.json is advisory, not tamper-proof.** The settle gate compares
  `status.json`'s `manifest_content_hash` against a freshly-computed hash
  of `manifest.json` on every write, which catches an out-of-band edit to
  `manifest.json`. It does **not** protect `status.json` itself: an
  operator who hand-edits `status.json` (e.g. resets `state` back to
  `"started"`) can make a settled run writable again. There is no
  cryptographic seal on either file — this is a cooperative-process
  safety net (catches bugs and races), not a security boundary.

## Non-goals of this package (see XTRM-426 / XTRM-424)

Backends, guards, cache/prices, porting the original experiments, and Pi
capture are separate follow-up issues. This package ships the data contract
and a read/write skeleton, not a full research harness. Performance is not
optimized: the JSONL torn-tail repair rereads the whole file on every
append (see the `ponytail:` comment in `jsonl.py`), and every write path
takes a per-run lock, serializing writes within a run — fine at this
package's scale.
