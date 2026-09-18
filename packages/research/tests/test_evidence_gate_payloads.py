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


def test_pi_calls_run_with_every_context_isolation_flag(monkeypatch):
    seen = {}

    def fake(argv):
        seen["argv"] = argv
        return ""

    monkeypatch.setattr(transports, "_run_cli", fake)
    transports.pi_complete(lab.label_payload("commandcode/gpt-5.6-luna", [ITEM]))
    for flag in ("--no-tools", "--no-session", "-ne", "-ns", "-np", "-nc", "--no-themes", "-na"):
        assert flag in seen["argv"], flag


def test_label_set_agreement_counts_changes():
    a = {"i1": {q: 1 for q in lab.QUESTIONS}, "i2": {q: 0 for q in lab.QUESTIONS}}
    b = {"i1": {**a["i1"], "relevant": 0}, "i2": dict(a["i2"]), "i3": dict(a["i2"])}
    out = lab.label_set_agreement(a, b)
    assert out["relevant"]["n"] == 2 and out["relevant"]["changed"] == 1
    assert out["relevant"]["agreement"] == 0.5 and out["contains_usable_evidence"]["changed"] == 0


def test_llm_reply_parse_is_strict_and_never_repaired():
    ok = {q: 0.5 for q in lab.BINARY}
    ok["source_authority"] = {"1": 0.1, "2": 0.2, "3": 0.3, "4": 0.4}
    import json as _json

    assert f.parse_llm_reply("sure: " + _json.dumps(ok) + " done") == ok
    assert f.parse_llm_reply(None) is None and f.parse_llm_reply("no json here") is None
    assert f.parse_llm_reply(_json.dumps({**ok, "relevant": 1.4})) is None
    missing = dict(ok)
    del missing["contains_prompt_injection"]
    assert f.parse_llm_reply(_json.dumps(missing)) is None
    extra = {**ok, "note": "x"}
    assert f.parse_llm_reply(_json.dumps(extra)) is None
    assert f.llm_payload(ITEM)["model"] == f.LLM_MODEL and "prompt" not in f.llm_payload(ITEM)


def test_allowlist_is_operator_config_not_package_policy(monkeypatch, tmp_path):
    import pytest

    monkeypatch.setattr(transports, "RESEARCH_DOTENV", str(tmp_path / "absent.env"))

    calls = []
    monkeypatch.setattr(transports, "_run_cli", lambda argv: calls.append(argv) or "")
    monkeypatch.delenv(transports.ALLOWED_MODELS_ENV, raising=False)
    transports.pi_complete(lab.label_payload("commandcode/google/gemini-3.7-flash", [ITEM]))
    assert len(calls) == 1  # unset: no restriction for other users
    monkeypatch.setenv(transports.ALLOWED_MODELS_ENV, "commandcode/gpt-5.6-luna, commandcode/deepseek/deepseek-v4.1-flash")
    transports.pi_complete(lab.label_payload("commandcode/gpt-5.6-luna", [ITEM]))
    for model in ("commandcode/google/gemini-3.7-flash", "commandcode/moonshotai/Kimi-K2.6"):
        with pytest.raises(transports.DisallowedModelError):
            transports.pi_complete(lab.label_payload(model, [ITEM]))
    with pytest.raises(transports.DisallowedModelError):
        transports.claude_classify(f.frontier_payload(ITEM))
    assert len(calls) == 2  # refused models never started a process


def test_allowlist_is_read_from_the_research_dotenv(monkeypatch, tmp_path):
    import pytest

    monkeypatch.setattr(transports, "_run_cli", lambda argv: "")
    monkeypatch.delenv(transports.ALLOWED_MODELS_ENV, raising=False)
    env = tmp_path / ".env"
    env.write_text('# budget\nexport XTRM_RESEARCH_ALLOWED_MODELS="commandcode/gpt-5.6-luna"\n')
    monkeypatch.setattr(transports, "RESEARCH_DOTENV", str(env))
    transports.pi_complete(lab.label_payload("commandcode/gpt-5.6-luna", [ITEM]))
    with pytest.raises(transports.DisallowedModelError):
        transports.pi_complete(lab.label_payload("commandcode/moonshotai/Kimi-K2.6", [ITEM]))
    monkeypatch.setenv(transports.ALLOWED_MODELS_ENV, "commandcode/moonshotai/Kimi-K2.6")
    transports.pi_complete(lab.label_payload("commandcode/moonshotai/Kimi-K2.6", [ITEM]))  # env wins
