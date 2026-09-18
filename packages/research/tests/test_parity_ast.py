"""AST verification of the parity evaluators against the source scripts
(XTRM-481 VALIDATION: parse the relevant functions at specialists a6e55215,
literal-eval the constants they use, compare against the implementation).

The scripts are read through ``git show`` from the checkout named by
``XTRM_SPECIALISTS_REPO`` (default ``~/dev/specialists``). If that checkout
or the commit is unavailable the check skips with a reason rather than
passing silently; it is a source-of-truth comparison, not a fixture.
"""

from __future__ import annotations

import ast
import os
import subprocess
from functools import lru_cache
from pathlib import Path

import pytest

from xtrm_research import evaluators

REPO = Path(
    os.environ.get("XTRM_SPECIALISTS_REPO", Path.home() / "dev" / "specialists")
)
COMMIT = "a6e55215"
DUPES = "experiments/jev-dupes/dupes.py"
SB_QUALITY = "experiments/jev-dupes/sb_quality3.py"


def _source(path: str) -> str:
    if not REPO.is_dir():
        pytest.skip(f"specialists checkout not found at {REPO}")
    result = subprocess.run(
        ["git", "-C", str(REPO), "show", f"{COMMIT}:{path}"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.skip(f"{COMMIT}:{path} unavailable: {result.stderr.strip()}")
    return result.stdout


@lru_cache(maxsize=None)
def _tree(path: str) -> ast.Module:
    return ast.parse(_source(path))


def _function(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"no function {name!r} in source")


def _numbers(node: ast.AST) -> set[float]:
    """Literal-eval every numeric ``ast.Constant`` under ``node``."""
    values = set()
    for child in ast.walk(node):
        if (
            isinstance(child, ast.Constant)
            and isinstance(child.value, (int, float))
            and not isinstance(child.value, bool)
        ):
            values.add(ast.literal_eval(child))
    return values


def _strings(node: ast.AST) -> set[str]:
    return {
        ast.literal_eval(child)
        for child in ast.walk(node)
        if isinstance(child, ast.Constant) and isinstance(child.value, str)
    }


def test_dupes_constants_and_formula_match_the_implementation():
    auc = _function(_tree(DUPES), "auc")
    report = _function(_tree(DUPES), "report")
    unparsed_auc = ast.unparse(auc)
    unparsed_report = ast.unparse(report)

    # ties: sum of (p > n) + 0.5 * (p == n) over positive/negative pairs
    assert evaluators.AUC_TIE_CREDIT in _numbers(auc)
    assert evaluators.AUC_TIE_CREDIT == 0.5
    assert "(p > n) + 0.5 * (p == n)" in unparsed_auc

    # ECE: ten fixed-width bins capped at index 9
    assert evaluators.ECE_BIN_COUNT in _numbers(report)
    assert evaluators.ECE_BIN_COUNT == 10
    assert evaluators.ECE_TOP_BIN_INDEX in _numbers(report)
    assert evaluators.ECE_TOP_BIN_INDEX == 9
    assert "min(int(pi * 10), 9)" in unparsed_report
    assert "range(10)" in unparsed_report
    # ECE and Brier both divide by the whole sample count, not the bin count
    assert "/ len(y)" in unparsed_report

    # precision threshold, and the max(1, tp + fp) guard
    assert evaluators.CLASSIFIER_THRESHOLD in _numbers(report)
    assert evaluators.CLASSIFIER_THRESHOLD == 0.5
    assert "max(1, tp + fp)" in unparsed_report

    # Brier exponent and the jev_choice default of 0 for a missing key
    assert 2 in _numbers(report)
    assert 0 in _numbers(report)
    assert {"same_work", "one_covers_other"} <= _strings(report)


def test_sb_quality_constants_and_formula_match_the_implementation():
    auc = _function(_tree(SB_QUALITY), "auc")
    quality_policy = _function(_tree(SB_QUALITY), "policy")
    report = _function(_tree(SB_QUALITY), "report")
    unparsed_report = ast.unparse(report)

    # the same tie-credit AUC
    assert evaluators.AUC_TIE_CREDIT in _numbers(auc)
    assert "(p > n) + 0.5 * (p == n)" in ast.unparse(auc)

    # policy(): the 0.5 stale factor
    assert evaluators.STALE_FACTOR in _numbers(quality_policy)
    assert evaluators.STALE_FACTOR == 0.5
    assert "0.5 if stale else 1.0" in ast.unparse(quality_policy)

    # order statistics: index divisors 10 and 2, numerator 9
    assert {
        evaluators.P10_DIVISOR,
        evaluators.MEDIAN_DIVISOR,
        evaluators.P90_NUMERATOR,
    } <= _numbers(report)
    assert (
        evaluators.P10_DIVISOR,
        evaluators.MEDIAN_DIVISOR,
        evaluators.P90_NUMERATOR,
    ) == (10, 2, 9)
    assert "len(v) // 10" in unparsed_report
    assert "len(v) // 2" in unparsed_report
    assert "9 * len(v) // 10" in unparsed_report
