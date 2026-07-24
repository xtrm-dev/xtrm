"""Ranking: controlled T/L/I/A/F values produce the expected order (§3.5), plus the penalty
lattice, authority tiers and territory routing. The weighted sum is a pure function so the
ordering is fully deterministic given the five signal values."""
from __future__ import annotations

from service_knowledge.index import query as query_mod
from service_knowledge.index import ranking
from service_knowledge import index


def test_weights_sum_to_one():
    assert ranking.weights_sum_to_one()


def test_controlled_five_candidate_order():
    """Five candidates with hand-set T/L/I/A/F — expected order is by descending weighted score."""
    candidates = {
        "A": dict(territory=1.0, lexical=0.8, intent=1.0, authority=1.0, freshness=1.0),   # territory-owned, curated+verified, fresh
        "B": dict(territory=0.7, lexical=1.0, intent=0.6, authority=0.8, freshness=0.9),   # explicit service, auto+verified
        "C": dict(territory=0.3, lexical=0.9, intent=0.5, authority=0.3, freshness=0.5),   # trigger match, unverified
        "D": dict(territory=0.0, lexical=0.7, intent=0.4, authority=1.0, freshness=0.2),   # no territory, verified but stale
        "E": dict(territory=0.0, lexical=0.6, intent=0.2, authority=0.2, freshness=0.1),   # memory, weak everywhere
    }
    scored = {name: ranking.weighted_score(**sig) for name, sig in candidates.items()}
    order = sorted(scored, key=scored.get, reverse=True)
    assert order == ["A", "B", "C", "D", "E"]
    # A is the clear winner: territory (0.40) + full authority + fresh dominate
    assert scored["A"] > scored["B"] > scored["C"] > scored["D"] > scored["E"]


def test_score_formula_exact():
    # all-ones -> 1.0; all-zeros -> 0.0
    assert ranking.weighted_score(1, 1, 1, 1, 1) == 1.0
    assert ranking.weighted_score(0, 0, 0, 0, 0) == 0.0
    # territory-only contributes exactly its weight
    assert ranking.weighted_score(1, 0, 0, 0, 0) == ranking.WEIGHT_TERRITORY


def test_authority_tiers():
    curated_verified = {"authority": "curated", "verification": {"verdict": "verified"}}
    auto_verified = {"authority": "auto", "verification": {"verdict": "verified"}}
    unverified = {"authority": "curated", "verification": {"verdict": "unverified"}}
    memory = {"authority": "memory", "verification": {}}
    assert query_mod._authority_score(curated_verified) == 1.0
    assert query_mod._authority_score(auto_verified) == 0.8
    assert query_mod._authority_score(unverified) == 0.3
    assert query_mod._authority_score(memory) == 0.2


def test_penalty_lattice():
    # invalidated -> excluded
    score, penalties, _ = query_mod._apply_penalties(
        {"status": "invalidated", "risk": "low", "verification": {}}, 0.9)
    assert score == float("-inf") and "invalidated-excluded" in penalties
    # conflicted high-risk -> excluded
    score, penalties, _ = query_mod._apply_penalties(
        {"status": "conflicted", "risk": "high", "verification": {}}, 0.9)
    assert score == float("-inf") and "conflicted-high-risk-excluded" in penalties
    # stale high-risk -> -0.25
    score, penalties, _ = query_mod._apply_penalties(
        {"status": "stale", "risk": "high", "verification": {"verdict": "verified"}, "authority": "curated"}, 0.9)
    assert abs(score - (0.9 + ranking.PENALTY_STALE_HIGH_RISK)) < 1e-9
    assert "stale-high-risk" in penalties
    # insufficient evidence high-risk -> -0.15
    score, penalties, _ = query_mod._apply_penalties(
        {"status": "active", "risk": "high", "verification": {"verdict": "insufficient_evidence"}, "authority": "curated"}, 0.9)
    assert "insufficient-evidence-high-risk" in penalties
    # unverified source -> -0.10
    score, penalties, _ = query_mod._apply_penalties(
        {"status": "active", "risk": "low", "verification": {"verdict": "unverified"}, "authority": "auto"}, 0.9)
    assert "unverified-source" in penalties


def test_territory_routing_signal():
    item = {"territory": ["alertmanager/**"], "triggers": ["discord"], "service_id": "alertmanager"}
    # path owned -> 1.0
    ctx = query_mod.QueryContext(query="", paths=("alertmanager/alertmanager.yml",))
    assert query_mod._territory_signal(item, ctx) == ranking.T_PATH_OWNED
    # explicit service -> 0.7
    ctx = query_mod.QueryContext(query="", service_id="alertmanager")
    assert query_mod._territory_signal(item, ctx) == ranking.T_SERVICE_EXPLICIT
    # trigger -> 0.3
    ctx = query_mod.QueryContext(query="discord notifications down")
    assert query_mod._territory_signal(item, ctx) == ranking.T_TRIGGER
    # nothing -> 0.0
    ctx = query_mod.QueryContext(query="postgres vacuum")
    assert query_mod._territory_signal(item, ctx) == ranking.T_NONE


def test_territory_dominance_integration(alertmanager_consumer):
    """A query path owning alertmanager's territory routes alertmanager evidence to the top."""
    index.build(alertmanager_consumer)
    result = index.search(alertmanager_consumer, "notifications", paths=["alertmanager/alertmanager.yml"])
    assert result["results"], "expected at least one result"
    top = result["results"][0]
    assert top["item"]["service_id"] == "alertmanager"
    assert top["signals"]["T"] == ranking.T_PATH_OWNED
