"""Threshold gates on the assembled corpus (skips with warning when corpus < 30 cases)."""
from __future__ import annotations

import warnings
from pathlib import Path

import pytest

from service_knowledge.eval import harness, metrics


CORPUS = Path(__file__).resolve().parents[1] / "corpus"


def test_baseline_thresholds() -> None:
    cases = harness.load_corpus(CORPUS)
    if len(cases) < 30:
        warnings.warn(f"corpus too small ({len(cases)} cases) — baseline skipped")
        pytest.skip("corpus < 30")
    outcomes = [harness.run_case(c) for c in cases]
    values = metrics.compute_all(outcomes)
    assert values["routing_precision"] >= 0.80
    assert values["retrieval_precision_at_5"] >= 0.60
    assert values["stale_claim_escape_rate"] <= 0.05
    assert values["verifier_fp_rate"] <= 0.05
    assert values["verifier_fn_rate"] <= 0.10
