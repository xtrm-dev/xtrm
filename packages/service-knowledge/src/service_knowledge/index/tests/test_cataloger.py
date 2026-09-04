"""Cataloger reframe: 'Available operational knowledge sources' + index health by default;
the legacy 'Available expert personas' output stays behind --legacy for backward compatibility."""
from __future__ import annotations

import subprocess

import cataloger  # type: ignore[import-not-found]

from service_knowledge import index


def test_new_catalog_shows_knowledge_sources(alertmanager_consumer, monkeypatch):
    index.build(alertmanager_consumer)
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(alertmanager_consumer))
    out = cataloger.generate_catalog()
    assert "Available operational knowledge sources:" in out
    assert "Available expert personas:" not in out
    assert "alertmanager" in out
    assert "index_health:" in out
    assert "items:" in out
    assert "verified:" in out
    assert "knowledge_search" in out  # instruction points at the retrieval surface


def test_legacy_catalog_behind_flag(alertmanager_consumer, monkeypatch):
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(alertmanager_consumer))
    out = cataloger.generate_catalog(legacy=True)
    assert "Available expert personas:" in out
    assert "Available operational knowledge sources:" not in out


def test_index_health_states(alertmanager_consumer, monkeypatch):
    monkeypatch.setenv("CLAUDE_PROJECT_DIR", str(alertmanager_consumer))
    # absent before build
    assert cataloger.read_index_health(str(alertmanager_consumer))["state"] == "absent"
    index.build(alertmanager_consumer)
    # ok right after build (source_ref == HEAD)
    assert cataloger.read_index_health(str(alertmanager_consumer))["state"] == "ok"

    # Any later HEAD makes derived catalog health stale until rebuild.
    marker = alertmanager_consumer / "alertmanager" / "catalog-health-check.txt"
    marker.write_text("changed\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(alertmanager_consumer), "add", "-A"], check=True,
                   capture_output=True)
    subprocess.run(["git", "-C", str(alertmanager_consumer), "commit", "-qm", "advance HEAD"],
                   check=True, capture_output=True)
    stale = cataloger.read_index_health(str(alertmanager_consumer))
    assert stale["state"] == "stale"
    assert stale["source_ref"] != stale["head"]
