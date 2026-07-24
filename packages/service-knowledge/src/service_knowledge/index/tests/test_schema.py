"""Schema extension: 5 domain tables exist and never collide with vaultctl's tables."""
from __future__ import annotations

from service_knowledge.index import schema


def test_domain_tables_present(alertmanager_consumer):
    conn = schema.connect(alertmanager_consumer)
    try:
        tables = set(schema.domain_tables(conn))
    finally:
        conn.close()
    assert {"sk_items", "sk_items_fts", "sk_citations", "sk_conflicts",
            "sk_retrieval_events", "sk_index_state"} <= tables


def test_no_collision_with_vaultctl_tables(alertmanager_consumer):
    conn = schema.connect(alertmanager_consumer)
    try:
        all_tables = {row[0] for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view')").fetchall()}
        vaultctl_tables = {"sources", "documents", "sections", "sections_fts",
                           "document_links", "document_graph_stats", "document_aliases",
                           "document_tags", "graph_scores"}
        domain = {t for t in all_tables if t.startswith("sk_")}
        # vaultctl base schema is present alongside, and the namespaces are disjoint
        assert vaultctl_tables <= all_tables
        assert domain.isdisjoint(vaultctl_tables)
    finally:
        conn.close()
