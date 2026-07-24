"""Smoke tests for the three read-only retrieval surfaces against the alertmanager fixture."""
from __future__ import annotations

from service_knowledge import index


def test_knowledge_search_discord_webhook(alertmanager_consumer):
    index.build(alertmanager_consumer)
    result = index.search(alertmanager_consumer, "discord webhook")
    results = result["results"]
    assert results, "expected hits for 'discord webhook'"
    # alertmanager is the matched service; a SECTION is the top carrier with territory matched
    assert results[0]["item"]["service_id"] == "alertmanager"
    top_section = next(r for r in results if r["item"]["kind"] == "section")
    assert top_section["item"]["service_id"] == "alertmanager"
    assert top_section["signals"]["T"] > 0  # trigger ('discord'/'webhook') matched territory
    # the notifications section that actually mentions the discord webhook surfaces
    assert any("notification" in r["item"]["id"] for r in results)


def test_knowledge_evidence_for_files(alertmanager_consumer):
    index.build(alertmanager_consumer)
    bundle = index.evidence_for_files(alertmanager_consumer, ["alertmanager/alertmanager.yml"])
    assert bundle["routing"]["matched_services"] == ["alertmanager"]
    assert bundle["items"], "bundle should carry top items"
    assert bundle["items"][0]["service_id"] == "alertmanager"
    assert bundle["citations"] is not None
    assert bundle["verification"], "bundle should carry verification/freshness"
    assert bundle["skill_links"].get("alertmanager", "").endswith("SKILL.md")
    assert bundle["probes"], "health probe should be attached"
    assert bundle["token_estimate"] <= 8000


def test_knowledge_get_item(alertmanager_consumer):
    index.build(alertmanager_consumer)
    item = index.get_item(alertmanager_consumer, "section:alertmanager:notifications")
    assert item is not None
    assert item["kind"] == "section"
    assert item["skill_link"].endswith("SKILL.md")
    assert "Discord webhook" in item["text"]


def test_knowledge_get_full_skill(alertmanager_consumer):
    index.build(alertmanager_consumer)
    skill = index.get_full_skill(
        alertmanager_consumer,
        ".xtrm/skills/infra/service-knowledge/services/alertmanager/SKILL.md",
    )
    assert skill is not None
    assert "Alertmanager Expert" in skill["body"]


def test_get_missing_item_returns_none(alertmanager_consumer):
    index.build(alertmanager_consumer)
    assert index.get_item(alertmanager_consumer, "section:nope:nope") is None
