"""A trivial deterministic evaluator, for exercising the assessment-set
path in tests. Real evaluators are out of scope for this skeleton.
"""

from __future__ import annotations

from typing import Any


def exact_match_evaluate(
    samples: list[dict[str, Any]], expected: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Compare each sample's ``output`` to ``expected[sample_id]``.

    Each assessment carries a Noul answer (``noul`` = 1.0 on match, else
    0.0) — "did this match?" is naturally a yes/no judgment.
    Returns ``(assessments, metrics)`` shaped for
    :func:`xtrm_research.assessments.write_assessment_set`.
    """
    assessments = []
    correct = 0
    for sample in samples:
        is_match = sample.get("output") == expected.get(sample["sample_id"])
        correct += int(is_match)
        assessments.append(
            {
                "sample_id": sample["sample_id"],
                "answer": {"noul": 1.0 if is_match else 0.0},
            }
        )
    n = len(samples)
    accuracy = correct / n if n else 0.0
    method = "exact_match" if n else "exact_match-no-samples"
    metrics = {
        "accuracy": {
            "value": accuracy,
            "se": None,
            "ci95": None,
            "n": n,
            "method": method,
        }
    }
    return assessments, metrics
