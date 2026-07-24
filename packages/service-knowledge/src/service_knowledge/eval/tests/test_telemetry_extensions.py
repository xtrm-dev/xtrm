"""Retrieval-telemetry extensions: get_item / get_full_skill / activator (vaultctl-backed; CI)."""
from __future__ import annotations

import json

from service_knowledge import index
from service_knowledge.index import paths, schema


def _event_count(consumer_root) -> int:
    conn = schema.connect(consumer_root)
    try:
        return conn.execute("SELECT COUNT(*) AS n FROM sk_retrieval_events").fetchone()["n"]
    finally:
        conn.close()


def test_search_populates_retrieval_events(routing_consumer):
    index.build(routing_consumer)
    before = _event_count(routing_consumer)
    index.search(routing_consumer, "api-gateway latency")
    assert _event_count(routing_consumer) == before + 1


def test_get_item_populates_retrieval_events(routing_consumer):
    index.build(routing_consumer)
    result = index.search(routing_consumer, "api-gateway latency")
    item_id = result["results"][0]["item"]["id"]
    before = _event_count(routing_consumer)
    fetched = index.get_item(routing_consumer, item_id)
    assert fetched is not None
    assert _event_count(routing_consumer) == before + 1
    # a component=knowledge-index "get" line was emitted, no raw id leaked
    lines = paths.events_path(routing_consumer).read_text().strip().splitlines()
    gets = [json.loads(line) for line in lines if json.loads(line).get("event") == "get"]
    assert gets, "no get telemetry line emitted"
    assert all(item_id not in json.dumps(g) for g in gets)


def test_get_full_skill_populates_retrieval_events(routing_consumer):
    index.build(routing_consumer)
    skill_path = ".xtrm/skills/infra/service-knowledge/services/api-gateway/SKILL.md"
    before = _event_count(routing_consumer)
    index.get_full_skill(routing_consumer, skill_path)
    assert _event_count(routing_consumer) == before + 1


def test_activator_records_retrieval_event(routing_consumer):
    import importlib.util
    import sys
    from pathlib import Path

    index.build(routing_consumer)
    scripts = Path(__file__).resolve().parents[2] / "scripts"
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))  # skill_activator imports the standalone `bootstrap` module
    spec = importlib.util.spec_from_file_location("skill_activator_under_test", scripts / "skill_activator.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    before = _event_count(routing_consumer)
    module._record_retrieval_event(routing_consumer, "api-gateway", {"items": [1, 2]}, 12.3)
    assert _event_count(routing_consumer) == before + 1

    conn = schema.connect(routing_consumer)
    try:
        row = conn.execute(
            "SELECT source_ref, candidate_count FROM sk_retrieval_events ORDER BY id DESC LIMIT 1"
        ).fetchone()
    finally:
        conn.close()
    assert row["source_ref"] == "activator"
    assert row["candidate_count"] == 2
