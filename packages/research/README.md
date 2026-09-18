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
- `src/xtrm_research/system_one.py` — the provider-independent System One
  contract (`system_one(state, questions) -> answers`) and the deterministic
  duplicate-pair baseline backend.
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

## System One backends

`system_one.py` defines the provider-independent contract: a backend is a
class whose `system_one(state, questions)` returns answers keyed by
question id. Each question is a QuestionSpec
(`question_spec.schema.json`); each answer validates against
`common.schema.json`'s `$defs.choice_answer` / `$defs.score_answer` /
`$defs.noul_answer`. A **Noul** answer carries `noul` = P(yes) and no
`confidence` field at all — 0.5 means yes and no are equally likely, not
medium intensity; `confidence` is a statistic of the distribution shape and
exists only for choice/score. A backend declares `supported_types` and
raises `UnsupportedQuestionTypeError` naming the type it cannot answer — it
never fabricates a plausible answer for an unsupported type. `score_answer`
builds the one Score shape: `score` is the probability-weighted mean of the
level numbers and may be fractional.

`DeterministicDupeBackend` (`backend_id` `deterministic-dupe-v1`) is the
no-model baseline for the duplicate-pair judgment, ported from the original
research scripts (commit `a6e55215`,
`experiments/jev-dupes/dupes.py`). It supports **noul** — `noul` is the
similarity, read directly as P(duplicate) — and **choice** only when the
option set is exactly two (the first option is read as the affirmative
outcome). It refuses **score**: it has no distribution over levels, and
inventing one would be a fabricated answer. The similarity is the original
`sim`: `0.5 * difflib.SequenceMatcher(None, title_a, title_b).ratio() +
0.5 * Jaccard(token_sets)` over each item's lowercased
`title + description[:800]`, tokens being `[a-z0-9]{3,}` runs.

Every completed call writes exactly one `system_one_call` event through the
run's `RunHandle`. `data` carries the backend identifier, each question's
`content_hash` and `answer_type`, the state hash
(`hashing.compute_content_hash` over the state) and `latency_ms`; token and
cost fields live in the event's `usage` record. The deterministic backend
has no provider, so its `usage` nulls carry `null_reason`
`not_exposed_by_provider`.

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
xtrm-research import board-duplicates --pairs <pairs.jsonl> --answers <answers.jsonl> --run-id <id>
xtrm-research import contract-quality --quality <sb-quality-v3.jsonl> [--labels-dir <dir>] --run-id <id>
```

- `chart-data` returns chart dataset rows (`{run_id, value, se, ci95, n,
  method}` per run carrying the metric); a run that exists but lacks the
  metric renders as `{run_id, state: "no_metric", reason}`. An unknown
  run or unreadable manifest is `ok: false`, never an empty success.
- `experiments` returns `[{id, version}]` read straight from the
  registry directory, so an experiment with zero runs is visible.
- `samples` returns the run's `samples.jsonl` records; an unknown run or
  a missing samples file is `ok: false`.
- `import board-duplicates` and `import contract-quality` convert the
  recorded outputs of the original Jev experiments into immutable Runs
  (see _Importing recorded Jev outputs_ below). Both are `ok: false` with
  a named error for any source record that cannot become a Sample.

### Importing recorded Jev outputs

`importers.py` turns the recorded outputs of the original Jev experiments
(`~/dev/specialists`, commit `a6e55215`) into ordinary immutable Runs — one
Sample per recorded row — through the same `start_run`/`write_sample` path
every other Run uses. Nothing is re-run and nothing is scored; this slice
produces Runs only. Both importers:

- record `manifest.backend = {provider: "jev", model: "jev-latest", ...}`
  (the alias is recorded unresolved, never claimed pinned) and
  `manifest.code = {repo: "specialists", commit: "a6e55215", ...}` — the
  Run names the scripts that produced the answers, not the platform;
- record `manifest.code.source_hashes`, a `{path: sha256:...}` map over
  every source file read, so the import is reproducible and auditable
  without the data;
- refuse, naming the record, when a record cannot be represented, and
  create no Run directory in that case.

`board-duplicates-v1` (`import board-duplicates`): one Sample per row of
`pairs.jsonl`, in file order, joined to its `answers.jsonl` row for the
recorded Jev answer. A pair with no recorded answer imports as an explicit
`"status": "skipped"` Sample (with no `output`), never a silent drop. A
pair whose ground truth disagrees with the answer row, a repeated `(a, b)`,
or an answer with no pair is refused. Sample shape:

```json
{
  "schema_version": "xtrm-research-sample/v1",
  "sample_id": "dupe-alpha-1--alpha-2",
  "index": 0,
  "input": {"a": "alpha-1", "b": "alpha-2", "label": 1,
            "kind": "superseded", "baseline": 0.8123},
  "output": {"noul": 0.93, "choice": "same_work",
             "probs": {"same_work": 0.9, "one_covers_other": 0.05,
                       "related_distinct": 0.03, "unrelated": 0.02},
             "conf": 0.91},
  "status": "ok",
  "created_at": "2026-09-17T12:00:00+00:00"
}
```

`contract-quality-v3` (`import contract-quality`): one Sample per row of
`sb-quality-v3.jsonl`, joined to its blind label through the sibling
`blind-*.labels.json` / `blind-*.key.json` pair on `(board, key[id])`. A row
with no label imports with `"label": null` (unlabelled, never guessed). A
label file with no sibling key file is an explicit error naming the missing
file. Sample shape:

```json
{
  "schema_version": "xtrm-research-sample/v1",
  "sample_id": "contract-core--CORE-101",
  "index": 0,
  "input": {"board": "core", "ref": "CORE-101",
            "evidence": {"problem_symbols": 2,
                         "problem_symbols_missing": ["fake_widget"],
                         "paths_not_in_repo": []},
            "label": {"id": "C-001", "dispatchable": "yes",
                      "validation_proves_success": "yes",
                      "execution_mode": "repo_only", "main_gap": ""}},
  "output": {"executable": 0.82, "open_decision": 0.1,
             "validation_covers_success": 0.74, "self_blocked": 0.02,
             "execution_mode": "repo_only"},
  "status": "ok",
  "created_at": "2026-09-17T12:00:00+00:00"
}
```

A source file whose name ends `.bad-mask` (the mask check that aborted a Jev
run) imports as an **invalid** Run: its samples are preserved as evidence but
its `status.json` state is `invalid`, so it is never merged with a valid Run
and a metric read must not include it. Importing onto an existing `run_id` is
refused by `start_run` and never merges into the existing Run.

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

Backends beyond the deterministic duplicate baseline, guards, cache/prices,
porting the original experiments, and Pi capture are separate follow-up
issues. This package ships the data contract, a read/write skeleton and the
System One backend seam — not a full research harness. Performance is not
optimized: the JSONL torn-tail repair rereads the whole file on every
append (see the `ponytail:` comment in `jsonl.py`), and every write path
takes a per-run lock, serializing writes within a run — fine at this
package's scale.
