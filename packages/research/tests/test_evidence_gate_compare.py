"""Evidence Gate comparison: gate policy, pairing, exclusions (XTRM-499)."""

from __future__ import annotations

import random

import pytest

from xtrm_research.evidence_gate import compare as c
from xtrm_research.evidence_gate.labels import BINARY, ORDINAL


def _fixture(n=120, seed=3, contradictions=0):
    rng = random.Random(seed)
    items, labels, preds, tokens = [], {}, {a: {} for a in c.MODEL_ARMS}, {}
    for k in range(n):
        iid = f"i{k}"
        items.append(
            {"item_id": iid, "source_ref": f"call{k // 3}", "group_id": f"g{k // 3}"}
        )
        usable = int(rng.random() < 0.6)
        row = {q: 0 for q in BINARY}
        row.update(
            relevant=usable,
            contains_usable_evidence=usable,
            warrants_frontier_attention=usable,
        )
        row["contradicts_query_assumption"] = int(k < contradictions)
        row[ORDINAL] = 4
        labels[iid] = row
        tokens[iid] = 100
        noise = rng.uniform(-0.05, 0.05)
        coin = rng.random() < 0.5
        for arm in c.MODEL_ARMS:
            signal = usable if arm != "embedding" else coin
            p = min(max(0.8 * signal + 0.1 + noise, 0.01), 0.99)
            raw = {q: p for q in BINARY}
            raw["contradicts_query_assumption"] = 0.9
            if arm == "embedding":
                raw = {
                    q: (p if q in ("relevant", "contains_usable_evidence") else None)
                    for q in BINARY
                }
            preds[arm][iid] = {
                "raw": raw,
                "latency_ms": 10.0,
                "usage": {
                    "cost_usd": 0.001,
                    "duration_api_ms": 50.0,
                    "input_tokens": 1000,
                    "output_tokens": 0,
                },
                "model": "jev-1.13.0",
                "score_probabilities": {
                    ORDINAL: {"1": 0.0, "2": 0.0, "3": 0.0, "4": 1.0}
                },
            }
    return items, labels, preds, tokens


def test_rare_contradiction_path_is_disabled_not_accept_all():
    ev = c.Evaluation(*_fixture(contradictions=1))
    assert not ev.established["contradicts_query_assumption"]
    gate = ev.gate("jev", list(range(len(ev.ids))))
    # an informative arm must reduce tokens; accept-all through the
    # untrainable contradiction path would pin retention at 1.0
    assert gate["retention_rate"] < 0.9
    assert gate["useful_evidence_recall"] >= 0.8


def test_no_filter_gate_is_the_base_rate():
    ev = c.Evaluation(*_fixture())
    idx = list(range(len(ev.ids)))
    gate = ev.gate("no-filter", idx)
    base = sum(ev.y["contains_usable_evidence"]) / len(idx)
    assert gate["useful_evidence_recall"] == 1.0 and gate["retention_rate"] == 1.0
    assert gate["retained_precision"] == pytest.approx(base)
    assert gate["frontier_input_token_reduction"] == 0.0


def test_paired_delta_of_an_arm_against_itself_is_zero_with_zero_width():
    ev = c.Evaluation(*_fixture())
    out = c.compare(ev, n_resamples=40)
    d = out["paired_deltas"]["jev-minus-frontier|gate|useful_evidence_recall"]
    # jev and frontier are built from the same signal here: identical
    # decisions give a zero delta on every resample
    assert d["value"] == pytest.approx(0.0) and d["ci95"] == [0.0, 0.0]
    assert "embedding-minus-no-filter|gate|retention_rate" in out["paired_deltas"]


def test_missing_answers_exclude_the_item_for_every_arm():
    items, labels, preds, tokens = _fixture()
    del preds["qwen"]["i0"]
    labels["i1"]["relevant"] = None
    ev = c.Evaluation(items, labels, preds, tokens)
    assert "i0" not in ev.ids and "i1" not in ev.ids
    assert ev.exclusions == {"missing_label": 1, "missing_arm_answer": {"qwen": 1}}


def test_costs_come_from_the_price_table_and_local_arms_stay_null():
    ev = c.Evaluation(*_fixture())
    idx = list(range(len(ev.ids)))
    assert ev.gate("jev", idx)["cost_usd_per_1000_candidates"] == pytest.approx(
        1000 * 1000 * 0.042 / 1e6
    )
    assert ev.gate("qwen", idx)["cost_usd_per_1000_candidates"] is None


def test_report_renders_every_arm_and_marks_unestablished_questions():
    from xtrm_research.evidence_gate import report

    ev = c.Evaluation(*_fixture(contradictions=1))
    out = c.compare(ev, n_resamples=20)
    out.update(
        dataset_items_sha256="sha256:x",
        label_version="v",
        labels_sha256="h",
        n_eval=len(ev.ids),
        n_clusters=len(ev.clusters),
        exclusions=ev.exclusions,
        prices_version="p",
        established_questions=ev.established,
        class_balance_eval={
            q: {"positive": sum(ev.y[q]), "n": len(ev.ids)} for q in c.BINARY
        },
    )
    text = report.render(out)
    assert all(arm in text for arm in c.ARMS)
    assert "`contradicts_query_assumption` — 1/" in text and "NOT ESTABLISHED" in text
    assert "not established" in text  # e.g. local-arm cost


def test_latency_uses_one_wall_clock_basis_for_every_arm():
    ev = c.Evaluation(*_fixture())
    idx = list(range(len(ev.ids)))
    gate = ev.gate("frontier", idx)
    assert gate["latency_p50_ms"] == 10.0  # wall clock, like every other arm
    assert gate["frontier_api_latency_p50_ms"] == 50.0  # provider API time, separate
    assert ev.gate("jev", idx)["frontier_api_latency_p50_ms"] is None


def test_rare_injection_flag_reads_not_established():
    items, labels, preds, tokens = _fixture()
    labels["i0"]["contains_prompt_injection"] = 1
    ev = c.Evaluation(items, labels, preds, tokens)
    assert ev.gate("jev", list(range(len(ev.ids))))["injection_flag_recall"] is None


def test_cascade_and_locator_renderers_print_intervals_and_mark_exploratory():
    from xtrm_research.evidence_gate import report

    m = {"value": 0.5, "ci95": [0.4, 0.6], "method": "boot"}
    cascade = {
        "n_eval": 222,
        "n_clusters": 78,
        "battery_hash": "sha256:x",
        "pre_registered": {},
        "uncached_requests": 0,
        "metrics": {
            "cascade|gate|retained_precision": m,
            "cascade-lo98-hi90|gate|retained_precision": m,
            "jev|contains_usable_evidence|auc": m,
        },
        "paired_deltas": {"cascade-minus-llm|gate|retained_precision": m},
    }
    text = report.render_cascade(cascade)
    assert (
        "| cascade-lo98-hi90 (exploratory) |" in text and "0.500 [0.400, 0.600]" in text
    )
    locator = {
        "n_items": 69,
        "width": 3,
        "uncached_requests": 0,
        "metrics": {"jev-beam|hit@1": m, "fusion|hit@1": m},
        "paired_deltas": {"jev-beam-minus-lexical|hit@1": m},
    }
    text = report.render_locator(locator)
    assert "| fusion (exploratory) |" in text and "| jev-beam-minus-lexical |" in text
