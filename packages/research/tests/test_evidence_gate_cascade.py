"""Evidence Gate System One cascade (XTRM-511)."""

from __future__ import annotations

import random
from types import SimpleNamespace

import pytest

from xtrm_research import transports
from xtrm_research.evidence_gate import cascade as cs
from xtrm_research.workflow import ResponseCache


def test_solve_and_logistic_recover_a_known_direction():
    assert cs._solve([[2.0, 1.0], [1.0, 3.0]], [3.0, 5.0]) == pytest.approx([0.8, 1.4])
    rng = random.Random(1)
    xs = [[rng.gauss(0, 1), rng.gauss(0, 1)] for _ in range(400)]
    ys = [1 if rng.random() < cs.cal.sigmoid(2.0 * x[0]) else 0 for x in xs]
    w = cs.fit_logistic(xs, ys, ridge=0.1)
    assert 1.4 < w[1] < 2.6 and abs(w[2]) < 0.4
    assert cs.fit_logistic(xs, [1] * len(xs)) is None


def _data(n=100, seed=2):
    rng = random.Random(seed)
    xs = [[rng.gauss(0, 1)] for _ in range(n)]
    ys = [1 if x[0] + rng.gauss(0, 0.7) > 0 else 0 for x in xs]
    folds = [i % 5 for i in range(n)]
    return xs, ys, folds


def test_learned_composition_is_out_of_fold():
    xs, ys, folds = _data()
    p, _ = cs.learned_out_of_fold(xs, ys, folds, 1.0)
    flipped = [1 - y if f == 0 else y for y, f in zip(ys, folds)]
    q, _ = cs.learned_out_of_fold(xs, flipped, folds, 1.0)
    assert all(a == b for a, b, f in zip(p, q, folds) if f == 0)
    assert any(a != b for a, b, f in zip(p, q, folds) if f != 0)


def test_precision_threshold_is_the_lowest_cut_meeting_the_target():
    ps = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]
    ys = [1, 1, 1, 0, 1, 0]
    assert cs.precision_threshold(ps, ys, 0.8, 1) == 0.5  # top 5: 4/5 = 0.8
    assert cs.precision_threshold(ps, ys, 1.0, 1) == 0.7
    assert cs.precision_threshold(ps, ys, 1.0, 4) is None
    assert cs.precision_threshold(ps, [0] * 6, 0.5, 1) is None


def test_band_rejects_below_retains_above_and_escalates_between():
    xs, ys, folds = _data(200)
    p, _ = cs.learned_out_of_fold(xs, ys, folds, 1.0)
    llm = [7] * len(p)  # a sentinel: only escalated items may carry it
    dec, esc, bands = cs.band_decisions(p, ys, folds, llm, 0.98, 0.95, 5)
    for i, f in enumerate(folds):
        band = bands[f]
        hi = band["hi"] if band["hi"] is not None else float("inf")
        if p[i] < band["lo"]:
            assert dec[i] == 0 and not esc[i]
        elif p[i] >= hi:
            assert dec[i] == 1 and not esc[i]
        else:
            assert esc[i] and dec[i] == 7
    assert 0 < sum(esc) < len(p)
    flipped = [1 - y if f == 1 else y for y, f in zip(ys, folds)]
    dec2, esc2, _ = cs.band_decisions(p, flipped, folds, llm, 0.98, 0.95, 5)
    assert all(
        (dec[i], esc[i]) == (dec2[i], esc2[i]) for i, f in enumerate(folds) if f == 1
    )


def test_the_battery_is_atomic_and_the_rule_is_soft_logic():
    for text in cs.BATTERY_TEXT.values():
        assert "usable" not in text[1] and "evidence" not in text[1]
    good = {
        f: (0.9 if sign == "+" else 0.05) for f, (sign, _) in cs.BATTERY_TEXT.items()
    }
    assert cs.rule_score(good) > 0.6
    assert cs.rule_score({**good, "is_navigation_or_chrome": 1.0}) == 0.0
    assert cs.rule_score({**good, "same_subject": 0.0}) == 0.0
    assert len(cs.features(good)) == len(cs.BATTERY)


def _fake_ev(n=10):
    ids = [f"i{k}" for k in range(n)]
    return SimpleNamespace(
        ids=ids,
        y={cs.EVIDENCE: [k % 2 for k in range(n)]},
        folds=[k % 5 for k in range(n)],
        clusters=[[k] for k in range(n)],
        tokens=[100] * n,
        decision={"llm": {cs.EVIDENCE: [1] * n}},
        cost={"llm": [0.001] * n},
        latency={"llm": [4000.0] * n},
    )


