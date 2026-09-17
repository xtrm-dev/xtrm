"""A trivial deterministic evaluator, for exercising the assessment-set
path in tests. Real evaluators are out of scope for this skeleton.
"""

from __future__ import annotations

from typing import Any


def exact_match_evaluate(
    samples: list[dict[str, Any]], expected: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Compare each sample's ``output`` to ``expected[sample_id]``.

    Returns ``(assessments, metrics)`` shaped for
    :func:`xtrm_research.assessments.write_assessment_set`.
    """
    assessments = []
    correct = 0
    for sample in samples:
        is_match = sample.get("output") == expected.get(sample["sample_id"])
        correct += int(is_match)
        assessments.append({"sample_id": sample["sample_id"], "answer": {"match": is_match}})
    n = len(samples)
    accuracy = correct / n if n else 0.0
    metrics = {"accuracy": {"value": accuracy, "n": n, "method": "exact_match"}}
    return assessments, metrics
