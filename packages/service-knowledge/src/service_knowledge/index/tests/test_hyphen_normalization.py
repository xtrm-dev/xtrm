"""Regression tests for hyphen/case normalization in retrieval matching (XTRM-651).

`per-page search box focus ring` returned zero hits: FTS5 parses a raw `-` as query
syntax (`no such column: page`), swallowed by the OperationalError guard into an empty
candidate set, while shorter phrasings routed fine. The query path now sanitizes MATCH
strings (hyphens/dashes/underscores -> spaces, quoted alnum tokens) and the
trigger/intent/territory signals normalize hyphens/case the same way the index-side
`_literals` split does.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from service_knowledge import index
from service_knowledge.index import query as query_mod
from service_knowledge.index import ranking


def _git(args: list[str], cwd: Path) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)


@pytest.fixture
def hyphen_consumer(tmp_path: Path) -> Path:
    """One service whose detail is written hyphenated (`per-page ... focus ring`)."""
    repo = tmp_path / "hyphen-infra"
    umb = repo / ".xtrm" / "skills" / "infra" / "service-knowledge"
    svc = umb / "services" / "webui"
    svc.mkdir(parents=True)
    skill = """---
name: webui
description: >-
  Web UI service.
allowed-tools: Read, Bash(python3 *)
---
# Webui Expert

## Search Box
The per-page search box focus ring styling is controlled by the search module. The focus
ring must remain visible on keyboard navigation.

## Cross-Service Health Check
```bash
python3 scripts/health_probe.py --json
```
"""
    (svc / "SKILL.md").write_text(skill, encoding="utf-8")
    (repo / "webui").mkdir()
    (repo / "webui" / "app.ts").write_text("key: value\n", encoding="utf-8")
    registry = {"version": "1.0", "pack": "infra", "services": {
        "webui": {
            "name": "webui",
            "description": "Web UI service.",
            "skill_path": ".xtrm/skills/infra/service-knowledge/services/webui/SKILL.md",
            "territory": ["webui/**"],
            "triggers": ["search", "focus"],
            "last_sync_ref": "",
        }}}
    (umb / "service-registry.json").write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    _git(["init", "-q"], repo)
    _git(["config", "user.email", "test@test"], repo)
    _git(["config", "user.name", "test"], repo)
    _git(["add", "-A"], repo)
    _git(["commit", "-qm", "init"], repo)
    return repo


def _ids(result: dict) -> list[str]:
    return [r["item"]["id"] for r in result["results"]]


def test_hyphenated_equals_dehyphenated(hyphen_consumer):
    """VALIDATION: hyphenated multi-term routes the same as its de-hyphenated phrasing."""
    index.build(hyphen_consumer)
    hyphen = index.search(hyphen_consumer, "per-page search box focus ring")
    plain = index.search(hyphen_consumer, "per page search box focus ring")
    assert hyphen["results"], "hyphenated query must not return zero hits"
    assert _ids(hyphen) == _ids(plain)


def test_hyphenated_returns_shorter_phrasing_hits(hyphen_consumer):
    """SCOPE: hyphenated query returns the hits its shorter phrasings return."""
    index.build(hyphen_consumer)
    hyphen = _ids(index.search(hyphen_consumer, "per-page search box focus ring"))
    assert hyphen, "hyphenated query must not return zero hits"
    for short in ("search box focus ring", "focus ring"):
        short_ids = _ids(index.search(hyphen_consumer, short))
        assert short_ids, f"shorter phrasing {short!r} must hit"
        assert short_ids[0] in hyphen
    assert hyphen[0] == "section:webui:search-box"


def test_hyphenated_case_insensitive(hyphen_consumer):
    index.build(hyphen_consumer)
    lower = _ids(index.search(hyphen_consumer, "per-page search box focus ring"))
    upper = _ids(index.search(hyphen_consumer, "Per-Page SEARCH Box FOCUS Ring"))
    assert lower and lower == upper


def test_fts_sanitizer_never_raises(hyphen_consumer):
    index.build(hyphen_consumer)
    for raw in (
        "per-page search box focus ring",
        "title:\"foo\" * (bar) AND baz",
        "node-exporter_config --dry-run",
        "AND OR NOT NEAR",
    ):
        result = index.search(hyphen_consumer, raw)  # must not raise
        assert isinstance(result["results"], list)
    # pure operators carry no searchable tokens -> empty, not an error
    assert index.search(hyphen_consumer, "AND OR NOT")["results"] == []
    # sanitizer unit shape: hyphens become separate quoted tokens, operators dropped
    assert query_mod._fts_match_query("per-page search box focus ring") == (
        '"per" "page" "search" "box" "focus" "ring"'
    )
    assert query_mod._fts_match_query("per page search box focus ring") == (
        '"per" "page" "search" "box" "focus" "ring"'
    )


def test_intent_signal_hyphen_insensitive():
    item = {
        "title": "Search Box",
        "tags": "webui",
        "literals": "per page search box focus ring",
        "service_id": "webui",
        "triggers": ["search"],
        "citations": [],
    }
    hyphen = query_mod._intent_signal(item, query_mod.QueryContext(query="per-page search box"))
    plain = query_mod._intent_signal(item, query_mod.QueryContext(query="per page search box"))
    assert hyphen > 0 and hyphen == plain


def test_trigger_signal_hyphen_and_case_insensitive():
    item = {"territory": [], "triggers": ["Per-Page"], "service_id": "webui"}
    for q in ("per-page styling", "per page styling", "PER-PAGE styling"):
        ctx = query_mod.QueryContext(query=q)
        assert query_mod._territory_signal(item, ctx) == ranking.T_TRIGGER


def test_territory_matching_case_insensitive():
    assert query_mod._path_in_territory("Alertmanager/alert.yml", ["alertmanager/**"])
    assert query_mod._path_in_territory("WEBUI/app.ts", ["webui/**"])
    assert not query_mod._path_in_territory("docs/guide.md", ["webui/**"])
