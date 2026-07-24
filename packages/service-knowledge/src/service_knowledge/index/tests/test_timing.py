"""Rebuild gate: 17-service mercury-infra-shaped consumer rebuilds in <= 60s."""
from __future__ import annotations

from service_knowledge import index

BUDGET_SECONDS = 60.0


def test_rebuild_17_services_within_budget(infra_consumer):
    stats = index.build(infra_consumer)
    assert stats.services == 17
    assert stats.items > 17  # service + section + probe rows
    assert (stats.duration_ms / 1000.0) <= BUDGET_SECONDS, (
        f"rebuild took {stats.duration_ms / 1000.0:.2f}s > {BUDGET_SECONDS}s budget"
    )
