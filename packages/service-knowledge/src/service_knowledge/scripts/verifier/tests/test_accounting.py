"""Verifier FP/FN accounting hooks (research §3.9). No vaultctl dependency."""
from __future__ import annotations

import json

from service_knowledge.scripts.verifier import accounting


def test_classify_confusion_matrix():
    assert accounting.classify(expect_block=True, blocked=True) == "true_positive"
    assert accounting.classify(expect_block=True, blocked=False) == "false_negative"
    assert accounting.classify(expect_block=False, blocked=True) == "false_positive"
    assert accounting.classify(expect_block=False, blocked=False) == "true_negative"


def test_account_returns_record_and_emits(tmp_path):
    record = accounting.account(True, True, service_id="svc", case_id="c1", telemetry_dir=tmp_path)
    assert record["cell"] == "true_positive"
    assert record["component"] == "verifier-accounting"
    lines = (tmp_path / "events.jsonl").read_text().strip().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["cell"] == "true_positive"


def test_summarize_fp_fn_rates():
    cells = ["true_positive", "true_positive", "false_positive", "false_negative", "true_negative"]
    summary = accounting.summarize(cells)
    # FP = 1 / (1 FP + 1 TN) = 0.5 ; FN = 1 / (1 FN + 2 TP) = 1/3
    assert summary["false_positive_rate"] == 0.5
    assert abs(summary["false_negative_rate"] - 1 / 3) < 1e-9


def test_summarize_empty_denominators_none():
    summary = accounting.summarize([])
    assert summary["false_positive_rate"] is None
    assert summary["false_negative_rate"] is None
