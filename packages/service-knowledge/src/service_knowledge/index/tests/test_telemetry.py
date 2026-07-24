"""Telemetry: grep component=knowledge-index finds >=1 line per query + per rebuild; no raw query."""
from __future__ import annotations

import json

from service_knowledge import index
from service_knowledge.index import paths, telemetry


def test_query_hash_is_stable_and_not_raw():
    h1 = telemetry.query_hash("Discord  Webhook")
    h2 = telemetry.query_hash("discord webhook")
    assert h1 == h2  # normalized
    assert "discord" not in h1


def test_rebuild_and_query_emit_events(alertmanager_consumer):
    index.build(alertmanager_consumer)
    index.search(alertmanager_consumer, "discord webhook")

    lines = paths.events_path(alertmanager_consumer).read_text().strip().splitlines()
    records = [json.loads(line) for line in lines]
    components = {r["component"] for r in records}
    events = {r["event"] for r in records}
    assert components == {"knowledge-index"}
    assert "rebuild" in events
    assert "query" in events
    rebuild = next(record for record in records if record["event"] == "rebuild")
    assert {"source_ref", "item_count", "services_count", "candidate_count",
            "duration_ms", "index_hash", "generator_version"} <= rebuild.keys()
    query = next(record for record in records if record["event"] == "query")
    assert {"query_hash", "service_ids_matched", "top_score", "candidate_count",
            "duration_ms", "source_ref"} <= query.keys()
    assert query["query_hash"] == telemetry.query_hash("discord webhook")
    assert query["service_ids_matched"] == ["alertmanager"]
    # raw query text never logged
    for record in records:
        assert "discord webhook" not in json.dumps(record)
