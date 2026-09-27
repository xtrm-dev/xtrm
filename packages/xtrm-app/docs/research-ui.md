# Research UI contract

**Status:** implementation contract  
**Tracking:** Jira XTRM-99 c.13439 / XTRM-433 / XTRM-549  
**Scope:** `packages/xtrm-app` Research surfaces and the read-only `xtrm-research` bridge

## Ownership

Research definitions own evidence semantics. xtrm-app owns presentation.

```text
Experiment.chart_specs
        ↓
Experiment.named_datasets
        ↓
xtrm-research chart-data
        ↓
server/research-cli.ts
        ↓
ResearchAdapter
        ↓
ResearchCharts
```

A React component must not hard-code a board-, model-, or experiment-specific chart. A versioned Experiment declares which datasets belong together and supplies their title and description.

Persisted assessment metrics remain evaluator-namespaced (`<evaluator>::<metric>`). Experiment `named_datasets` are semantic dataset ids. The Research read layer resolves an unqualified dataset id only when it maps to exactly one namespaced metric; ambiguity fails closed.

## Run information architecture

```text
Run Analysis
├── Summary / interpretation
├── Metrics
├── Charts
├── Samples
├── Execution / timeline
└── Provenance
```

The first viewport should answer **why**, **what happened**, and **what it means**. Charts supplement the plain-language result; they never replace it.

The comparison surface reuses the same Experiment chart definitions over the selected run ids. Missing metrics render as **not reported**, never zero.

## Experiments, samples and telemetry

- **Experiments** are registry definitions, read through `xtrm-research experiments`, not derived from runs. A definition with zero runs is listed with an explicit `0 runs` and opens `/research/experiments/$experimentId`.
- **Experiment detail** renders the definition's declared semantics — description, research question, hypothesis, terminology, success and falsification criteria, non-claims, metric glossary with direction, declared charts, and the runs that reference it. A field the definition does not carry renders as explicit absence, never inferred prose.
- **Samples** are the run's `samples.jsonl` records, read through `xtrm-research samples <run_id>`. Sample id, status, input, output, candidate and usage come from the sample record.
- **Telemetry** is the run's `tail` event log, shown separately and never presented as sample content. A sample is never reconstructed from its events, and an event's usage is never attributed to a sample.

## Metric semantics

Chart labels and interpretation come from versioned Research definitions:

1. use `metric_glossary[dataset]` when the Experiment contract provides it;
2. fall back to the existing `legend[dataset]`;
3. never duplicate metric meaning in UI source.

The renderer may use glossary fields such as label, description, unit, and direction when present. Direction is explanatory metadata; the chart layer does not infer that a larger number is better.

## Native chart families

The first native renderer covers scalar metrics across runs, including signed values and 95% intervals in the textual value label. The contract is intentionally smaller than a general visualization grammar.

Future Research UI slices may add native views for:

- variant/arm comparisons and deltas;
- calibration/reliability;
- token, latency, and provider usage;
- execution progression;
- run lineage/retries/forks;
- per-sample trace inspection.

If a richer declarative renderer is added later, the canonical data still comes from Experiment definitions and Research derived views rather than arbitrary UI-side URLs.

## Board-v2 examples

Board / Planning Ready v2 can declare charts for arm performance, per-Noul calibration, primitive quality, escalation rate, latency/usage, repository slices, and natural revision transitions. Those are experiment definitions, not generic UI schema fields.

## Security and authority

The bridge remains GET-only. Chart rendering cannot mutate runs, definitions, annotations, or source boards. Derived chart data is regenerable from immutable run evidence and assessment sets.
