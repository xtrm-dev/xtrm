"""service-knowledge eval package (research §3.9 measurement layer, PR5a).

Public surface: :func:`harness.run_corpus` drives the labeled corpus against the shipped index +
verifier; :mod:`metrics` defines the twelve §3.9 metrics; :mod:`report` renders the weekly report.
"""
from __future__ import annotations

from service_knowledge.eval.harness import (
    CorpusCase,
    build_eval_consumer,
    evaluate_case,
    iso_week_label,
    load_corpus,
    run_corpus,
)
from service_knowledge.eval.metrics import (
    METRIC_LABELS,
    METRIC_ROWS,
    THRESHOLDS,
    CaseOutcome,
    MetricReport,
    Threshold,
    aggregate,
)

__all__ = [
    "METRIC_LABELS",
    "METRIC_ROWS",
    "THRESHOLDS",
    "CaseOutcome",
    "CorpusCase",
    "MetricReport",
    "Threshold",
    "aggregate",
    "build_eval_consumer",
    "evaluate_case",
    "iso_week_label",
    "load_corpus",
    "run_corpus",
]
