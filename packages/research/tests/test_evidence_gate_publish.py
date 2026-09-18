"""Evidence Gate v2 results as app-visible runs (XTRM-510)."""

from __future__ import annotations

from xtrm_research.evidence_gate import publish_runs as pr
from xtrm_research.schemas import validate

M = "cluster percentile bootstrap"
RESULT = {
    "n_eval": 222,
    "established_questions": {
        "contains_usable_evidence": True,
        "contradicts_query_assumption": False,
    },
    "metrics": {
        "jev|contains_usable_evidence|auc": {
            "value": 0.84,
            "ci95": [0.78, 0.9],
            "method": M,
        },
        "jev|contradicts_query_assumption|auc": {
            "value": 0.5,
            "ci95": [0.4, 0.6],
            "method": M,
        },
        "jev|gate|injection_flag_recall": {"value": None, "ci95": None, "method": M},
        "jev|gate|latency_p50_ms": {
            "value": 734.25,
            "ci95": [713.4, 758.2],
            "method": M,
            "skipped": 3,
        },
        "llm|contains_usable_evidence|auc": {
            "value": 0.94,
            "ci95": [0.9, 0.97],
            "method": M,
        },
    },
    "paired_deltas": {
        "jev-minus-llm|contains_usable_evidence|auc": {
            "value": -0.1,
            "ci95": [-0.14, -0.06],
            "method": M,
        },
        "jev-minus-no-filter|gate|retained_precision": {
            "value": 0.12,
            "ci95": [0.05, 0.2],
            "method": M,
        },
    },
}


def test_arm_metrics_keep_only_this_arm_and_established_questions():
    m = pr.arm_metrics(RESULT, "jev")
    assert m["contains_usable_evidence.auc"]["ci95"] == [0.78, 0.9]
    assert m["contains_usable_evidence.auc.minus_llm"]["value"] == -0.1
    assert m["gate.retained_precision.minus_no_filter"]["value"] == 0.12
    assert not any(k.startswith("contradicts_query_assumption") for k in m)
    assert (
        m["gate.injection_flag_recall"] is None
    )  # dropped at publish, reads not established
    assert "3 resamples undefined" in m["gate.latency_p50_ms"]["method"]
    assert not any(
        "0.94" in str(v) for v in m.values()
    )  # the llm arm's value never leaks in


def test_conclusion_states_intervals_and_not_established():
    text = pr.conclusion("jev", pr.arm_metrics(RESULT, "jev"))
    assert "usable-evidence AUC 0.840 [0.780, 0.900]" in text
    assert "latency p50 ms (wall clock) 734 [713, 758]" in text
    assert "AUC minus llm -0.100 [-0.140, -0.060]" in text
    assert "token reduction not established" in text


def test_usage_omits_what_a_local_arm_never_measured():
    record = pr._usage("embedding", {"latency_ms": 5.0, "model_revision": "abc"})
    assert record == {
        "source": "unknown",
        "gen_ai.request.model": "abc",
        "latency_ms": 5.0,
    }
    event = {
        "schema_version": "xtrm-research-event/v1",
        "seq": 0,
        "ts": "2026-09-18T00:00:00+00:00",
        "kind": "model_call",
        "usage": record,
    }
    validate("event", event)
    llm = pr._usage(
        "llm",
        {
            "model": "m",
            "latency_ms": 1.0,
            "usage": {"input_tokens": 3, "output_tokens": 4, "cost_usd": 0.001},
        },
    )
    assert llm["cost"] == 0.001 and llm["cost_currency"] == "USD"


def test_only_jev_answers_become_noul_assessments():
    items = [
        {
            "item_id": "i1",
            "source_ref": "/p/s.jsonl#r1",
            "source_kind": "pi",
            "stratum": "L",
            "state": {"query": "q", "passage_source": "s", "passage": "p"},
        }
    ]
    row = {"raw": {"contains_usable_evidence": 0.7}, "latency_ms": 1.0, "model": "m"}
    for arm, expected in (("jev", 1), ("qwen", 0), ("llm", 0)):
        _, records, assessments = pr.arm_run(
            arm, items, {"i1": {"relevant": 1}}, {"i1": row}
        )
        assert len(assessments) == expected and len(records) == 1
    samples, _, _ = pr.arm_run("jev", items, {}, {})
    assert (
        samples[0]["status"] == "error" and samples[0]["input"]["cluster"] == "s.jsonl"
    )
