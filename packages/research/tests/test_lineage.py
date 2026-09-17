from __future__ import annotations

from xtrm_research.lineage import lineage_tree
from xtrm_research.runner import start_run

from .helpers import make_manifest


def test_lineage_tree_has_retry_and_fork_children(registry, runs_root):
    baseline = make_manifest(registry, run_id="run-baseline")
    start_run(runs_root, "run-baseline", baseline)

    retry = make_manifest(
        registry,
        run_id="run-retry",
        lineage=[{"relation": "retry_of", "run_id": "run-baseline"}],
    )
    start_run(runs_root, "run-retry", retry)

    fork = make_manifest(
        registry,
        run_id="run-fork",
        lineage=[{"relation": "forked_from", "run_id": "run-baseline"}],
    )
    start_run(runs_root, "run-fork", fork)

    tree = lineage_tree(runs_root, "run-baseline")
    child_relations = {(c["relation"], c["run_id"]) for c in tree["children"]}
    assert child_relations == {("retry_of", "run-retry"), ("forked_from", "run-fork")}
