"""Umbrella regeneration: index_state hash + generator_version + OKF envelopes land WITHOUT
corrupting the human-authored SEMANTIC block (regression on the marker contract)."""
from __future__ import annotations

import umbrella_generator as ug  # type: ignore[import-not-found]

REGISTRY = {"services": {
    "alertmanager": {"name": "alertmanager", "description": "Alert routing.",
                     "skill_path": ".xtrm/skills/infra/service-knowledge/services/alertmanager/SKILL.md",
                     "territory": ["alertmanager/**"], "last_sync_ref": "abc12345"},
    "prometheus": {"name": "prometheus", "description": "Metrics.",
                   "skill_path": ".xtrm/skills/infra/service-knowledge/services/prometheus/SKILL.md",
                   "territory": ["prometheus/**"], "last_sync_ref": "def67890"},
}}


def test_provenance_and_okf_envelopes():
    state = {"source_ref": "abc", "schema_version": "1", "generator_version": "0.3.0",
             "index_hash": "sha256:cafe", "item_count": 12, "built_at": "2026-07-24T00:00:00Z"}
    out = ug.generate_umbrella(REGISTRY, "infra", None, state)
    assert "## Knowledge Index" in out
    assert "sha256:cafe" in out
    assert "0.3.0" in out
    assert '"id": "service:alertmanager"' in out
    assert '"id": "service:prometheus"' in out
    assert '"schema_version": 1' in out


def test_semantic_block_preserved_across_regeneration():
    first = ug.generate_umbrella(REGISTRY, "infra", None, {})
    # a human edits the protected block
    edited = first.replace("<!-- SEMANTIC_START -->\n", "<!-- SEMANTIC_START -->\nHUMAN RUNBOOK NOTES\n")
    state = {"source_ref": "abc", "schema_version": "1", "generator_version": "0.3.0",
             "index_hash": "sha256:cafe", "item_count": 12, "built_at": "t"}
    regenerated = ug.generate_umbrella(REGISTRY, "infra", edited, state)
    assert "HUMAN RUNBOOK NOTES" in regenerated
    # idempotent once stable
    assert ug.generate_umbrella(REGISTRY, "infra", regenerated, state) == regenerated


def test_umbrella_without_index_state_degrades_gracefully():
    out = ug.generate_umbrella(REGISTRY, "infra", None, None)
    assert "## Knowledge Index" in out
    assert "service-knowledge index build" in out
