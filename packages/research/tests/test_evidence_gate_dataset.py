"""Evidence Gate dataset v1 extraction and freezing (XTRM-493)."""

from __future__ import annotations

import json

import pytest

from xtrm_research.evidence_gate import dataset as d

CTX = (
    "## first query words here\n\n"
    "--- [session | 2026-07-25 | shell] ---\n### Title\n\n## VALIDATION\nbody a\n\n"
    "--- [session] ---\nbody b\n\n---\n\n"
    "## second query words\n\n--- [s3] ---\nbody c\n"
)


def test_markdown_heading_inside_a_passage_is_not_a_new_query():
    groups = d.parse_ctx_search_result(CTX)
    assert [q for q, _ in groups] == ["first query words here", "second query words"]
    assert groups[0][1][0] == (
        "session | 2026-07-25 | shell",
        "### Title\n\n## VALIDATION\nbody a",
    )
    assert groups[0][1][1] == ("session", "body b")
    assert groups[1][1] == [("s3", "body c")]


def test_pi_and_claude_transcripts_both_yield_ctx_search_results(tmp_path):
    pi = tmp_path / "pi.jsonl"
    pi.write_text(
        json.dumps(
            {
                "message": {
                    "role": "toolResult",
                    "toolName": "ctx_search",
                    "content": [{"type": "text", "text": CTX}],
                    "timestamp": 1,
                }
            }
        )
        + "\n"
    )
    cc = tmp_path / "cc.jsonl"
    name = "mcp__plugin_context-mode_context-mode__ctx_search"
    cc.write_text(
        json.dumps(
            {
                "timestamp": "t0",
                "message": {
                    "content": [{"type": "tool_use", "id": "u1", "name": name}]
                },
            }
        )
        + "\n"
        + json.dumps(
            {
                "timestamp": "t1",
                "message": {
                    "content": [
                        {"type": "tool_result", "tool_use_id": "u1", "content": CTX}
                    ]
                },
            }
        )
        + "\n"
        + json.dumps(
            {
                "message": {
                    "content": [
                        {"type": "tool_result", "tool_use_id": "other", "content": CTX}
                    ]
                }
            }
        )
        + "\n"
    )
    assert len(d.local_groups([pi], "pi")) == 2
    groups = d.local_groups([cc], "cc")
    assert len(groups) == 2 and groups[0].ts == "t1"


def test_ddgs_query_parse():
    assert d.parse_ddgs_query('ddgs text -q "a \\"b\\" c" -m 5') == 'a "b" c'
    assert d.parse_ddgs_query("curl https://x") is None


def _group(query, passages, stratum="L", kind="pi"):
    g = d.Group(stratum, kind, "ref", None, query)
    g.candidates = [d.Candidate(query, p, "h", i) for i, p in enumerate(passages)]
    return g


def test_filters_redact_before_freezing_and_count():
    secret = "token ghp_" + "a" * 36
    kept, counts = d.apply_filters(
        [
            _group("three word query", ["", "same", "same", secret]),
            _group("two words", ["x"]),
            _group("three word query", ["dup query"]),
        ],
        {"L": 8},
    )
    assert counts.empty == 1 and counts.duplicate == 1
    assert counts.short_query_groups == 1 and counts.duplicate_query_groups == 1
    assert counts.redacted == 1
    passages = [c.passage for c in kept[0].candidates]
    assert "ghp_" not in " ".join(passages)
    assert len(passages) == 2


def test_selection_is_a_pure_function_of_population_and_seed():
    groups = [
        _group(f"query number {i}", ["p"], kind="a" if i % 3 else "b")
        for i in range(30)
    ]
    first = [g.group_id for g in d.select_groups(groups, {"L": 10}, 7)]
    again = [g.group_id for g in d.select_groups(list(reversed(groups)), {"L": 10}, 7)]
    other = [g.group_id for g in d.select_groups(groups, {"L": 10}, 8)]
    assert sorted(first) == sorted(again) and len(first) == 10
    assert sorted(first) != sorted(other)
    kinds = [g.source_kind for g in d.select_groups(groups, {"L": 10}, 7)]
    assert kinds.count("a") == 5 and kinds.count("b") == 5


def test_frozen_dataset_detects_tampering_and_refuses_rewrite(tmp_path):
    items = d.items_of([_group("three word query", ["p1", "p2"])])
    manifest = d.freeze(items, tmp_path / "ds", {"x": 1})
    assert manifest["n_items"] == 2 and d.verify(tmp_path / "ds")
    assert d.load_items(tmp_path / "ds") == json.loads(json.dumps(items))
    with pytest.raises(FileExistsError):
        d.freeze(items, tmp_path / "ds", {})
    path = tmp_path / "ds" / "items.jsonl"
    path.write_text(path.read_text().replace("p1", "p9"))
    assert not d.verify(tmp_path / "ds")
    with pytest.raises(ValueError):
        d.load_items(tmp_path / "ds")
