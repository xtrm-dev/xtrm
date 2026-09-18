"""System One answer, policy decision and outcome are never collapsed (XTRM-502)."""

from __future__ import annotations

import collections
import json

from xtrm_research.evidence_gate import compare as c
from xtrm_research.evidence_gate import telemetry_run as t
from xtrm_research.hashing import compute_content_hash
from xtrm_research.store import events_path

from tests.test_evidence_gate_compare import _fixture


def test_each_request_yields_three_separate_linked_records(tmp_path):
    items, labels, preds, tokens = _fixture(n=30)
    for k, item in enumerate(items):
        item.update(source_kind="pi-ctx_search", source_ref=f"/x/.pi/s/{k // 3}.jsonl#result0",
                    state={"query": "q", "passage": f"p{k}", "passage_source": "s", "accepted_evidence": []})
        preds["jev"][item["item_id"]].update(request_id=f"req_{k}")
    ev = c.Evaluation(items, labels, preds, tokens)
    ds = {"id": "evidence-gate", "version": "2"}
    ds["content_hash"] = compute_content_hash(ds)
    meta = {"label_version": "sha256:" + "1" * 64, "labels_sha256": "sha256:" + "2" * 64}
    t.write_run(tmp_path, "r1", ev, preds["jev"], meta, "2026-09-18T00:00:00+00:00", ds)
    events = [json.loads(line) for line in events_path(tmp_path, "r1").read_text().splitlines()]
    by_request = collections.defaultdict(list)
    for e in events:
        by_request[e["data"]["request_id"]].append(e)
    assert len(by_request) == 30
    for request_id, evs in by_request.items():
        assert [e["kind"] for e in evs] == ["system_one_call", "policy_action", "outcome"]
        call, policy, outcome = (e["data"] for e in evs)
        # never collapsed: no record carries another record's content
        assert "action" not in call and "resolved" not in call
        assert "answers" not in policy and "resolved" not in policy
        assert "answers" not in outcome and "action" not in outcome
        assert all("confidence" not in a for a in call["answers"].values())  # nouls only
        assert policy["side_effect"] == "none" and policy["policy"]["content_hash"].startswith("sha256:")
        assert outcome["resolver"]["label_version"] == meta["label_version"]
        assert all(e["telemetry_refs"]["pi_session_id"] is not None for e in evs)
        assert evs[0]["usage"]["cost"] is None and call["cost"]["value"] is not None
