"""Evidence-bundle assembly (research §3.2).

A bundle is the retrieval unit handed to a caller. It carries, in order: a routing header; the
3–7 most relevant items; citations to code/config; verification + freshness state; conflicts /
caveats; applicable read-only probes; and a link to each full skill. The knowledge layer returns
*evidence*, never conclusions — there is deliberately no ``answer()``. Serialized size is capped
at ``BUNDLE_MAX_TOKENS`` (≈ chars/4); overflow trims the lowest-ranked items first.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from service_knowledge.index import gate as gate_mod
from service_knowledge.index import ranking, schema


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // ranking.CHARS_PER_TOKEN)


def _routing_header(ctx_query: str, paths: list[str], service_ids: list[str], source_ref: str) -> dict[str, Any]:
    return {
        "query": ctx_query,
        "paths": paths,
        "matched_services": service_ids,
        "source_ref": source_ref,
        "retrieval": "service-knowledge FTS5 (vaultctl BM25 + T/I/A/F overlay)",
    }


def _probes_for_services(conn, service_ids: list[str]) -> list[dict[str, Any]]:
    if not service_ids:
        return []
    placeholders = ",".join("?" for _ in service_ids)
    rows = conn.execute(
        f"SELECT id, service_id, title, text, section_path FROM sk_items "
        f"WHERE kind='probe' AND service_id IN ({placeholders}) AND status IN ({','.join('?' for _ in ranking.RETRIEVABLE_STATUSES)})",
        (*service_ids, *ranking.RETRIEVABLE_STATUSES),
    ).fetchall()
    return [dict(row) for row in rows]


def _caveats_for_services(conn, service_ids: list[str]) -> list[dict[str, Any]]:
    """Conflicted / stale-high-risk claims surfaced as caveats (excluded from the main items)."""
    if not service_ids:
        return []
    placeholders = ",".join("?" for _ in service_ids)
    rows = conn.execute(
        f"SELECT id, service_id, title, status, risk FROM sk_items "
        f"WHERE kind='claim' AND service_id IN ({placeholders}) "
        f"AND (status IN ('conflicted','invalidated') OR (status IN ('stale','stale_pending_verification') AND risk='high'))",
        (*service_ids,),
    ).fetchall()
    caveats = [dict(row) for row in rows]
    conflict_rows = conn.execute(
        f"SELECT c.item_id, c.conflicts_with, c.authority, c.note FROM sk_conflicts c "
        f"JOIN sk_items i ON i.id=c.item_id WHERE i.service_id IN ({placeholders})",
        (*service_ids,),
    ).fetchall()
    for row in conflict_rows:
        caveats.append({"id": row["item_id"], "conflicts_with": row["conflicts_with"],
                        "authority": row["authority"], "note": row["note"], "status": "conflicted"})
    return caveats


def _trim_to_budget(bundle: dict[str, Any]) -> dict[str, Any]:
    """Drop lowest-ranked items until the serialized bundle fits BUNDLE_MAX_TOKENS."""
    while bundle["items"]:
        serialized = json.dumps(bundle, ensure_ascii=False)
        if _estimate_tokens(serialized) <= ranking.BUNDLE_MAX_TOKENS:
            break
        if len(bundle["items"]) <= 1:
            break
        bundle["items"].pop()  # results are pre-sorted desc; tail is lowest-ranked
    bundle["token_estimate"] = _estimate_tokens(json.dumps(bundle, ensure_ascii=False))
    return bundle


def build_bundle(search_result: dict[str, Any], consumer_root: Path) -> dict[str, Any]:
    """Assemble a §3.2 evidence bundle from a ``query.search`` result."""
    consumer_root = Path(consumer_root)
    gate_outcome = gate_mod.ensure_fresh(consumer_root, reason="build_bundle")
    results = search_result.get("results", [])
    paths = list(search_result.get("paths", []))
    source_ref = str(search_result.get("source_ref", ""))

    top = results[: ranking.BUNDLE_MAX_ITEMS]
    service_ids = sorted({r["item"].get("service_id", "") for r in top if r["item"].get("service_id")})

    items = []
    skill_links: dict[str, str] = {}
    citations: list[dict[str, Any]] = []
    verification: list[dict[str, Any]] = []
    for r in top:
        item = r["item"]
        items.append({
            "id": item.get("id"),
            "kind": item.get("kind"),
            "service_id": item.get("service_id"),
            "title": item.get("title"),
            "section_path": item.get("section_path"),
            "text": item.get("text"),
            "score": r.get("score"),
            "signals": r.get("signals"),
            "penalties": r.get("penalties"),
            "advisories": r.get("advisories"),
            "status": item.get("status"),
            "risk": item.get("risk"),
        })
        if item.get("skill_rel_path"):
            skill_links[item.get("service_id", "")] = item.get("skill_rel_path")
        for citation in item.get("citations", []):
            citations.append({"item_id": item.get("id"), **citation})
        verification.append({
            "item_id": item.get("id"),
            "authority": item.get("authority"),
            "verdict": item.get("verification", {}).get("verdict", "unverified"),
            "freshness_F": (r.get("signals") or {}).get("F"),
            "status": item.get("status"),
        })

    bundle: dict[str, Any] = {
        "routing": _routing_header(search_result.get("query", ""), paths, service_ids, source_ref),
        "items": items,
        "citations": citations,
        "verification": verification,
        "conflicts_and_caveats": [],
        "probes": [],
        "skill_links": skill_links,
        "stale_served": gate_outcome.stale_served,
    }
    if gate_outcome.notice:
        bundle["routing"]["freshness_notice"] = gate_outcome.notice

    conn = schema.connect(consumer_root)
    try:
        bundle["probes"] = _probes_for_services(conn, service_ids)
        bundle["conflicts_and_caveats"] = _caveats_for_services(conn, service_ids)
    finally:
        conn.close()

    # §3.2 wants 3–7 items; pad note when fewer candidates exist rather than fabricating items.
    if len(items) < ranking.BUNDLE_MIN_ITEMS:
        bundle["routing"]["note"] = f"only {len(items)} candidate(s) matched; below the {ranking.BUNDLE_MIN_ITEMS}-item floor"

    return _trim_to_budget(bundle)
