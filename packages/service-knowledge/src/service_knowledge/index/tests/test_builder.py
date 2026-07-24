"""Builder ingestion: registry -> service items, SKILL -> section items, probes, citations,
claim manifests (when present), secret scrubbing, and supersede-on-source-change provenance."""
from __future__ import annotations

import json

from service_knowledge import index
from service_knowledge.index import schema


def _items(conn):
    return {row["id"]: dict(row) for row in conn.execute("SELECT * FROM sk_items").fetchall()}


def test_registry_and_sections_ingested(alertmanager_consumer):
    stats = index.build(alertmanager_consumer)
    assert stats.services == 1
    assert stats.sections >= 2
    assert stats.probes >= 1
    conn = schema.connect(alertmanager_consumer)
    try:
        items = _items(conn)
    finally:
        conn.close()
    assert "service:alertmanager" in items
    assert items["service:alertmanager"]["kind"] == "service"
    section_ids = [i for i in items if i.startswith("section:alertmanager:")]
    assert len(section_ids) >= 2
    probe_ids = [i for i in items if i.startswith("probe:alertmanager:")]
    assert probe_ids, "health-check probe should be indexed"


def test_citations_extracted(alertmanager_consumer):
    index.build(alertmanager_consumer)
    conn = schema.connect(alertmanager_consumer)
    try:
        citations = conn.execute(
            "SELECT path FROM sk_citations WHERE path LIKE 'alertmanager/%'").fetchall()
    finally:
        conn.close()
    assert any("alertmanager.yml" in c["path"] for c in citations)


def test_secret_values_never_indexed(tmp_path, alertmanager_consumer):
    """Plant an AWS key + credentialed redis URL in a section; neither reaches the index."""
    skill = alertmanager_consumer / ".xtrm/skills/infra/service-knowledge/services/alertmanager/SKILL.md"
    text = skill.read_text()
    text += (
        "\n## Credentials\n"
        "aws_access_key_id = AKIAIOSFODNN7EXAMPLE\n"
        "cache at redis://:supersecretpw@redis.local:6379/0\n"
    )
    skill.write_text(text, encoding="utf-8")
    index.build(alertmanager_consumer)
    conn = schema.connect(alertmanager_consumer)
    try:
        blob = "\n".join(
            (row["title"] or "") + "\n" + (row["text"] or "") + "\n" + (row["description"] or "")
            for row in conn.execute("SELECT title, text, description FROM sk_items").fetchall()
        )
        fts_blob = "\n".join(
            row[0] for row in conn.execute("SELECT title || text FROM sk_items_fts").fetchall()
        )
    finally:
        conn.close()
    for secret in ("AKIAIOSFODNN7EXAMPLE", "supersecretpw"):
        assert secret not in blob
        assert secret not in fts_blob


def test_claim_manifest_ingested_when_present(alertmanager_consumer):
    svc_dir = alertmanager_consumer / ".xtrm/skills/infra/service-knowledge/services/alertmanager"
    manifest = {"schema_version": 1, "claims": [
        {"id": "am-1", "claim_type": "invariant",
         "text": "Discord webhook URL must be non-empty",
         "authority": "curated", "status": "active", "risk": "high",
         "citations": [{"path": "alertmanager/alertmanager.yml", "line_start": 18, "line_end": 42}],
         "verification": {"verdict": "verified", "verifier_version": "0.2.0", "evidence_digest": "sha256:x"},
         "source": {"path": "alertmanager/SKILL.md", "ref": "abc", "hash": "sha256:y"}},
    ]}
    (svc_dir / "claims.json").write_text(json.dumps(manifest), encoding="utf-8")
    stats = index.build(alertmanager_consumer)
    assert stats.claims == 1
    item = index.get_item(alertmanager_consumer, "claim:am-1")
    assert item is not None
    assert item["kind"] == "claim"
    assert item["verification"]["verdict"] == "verified"
    assert item["citations"], "claim citations should be linked"


def test_supersede_on_claim_removal(alertmanager_consumer):
    """A claim dropped from the manifest flips to superseded (kept, excluded from retrieval)."""
    svc_dir = alertmanager_consumer / ".xtrm/skills/infra/service-knowledge/services/alertmanager"
    manifest = {"schema_version": 1, "claims": [
        {"id": "am-gone", "claim_type": "invariant", "text": "will be removed",
         "authority": "curated", "status": "active", "risk": "low"}]}
    claims_path = svc_dir / "claims.json"
    claims_path.write_text(json.dumps(manifest), encoding="utf-8")
    index.build(alertmanager_consumer)
    assert index.get_item(alertmanager_consumer, "claim:am-gone")["status"] == "active"

    claims_path.write_text(json.dumps({"schema_version": 1, "claims": []}), encoding="utf-8")
    stats = index.build(alertmanager_consumer)
    assert stats.superseded >= 1
    conn = schema.connect(alertmanager_consumer)
    try:
        row = conn.execute("SELECT status FROM sk_items WHERE id='claim:am-gone'").fetchone()
    finally:
        conn.close()
    assert row["status"] == "superseded"
    # default retrieval excludes superseded
    result = index.search(alertmanager_consumer, "will be removed")
    assert all(r["item"]["id"] != "claim:am-gone" for r in result["results"])


def test_index_state_written(alertmanager_consumer):
    stats = index.build(alertmanager_consumer)
    conn = schema.connect(alertmanager_consumer)
    try:
        state = conn.execute("SELECT * FROM sk_index_state WHERE id=1").fetchone()
    finally:
        conn.close()
    assert state["source_ref"] == stats.source_ref
    assert state["index_hash"] == stats.index_hash
    assert state["generator_version"]
    assert state["services_count"] == 1
