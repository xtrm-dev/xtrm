"""Evidence bundle conforms to §3.2: routing header, 3-7 items, citations, verification,
conflicts/caveats, probes, full-skill links; serialized size capped at BUNDLE_MAX_TOKENS."""
from __future__ import annotations

from service_knowledge import index
from service_knowledge.index import ranking


def test_bundle_has_all_section3_2_parts(alertmanager_consumer):
    index.build(alertmanager_consumer)
    result = index.search(alertmanager_consumer, "discord webhook alertmanager")
    bundle = index.build_bundle(result, alertmanager_consumer)
    assert set(bundle) >= {"routing", "items", "citations", "verification",
                           "conflicts_and_caveats", "probes", "skill_links", "token_estimate"}
    assert bundle["routing"]["matched_services"]
    assert 1 <= len(bundle["items"]) <= ranking.BUNDLE_MAX_ITEMS
    assert bundle["skill_links"], "full-skill link required"


def test_bundle_respects_token_cap(alertmanager_consumer):
    index.build(alertmanager_consumer)
    result = index.search(alertmanager_consumer, "alertmanager")
    bundle = index.build_bundle(result, alertmanager_consumer)
    assert bundle["token_estimate"] <= ranking.BUNDLE_MAX_TOKENS


def test_bundle_min_items_note(infra_consumer):
    """A narrow query yielding fewer than BUNDLE_MIN_ITEMS carries an explanatory note."""
    index.build(infra_consumer)
    result = index.search(infra_consumer, "zzz-unmatched-token-zzz")
    bundle = index.build_bundle(result, infra_consumer)
    if len(bundle["items"]) < ranking.BUNDLE_MIN_ITEMS:
        assert "note" in bundle["routing"]
