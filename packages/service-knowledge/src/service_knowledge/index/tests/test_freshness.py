"""Freshness F = exp(-ln(2) * changed_commits / half_life); absent ref -> low + advisory."""
from __future__ import annotations

import math
import subprocess

from service_knowledge.index import freshness, ranking


def test_freshness_no_changes_is_one(infra_consumer):
    head = subprocess.run(["git", "-C", str(infra_consumer), "rev-parse", "HEAD"],
                          capture_output=True, text=True, check=True).stdout.strip()
    score, changed = freshness.compute(str(infra_consumer), head, ["alertmanager/**"])
    assert changed == 0
    assert score == 1.0


def test_freshness_decays_with_commits(infra_consumer):
    # create FRESHNESS_HALF_LIFE_COMMITS commits touching the territory -> F ~= 0.5
    first = subprocess.run(["git", "-C", str(infra_consumer), "rev-parse", "HEAD"],
                           capture_output=True, text=True, check=True).stdout.strip()
    target = infra_consumer / "alertmanager" / "config.yml"
    for i in range(ranking.FRESHNESS_HALF_LIFE_COMMITS):
        target.write_text(f"key: {i}\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(infra_consumer), "add", "-A"], check=True, capture_output=True)
        subprocess.run(["git", "-C", str(infra_consumer), "commit", "-qm", f"c{i}"],
                       check=True, capture_output=True)
    score, changed = freshness.compute(str(infra_consumer), first, ["alertmanager/**"])
    assert changed == ranking.FRESHNESS_HALF_LIFE_COMMITS
    assert math.isclose(score, 0.5, rel_tol=1e-6)


def test_freshness_absent_ref():
    score, changed = freshness.compute("/nonexistent", "", ["x/**"])
    assert changed is None
    assert score == ranking.FRESHNESS_ABSENT_REF
