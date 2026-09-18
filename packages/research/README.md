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

The Jev backend talks to TypeSafe through the optional `typesafe-sdk`
(`pip install -e '.[jev]'`). The package and its full test suite import
and pass without it — CI never installs it.

## Layout

- `src/xtrm_research/schemas/` — the JSON Schemas that are the contract.
  Python code validates against these; it does not hand-roll a parallel
  check.
- `src/xtrm_research/definitions.py` — loading and content-hashing
  WorkloadDefinition, Experiment, Variant, Dataset, Evaluator, QuestionSpec.
- `registry/` — the definitions this package ships (see below).
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
- `src/xtrm_research/jev.py` — the Jev/TypeSafe System One backend. It
  *names* the transport it wants and never imports the SDK.
- `src/xtrm_research/transports.py` — the only module that imports a
  provider SDK, and the only home of a concrete send function; `guards`
  resolves a transport name here. Imported by `guards.py` alone.

- `src/xtrm_research/sampling.py` — the seeded, reproducible stratified
  sampler for the reference labeling campaign.
- `src/xtrm_research/agreement.py` — percent agreement, Cohen's kappa and
  nominal Krippendorff's alpha over an items × labelers matrix, plus the
  dispatchable-rate-by-length-quartile report.
- `src/xtrm_research/cli/` — the `xtrm-research` CLI.

## Shipped registry

`registry/` holds the real (non-fixture) definitions, one subdirectory per
kind exactly as `definitions.DEFINITION_KINDS` names it. The definitions
shipped today cover the two experiments named by XTRM-424:

| kind | ids |
| --- | --- |
| `workload` | `board-duplicates` v1, `contract-quality` v1 |
| `experiment` | `board-duplicates-v1` v1, `contract-quality-v3` v1 |
| `variant` | `baseline` v1, `jev-latest` v1 |
| `question_spec` | the seven judgments the source scripts ask (below) |

`dataset` and `evaluator` definitions are still absent from the shipped
registry: the `evaluator` callables ship in `evaluators.py` (see
_Evaluators_ below) but their versioned definition files are a later slice,
and the importer owns the dataset side, so there is nothing registry-shaped
to ship for those kinds yet. A definition file carries its own
`sha256:`-prefixed `content_hash` (via `hashing.compute_content_hash`);
`DefinitionRegistry` verifies it and raises on mismatch, so hand-editing a
file without recomputing its hash is caught rather than trusted.

Each shipped experiment's `legend` covers every `named_datasets` entry,
every variant id, and every declared `statuses`/`label_values` value — a
completeness rule `schemas.validate()` enforces beyond JSON Schema, and
`tests/test_shipped_registry.py` locks by walking the directory (a new file
is covered automatically).

## Evaluators

`evaluators.py` ships the evaluator callables. `exact_match_evaluate` is
the trivial deterministic evaluator that exercises the assessment-set
path. Two parity evaluators reproduce the metric formulas of the original
Jev scripts at `specialists` commit `a6e55215`, so an offline replay can
reproduce the reference numbers to within 0.0005:

- `board_duplicates_evaluate` reproduces `experiments/jev-dupes/dupes.py`
  `report()`: `auc.baseline`, `auc.jev_noul`, `auc.jev_choice`,
  `brier.{jev_noul,jev_choice}`, `ece.{...}`, `precision.{...}`,
  `recall.{...}` and `mean_p_redundant.<kind>`.
- `contract_quality_evaluate` reproduces `sb_quality3.py` `report()`:
  `p10|median|p90.<field>`, the five `auc.*` scores against the blind
  `dispatchable` label, `auc.validation_covers_success`, and
  `execution_mode_agreement`.

Both are aggregate metric evaluators: they return `([], metrics)` and the
caller writes the result through `assessments.write_assessment_set`, so the
metrics land in assessment sets and are visible to `views.run_metrics` and
`xtrm-research metrics`. `PARITY_EVALUATORS` maps the experiment id to its
callable.

