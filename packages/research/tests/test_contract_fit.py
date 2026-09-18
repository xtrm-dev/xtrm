"""Contract-fit runner (XTRM-503)."""

from __future__ import annotations

from xtrm_research import contract_fit as cf


def test_needed_fields_ignore_option_labels():
    spec = {"instructions": "Does `command` touch `candidate`? Pick `none` or `prometheus`.", "options": ["prometheus", "none"]}
    assert cf.needed_fields(spec, set()) == {"command", "candidate"}


def test_answers_are_checked_against_the_contract_schema():
    assert cf.answer_errors({"noul": 0.3}, "noul") == []
    assert cf.answer_errors({"noul": 0.3, "confidence": 0.9}, "noul")  # a noul never carries confidence
    assert cf.answer_errors({"noul": 1.4}, "noul")
    good_choice = {"choice": "a", "probabilities": {"a": 0.7, "b": 0.3}, "confidence": 0.4}
    assert cf.answer_errors(good_choice, "choice") == []


def test_missing_state_field_is_counted_never_sent(tmp_path):
    (tmp_path / "sk_instances.jsonl").write_text('{"id": "i", "state": {"command": "ls"}, "reference": {}}\n')
    (tmp_path / "sre_instances.jsonl").write_text("")
    spec = {"id": "sk.x", "version": "v1", "content_hash": "sha256:" + "0" * 64, "type": "noul",
            "instructions": "Does `command` concern `candidate`?"}
    from xtrm_research.hashing import compute_content_hash

    spec["content_hash"] = compute_content_hash(spec)
    out = cf.run(tmp_path, [spec])
    assert out["workloads"]["sk"]["specs"]["sk.x"] == {"type": "noul", "instantiated": 0, "not_instantiated": {"candidate": 1}}
    assert out["workloads"]["sk"]["calls"] == []