def test_escalated_items_pay_the_llm_cost_and_latency():
    ev = _fake_ev()
    ce = cs.CascadeEvaluation.__new__(cs.CascadeEvaluation)
    ce.ev, ce.y = ev, ev.y[cs.EVIDENCE]
    ce.battery_cost = [0.00005] * 10
    ce.battery_latency = [700.0] * 10
    ce.decision = {"cascade": [1, 0] * 5}
    ce.escalated = {"cascade": [1, 1, 0, 0, 0, 0, 0, 0, 0, 0]}
    gate = ce.gate("cascade", list(range(10)))
    assert gate["escalation_rate"] == pytest.approx(0.2)
    assert gate["cost_usd_per_1000_candidates"] == pytest.approx(
        1000 * (10 * 0.00005 + 2 * 0.001) / 10
    )
    assert ce.latency("cascade", 0) == 4700.0 and ce.latency("cascade", 5) == 700.0
    assert gate["retained_precision"] == 0.0 and gate["useful_evidence_recall"] == 0.0


def test_the_workflow_replays_escalations_without_a_model_call(monkeypatch, tmp_path):
    def forbidden(payload):
        raise AssertionError("an escalation replay must not call a model")

    monkeypatch.setattr(transports, "pi_complete", forbidden)
    monkeypatch.setattr(
        transports,
        "typesafe_system_one",
        lambda payload: {
            "model": "jev-1.13.0",
            "request_id": "r1",
            "usage": {"input_tokens": 1500, "output_tokens": 30},
            "answers": {f: {"type": "noul", "noul": 0.5} for f in cs.BATTERY},
        },
    )
    plan = {
        "i1": {
            "decision": 1,
            "escalated": 1,
            "p": 0.6,
            "band": {"lo": 0.3, "hi": 0.8},
            "rule": 0.2,
        }
    }
    llm_rows = {
        "i1": {
            "model": "deepseek",
            "latency_ms": 4000.0,
            "raw": {cs.EVIDENCE: 0.9},
            "usage": {"input_tokens": 700, "output_tokens": 600, "cost_usd": 0.0006},
        }
    }
    wf = cs.BatteryWorkflow(
        ResponseCache(tmp_path / "c.jsonl"), plan, llm_rows, {"i1": {cs.EVIDENCE: 1}}
    )
    state = {
        "item_id": "i1",
        "query": "q",
        "passage_source": "s",
        "passage": "p",
        "accepted_evidence": "[]",
    }
    records = wf.run_episode("i1", state)
    kinds = [r["kind"] for r in records]
    assert kinds == ["system_one_call", "policy_action", "escalation", "outcome"]
    assert (
        records[1]["data"]["escalate"] == "uncertainty_band"
        and records[1]["data"]["action"] == "retain_evidence"
    )
    assert records[2]["usage"]["cost"] == 0.0006 and records[3]["data"]["resolved"] == {
        cs.EVIDENCE: 1
    }
    assert set(records[0]["data"]["answers"]) == set(cs.BATTERY)


def test_only_the_state_fields_are_sent(monkeypatch, tmp_path):
    sent = []
    monkeypatch.setattr(
        transports,
        "typesafe_system_one",
        lambda payload: (
            sent.append(payload)
            or {"model": "jev-1.13.0", "request_id": "r", "usage": {}, "answers": {}}
        ),
    )
    wf = cs.BatteryWorkflow(ResponseCache(tmp_path / "c.jsonl"))
    wf.ask(
        {
            "item_id": "secret-id",
            "query": "q",
            "passage_source": "s",
            "passage": "p",
            "accepted_evidence": "[]",
        },
        cs.BATTERY,
    )
    assert set(sent[0]["state"]) == {"query", "passage_source", "passage"}


def test_published_metrics_mark_the_sweep_exploratory_and_map_deltas():
    from xtrm_research.evidence_gate import publish_cascade as pc

    m = {"value": 0.5, "ci95": [0.4, 0.6], "method": "boot"}
    result = {
        "n_eval": 222,
        "metrics": {
            "cascade|gate|retained_precision": m,
            "cascade-lo98-hi90|gate|retained_precision": m,
            "jev|gate|retained_precision": m,
        },
        "paired_deltas": {
            "cascade-minus-no-filter|gate|retained_precision": m,
            "battery-rule-minus-jev|contains_usable_evidence|auc": m,
        },
    }
    out = pc._metrics(result, "cascade")
    assert set(out) == {
        "gate.retained_precision",
        "sweep.lo98-hi90.retained_precision",
        "gate.retained_precision.minus_no_filter",
    }
    assert out["sweep.lo98-hi90.retained_precision"]["method"].endswith(
        "exploratory sweep cell"
    )
    assert set(pc._metrics(result, "battery-rule")) == {
        "contains_usable_evidence.auc.minus_jev"
    }


def test_reference_llm_arms_escalate_every_candidate():
    ev = _fake_ev()
    ev.gate = lambda arm, idx: {"retained_precision": 0.5}
    ce = cs.CascadeEvaluation.__new__(cs.CascadeEvaluation)
    ce.ev = ev
    assert ce.gate("frontier", [0])["escalation_rate"] == 1.0
    assert ce.gate("llm", [0])["escalation_rate"] == 1.0
    assert ce.gate("jev", [0])["escalation_rate"] == 0.0