The formulas keep the source's deliberate choices, not the textbook ones:
half credit for tied AUC pairs, ten fixed-width ECE bins indexed by
`min(int(p * 10), 9)` and divided by the whole sample count, the
`max(1, tp + fp)` precision guard, and `sorted(values)[len // 10]`,
`[len // 2]`, `[9 * len // 10]` order statistics with no interpolation.
Nothing rounds; the originals round only at print time. Every metric
reports `se`/`ci95` as `null` because the originals compute a point estimate
only, and each `method` string says so.

Two source details are carried over verbatim. A `board-duplicates` Sample
with `status != "ok"` (the importer's `skipped` pair) is excluded from
every metric, because `dupes.py` reads `answers.jsonl` and never sees such
a pair at all. And `execution_mode_agreement` counts matches over every
joined row in its numerator but divides by the number of labels that carry
an `execution_mode`. An empty-class AUC is `nan` in
`contract_quality_evaluate` (matching `sb_quality3.py`) and a division by
zero in `board_duplicates_evaluate` (matching the unguarded `dupes.py`).

### Question wording provenance

The question wording is the experiment, not a paraphrase: each
`question_spec.instructions` and `criteria` string is reproduced verbatim
from the original research at `specialists` commit `a6e55215`
(`experiments/jev-dupes/`), including the assembled text of Python implicit
string concatenation. Every definition also carries a `provenance` object
naming the commit, file and line range.

| question_spec id | source file | line range |
| --- | --- | --- |
| `board-duplicates.redundant` | `dupes.py` | instructions 132-134 |
| `board-duplicates.relation` | `dupes.py` | instructions 136; criteria 138-141 |
| `contract-quality.executable` | `sb_quality3.py` | instructions 82-84 |
| `contract-quality.execution_mode` | `sb_quality3.py` | instructions 86; criteria 87-89 |
| `contract-quality.open_decision` | `sb_quality3.py` | instructions 91-92 |
| `contract-quality.validation_covers_success` | `sb_quality3.py` | instructions 94-95 |
| `contract-quality.self_blocked` | `sb_quality3.py` | instructions 97 |

Several instructions name state keys the original scripts supplied at
runtime — `issue_a`/`issue_b` (`dupes.py:158`), `standard`
(`sb_quality3.py:125-126, 17-27`) and `ticket` (`sb_quality3.py:125-126`).
Those keys are part of the question's wording and are not renamed here;
their providers arrive with the importer/backend slices.

## Reference labeling machinery (XTRM-478)

The v3 labels behind `contract-quality-v3` came from one labeler whose
strictness drifted between batches, so the reported AUCs measure agreement
with that labeler, not correctness. The independent-labeler campaign of
XTRM-430 needs a reference label set with a measured agreement number.
This package ships the offline half of that campaign — everything the
campaign runs on, and none of the confidential data it reads:

- `registry/experiment/reference-labeling-v1.json` — the labeling
  experiment: three independent labeler variants over the `contract-quality`
  workload, reporting `percent_agreement`, `cohens_kappa`,
  `krippendorff_alpha` and `dispatchable_rate`. It validates against
  `experiment.schema.json` and loads through `DefinitionRegistry`, and it
  carries no board text.
- `registry/labeler-brief-v1.json` — the first fixed brief every labeler
  gets. It asks for exactly `dispatchable` (yes/no), `main_gap` and
  `execution_mode`, and its `content_hash` is
  `hashing.compute_content_hash` of its own content. The experiment records
  that hash under `labeling.brief.content_hash`, so a run can always state
  which brief it used. v1 is frozen: it is hashed, runs reference it by
  hash, and it is never edited or regenerated.
- `registry/labeler-brief-v2.json` — the corrected brief (XTRM-485), shipped
  alongside v1 rather than replacing it. It asks for the same three fields
  but matches Jev's `executable` question; see
  "labeler-brief-v2: matching Jev's executable question" below.
- `sampling.stratified_sample(population, target_size, seed)` — draws a
  sample spread across the population's score quartiles and strata, and
  returns the seed alongside the sample. Selection is a hash keyed on
  `(seed, item_id)` with no RNG state, so the sample is reproducible from the
  seed alone; `assign_quartiles` is the rank-based quartile split it uses.
- `agreement.percent_agreement`, `agreement.cohens_kappa` and
  `agreement.krippendorff_alpha_nominal` — nominal agreement over an
  items × labelers matrix. Missing labels are handled by Krippendorff's
  coincidence matrix: an item rated by two of three labelers still
  contributes, and dropping incomplete items gives a different alpha (a test
  pins that difference). Plain Python; no numpy/scipy/pandas.
- `agreement.dispatchable_rate_by_length_quartile(labels, lengths)` — the
  dispatchable rate per length quartile, so a labeling run's verbosity bias
  is reported rather than assumed absent.

### Published worked examples the statistics are checked against

Every expected value below is quoted from the source in the test; no
statistic is checked against this implementation's own output.

| statistic | source | expected value |
| --- | --- | --- |
| percent agreement | Wikipedia, "Cohen's kappa" worked example (50 items, 2 raters, table `[[20, 5], [10, 15]]`) | 0.70 |
| Cohen's kappa | the same example; Cohen, J. (1960), *A coefficient of agreement for nominal scales* | 0.40 |
| Krippendorff's alpha (nominal) | Krippendorff, K. (2011), *Computing Krippendorff's Alpha-Reliability*, 12-unit/4-coder example | 0.743 |

Perfect agreement is asserted to give alpha 1.0, and two labelers drawing
independently from the same distribution are asserted to land within 0.05
of 0.

The brief must not reward length. That was checked mechanically, not by
reading: `tests/test_labeling_registry.py` scans the brief text for
length-incentivizing phrases (`thorough`, `detailed`, `in detail`,
`comprehensive`, `as much`, `word count`, `verbose`, `explain your`) and
asserts none appear, and asserts the `main_gap` cap — "at most 15 words" —
is present.

### labeler-brief-v2: matching Jev's `executable` question (XTRM-485)

v1 asked a materially different, directionally biased question from the Jev
`executable` question it is compared against. v1 asked whether a worker
could complete the work "from the item text alone", so any fact a competent
worker could find in the repository counted as a gap. Jev asks whether a
worker **with repository access** could execute the ticket, and its second
sentence decouples *needing another party* from *being executable*. v2 keeps
the three-field shape and the same `id`, and changes the wording field by
field. v1 stays byte-identical; the stored v1 hash is unchanged and a test
pins it.

| field | v1 | v2 | why |
| --- | --- | --- | --- |
| `dispatchable` (predicate) | `"yes"` if a fresh worker could complete the work from the item text alone, without asking a question or waiting on another decision | `"yes"` if a fresh, competent worker **with repository access** could execute the item correctly without any chat history; `"no"` if not; `"abstain"` only when the item states too little to decide | repository access stops a repo-discoverable fact counting as a gap; removing "waiting on another decision" stops `dispatchable` from being coupled to `execution_mode` by construction |
| `dispatchable` (softener) | absent | Jev's still-counts clause, byte-identical to `sb_quality3.py` at `a6e55215`: "Work that needs live systems or an operator still counts when the ticket states exactly what to do, in what order, and how to prove it." | decouples needing an operator or live systems from being executable |
| `main_gap` | a gap only when `dispatchable` is `"no"` | adds an `abstain` branch: the fact the item leaves unstated that blocks a decision | an instrument with no abstain option converts uncertainty into a confident label |
| `execution_mode` | the three bare option names | the three option names each carrying Jev's criteria text verbatim, plus a structured `criteria.execution_mode` block | a bare name gives the labeler no criteria; the criteria are the instrument |
| `criteria` | absent | `{"execution_mode": {"repo_only": ..., "live_environment": ..., "operator_or_other_team": ...}}`, parsed out of `sb_quality3.py` by `ast` | gives the test a machine-checkable copy of the exact Jev strings |
| output format | "Return exactly three fields." | the full JSON instruction, inside the brief: `{"dispatchable": "yes" \| "no" \| "abstain", "main_gap": ..., "execution_mode": ...}` | the JSON instruction used to live in the campaign's prompt builder, so the hash did not cover the part that decides whether an answer counts |
| `abstain` outcome | absent | a third `dispatchable` value, distinct from `"yes"` and `"no"`, with a stated condition | lets the instrument decline to guess |

The softener is pinned **byte-for-byte** to the a6e55215 source, and the
decision predicate is scanned separately for `operator`, `another team` and
`waiting on a decision`, so the independence check does not depend on
paraphrase. `tests/test_labeler_brief_v2.py` parses `questions()` out of
`sb_quality3.py` with `ast` and literal-evaluates the executable wording and
the execution_mode criteria dict; it never reads a transcription.

v2 is not wired into `reference-labeling-v1`: that experiment records v1's
hash, and changing it would split an existing sample. A future campaign
would point a new experiment at v2's `content_hash`; whether to re-label is
a separate decision with its own cost.

#### Contract defect found during execution

The bead's original VALIDATION 3 asked for a whole-text token scan asserting
that v2's `dispatchable` text "mentions neither an operator nor another team
nor waiting on a decision", while SUCCESS 2 required the same text to carry
Jev's softener verbatim — and Jev's softener contains the word `operator`.
The two could not both hold. The resolution (coordinator, XTRM-485) keeps
Jev's wording verbatim and scopes the independence scan to the decision
predicate, with the softener pinned byte-for-byte to the source instead.
This is the sixth contract in the epic that named or demanded something that
could not hold.

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

### Jev / TypeSafe backend

`JevBackend` (in `jev.py`, `backend_id` `jev-typesafe-v1`) answers all three
question types — **noul**, **choice** and **score** — through
`TypeSafeClient.system_one`. It maps the SDK response onto the same
`common.schema.json` answer shapes: a Noul answer carries only `noul` and
**never** a `confidence` (the SDK exposes none, and the abstraction does
not fabricate one); a Choice answer's label is taken *by name* from the
response, never by position in the option list. All three answers are
recorded in the same `system_one_call` event, with `data.sdk_version`
added and `usage` built from the provider response.

**The transport seam.** `JevBackend` names its transport
(`"typesafe_system_one"`) and never imports it. `guarded_send` /
`send_through_run` resolve the name in `transports.py` — the only module
that imports a provider SDK (lazily, inside the function body) and the
only module other than `guards.py` added to the transport-import
allowlist. `guarded_send`/`send_through_run` remain the package's only
send seam, and the AST rule that exactly those two take a `send` argument
is unchanged. A test asserts no module other than `guards.py` imports
`transports.py`; a stray `import typesafe_sdk` anywhere else fails the
seam test.

**What the SDK exposes for tokens and cost.** The TypeSafe response is
`SystemOneResponse`, whose `usage` is a `Usage` struct with exactly two
fields: `input_tokens` and `output_tokens`, each `int | None` — the API may
omit either. It exposes **no cost, no currency and no cached-input-token
count**. (The upstream OpenAPI `usage` schema still requires a
`billing_units` field the API does not return; the SDK does not surface
it.) `latency_ms` is measured client-side around the call. So the usage
record copies the two token counts verbatim and never invents one: `cost`
is always null here with `null_reason` `no_price_entry` until a versioned
price entry exists (XTRM-432 owns the price table), and a token count the
response did not expose is null with `null_reason`
`not_exposed_by_provider` — never `0` and never omitted.

**Live smoke call (local, not a test).** One real, non-board call to
confirm the SDK surface still matches this adapter. It reads the key from
the environment only — the command never echoes it, and no code path logs
or serialises `TYPESAFE_API_KEY` or the key file's contents. Run from
`packages/research`:

```bash
# The key file holds a NAME=value line, so pass the VALUE, not the whole line:
# `cat` alone sets the variable to `TYPESAFE_API_KEY=apik...` and the server answers 401.
TYPESAFE_API_KEY="$(cut -d= -f2- ~/.secrets/typesafe_api_key.txt | tr -d '\n')" \
  uv run --extra jev python - <<'PY'
from xtrm_research.guards import guarded_send

payload = {
    "model": "jev-latest",
    "state": {
        "issue_a": {"title": "Fix the settle lock race", "description": "the runner run lock"},
        "issue_b": {"title": "Fix the settle lock race", "description": "the runner run lock"},
    },
    "questions": {
        "redundant": {
            "type": "noul",
            "instructions": "Are these two tickets asking for the same work?",
        },
        "relation": {
            "type": "choice",
            "instructions": "What is the relationship between the two tickets?",
            "criteria": {"same_work": "same change", "unrelated": "different areas"},
        },
    },
}
response = guarded_send(payload, "typesafe_system_one")
print(response["model"], response["sdk_version"], response["usage"])
print(response["answers"])
PY
```

The payload is synthetic and carries no board data; it passes the guard
stage unchanged and reaches TypeSafe through the one send seam.

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
# e.g. xtrm-research --json experiment show board-duplicates-v1 --registry-root registry
xtrm-research tail <run-id> --after <offset>
xtrm-research metrics <run-id>
xtrm-research compare <run-id> [<run-id> ...] [--baseline <run-id>]
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
- `compare` returns a mapping from run id to that run's summary
  (`metrics`, `sample_count`, `event_count`) with delta data added
  *inside* each summary — never beside it, because the app consumer maps
  every top-level key as a run summary. Each run gets `deltas` for every
  metric key it shares with the baseline (`value_delta` = run minus
  baseline, `baseline_n`, `run_n`, `within_tolerance`) and
  `unpaired_metrics` listing `{metric, missing_side}` for keys present on
  only one side. A delta states no direction of merit: whether higher is
  better is not in the data. Comparing runs of different experiments is
  `ok: false` naming both experiment ids.

### `compare` tolerance

A run may declare an optional, non-negative `tolerance` on its
`manifest.json` (top-level; see `manifest.schema.json`). A delta whose
magnitude is within the *run's own* tolerance is flagged
`within_tolerance: true`, one outside it `false`, and a run that declares
none gets `within_tolerance: null` — distinct from `false`. `--baseline`
defaults to the first listed run id, matching the app's baseline-first
convention.

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
- **The guard stage's credential residuals are accepted costs
  (XTRM-462).** The assignment-redaction rule is name-anchored: a secret
  assigned to a name carrying none of its strong/weak keywords, or to a
  sentence-case strong keyword (`Password: hunter2`), is caught only when
  the value itself matches a known format (a prefixed token, a hex
  digest, a PEM block, a URL credential). That value-only backstop is
  deliberate — the name-agnostic alternative (XTRM-428 J1) redacted
  ordinary URLs, model ids and version strings, and a sentence-case value
  heuristic would re-redact ordinary prose (`Password: required`).
  XTRM-462 re-reviewed both against the merged XTRM-428 code and kept
  them as the final answer. Separately, XTRM-462 narrowed the short-field
  masking-loss trigger to a field whose entire content is one token: a
  field of many opaque tokens holding one real word is no longer exempt,
  so losing that word aborts.

## Non-goals of this package (see XTRM-426 / XTRM-424)

Backends beyond the deterministic duplicate baseline, guards, cache/prices,
porting the original experiments, and Pi capture are separate follow-up
issues. This package ships the data contract, a read/write skeleton and the
System One backend seam — not a full research harness. Performance is not
optimized: the JSONL torn-tail repair rereads the whole file on every
append (see the `ponytail:` comment in `jsonl.py`), and every write path
takes a per-run lock, serializing writes within a run — fine at this
package's scale.
