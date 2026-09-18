"""Evidence Gate payloads: composed after the guard, unchanged by it (XTRM-494/497)."""

from __future__ import annotations

from xtrm_research import guards, transports
from xtrm_research.evidence_gate import frontier as f
from xtrm_research.evidence_gate import labels as lab

ITEM = {
    "item_id": "i1",
    "group_id": "g1",
    "state": {"query": "what is the tick size", "passage": 'He said "enabled" at path "a\\b"', "passage_source": "docs | a"},
}


def _guarded(payload):
    return guards._run_guards(payload, frozenset(), guards.LabelExclusionRule(), None)


def test_payloads_keep_state_fields_parsed_until_the_transport():
    for payload in (lab.label_payload("m", [ITEM]), f.frontier_payload(ITEM)):
        assert "prompt" not in payload and "input" in payload
        assert payload == _guarded(payload)
    prompt = transports._prompt_of(f.frontier_payload(ITEM))
    assert prompt.startswith("QUERY: what is the tick size") and 'He said "enabled" at path "a\\b"' in prompt
    assert transports._prompt_of(lab.label_payload("m", [ITEM])).startswith('{"query": "what is the tick size"')


def test_a_credential_in_a_field_is_redacted_before_composition():
    secret = "ghp_" + "c" * 36
    item = {**ITEM, "state": {**ITEM["state"], "passage_source": f"src {secret}"}}
    guarded = _guarded(f.frontier_payload(item))
    assert secret not in transports._prompt_of(guarded)


def test_label_version_covers_the_output_instruction():
    assert "OUTPUT:" in lab.BRIEF
    assert lab.BRIEF_HASH.startswith("sha256:") and lab.label_version().startswith("sha256:")


def test_labels_parse_is_strict():
    import pytest

    good = '{"labels": [{"id": "i1", "relevant": 1, "contains_usable_evidence": 0, "contradicts_query_assumption": 0, "contains_prompt_injection": 0, "warrants_frontier_attention": 1, "source_authority": 3}]}'
    assert lab.parse_labels("noise " + good, ["i1"])["i1"]["source_authority"] == 3
    with pytest.raises(lab.LabelParseError):
        lab.parse_labels(good.replace('"source_authority": 3', '"source_authority": 5'), ["i1"])
    with pytest.raises(lab.LabelParseError):
        lab.parse_labels(good, ["i1", "i2"])
    with pytest.raises(lab.LabelParseError):
        lab.parse_labels(good.replace('"relevant": 1', '"relevant": true'), ["i1"])


def test_resolve_takes_agreement_else_adjudicator():
    a = {"i1": {q: 1 for q in lab.QUESTIONS}}
    b = {"i1": {**{q: 1 for q in lab.QUESTIONS}, "relevant": 0}}
    adj = {"i1": {q: 0 for q in lab.QUESTIONS}}
    final = lab.resolve(["i1", "i2"], a, b, adj)
    assert final["i1"]["relevant"] == 0 and final["i1"]["contains_usable_evidence"] == 1
    assert all(v is None for v in final["i2"].values())
    assert lab.disagreements(a, b) == {"i1"}
