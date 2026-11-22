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
from service_knowledge.index import ranking, schema, sync_sections


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


def _over_budget(bundle: dict[str, Any]) -> bool:
    return _estimate_tokens(json.dumps(bundle, ensure_ascii=False)) > ranking.BUNDLE_MAX_TOKENS


TEXT_TRUNCATED_MARK = " …[truncated; call knowledge_get with this item's id for the full text]"
_MIN_TEXT_CHARS = 200


def _shrink_item_text(bundle: dict[str, Any]) -> None:
    """Last resort: the first item alone can exceed the budget (one section holding every sync
    block of a service). Cut the longest item text, mark it, and keep ``text_chars`` so the
    reader knows how much exists."""
    for _ in range(8):
        excess = _estimate_tokens(json.dumps(bundle, ensure_ascii=False)) - ranking.BUNDLE_MAX_TOKENS
        if excess <= 0:
            return
        candidates = [i for i in bundle["items"] if len(i.get("text") or "") > _MIN_TEXT_CHARS]
        if not candidates:
            return
        item = max(candidates, key=lambda i: len(i["text"]))
        text = item["text"]
        item.setdefault("text_chars", len(text))
        cut = excess * ranking.CHARS_PER_TOKEN + len(TEXT_TRUNCATED_MARK) + 64
        keep = max(_MIN_TEXT_CHARS, len(text) - cut)
        if item.get("text_truncated"):
            text = text[: -len(TEXT_TRUNCATED_MARK)]
            keep = max(_MIN_TEXT_CHARS, len(text) - cut)
        item["text"] = text[:keep] + TEXT_TRUNCATED_MARK
        item["text_truncated"] = True


def _trim_to_budget(bundle: dict[str, Any]) -> dict[str, Any]:
    """Fit the bundle to BUNDLE_MAX_TOKENS and say what was cut.

    Order: lowest-ranked items first (with the citations and verification rows that belong to
    them), then the citation tail, then the probe tail, then the longest item text. The first item
    is never dropped, but its citations and text can be cut: one item alone was enough to return
    ~64k chars. A cut text carries ``text_truncated`` and ``text_chars``.
    ``totals`` always holds the counts before trimming; ``truncated`` is true when anything went.
    """
    totals = {
        "items": len(bundle["items"]),
        "citations": len(bundle["citations"]),
        "probes": len(bundle["probes"]),
    }
    # The report keys count toward the size they describe, so they go in before the first measure.
    bundle["totals"] = totals
    bundle["truncated"] = False
    while len(bundle["items"]) > 1 and _over_budget(bundle):
        dropped = bundle["items"].pop()["id"]  # results are pre-sorted desc; tail is lowest-ranked
        bundle["citations"] = [c for c in bundle["citations"] if c.get("item_id") != dropped]
        bundle["verification"] = [v for v in bundle["verification"] if v.get("item_id") != dropped]
    while bundle["citations"] and _over_budget(bundle):
        bundle["citations"].pop()
    while bundle["probes"] and _over_budget(bundle):
        bundle["probes"].pop()
    _shrink_item_text(bundle)
    bundle["truncated"] = (
        any(i.get("text_truncated") for i in bundle["items"])
        or len(bundle["items"]) < totals["items"]
        or len(bundle["citations"]) < totals["citations"]
        or len(bundle["probes"]) < totals["probes"]
    )
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

    conn = schema.connect(consumer_root)
    try:
        newest_by_service = {sid: sync_sections.newest_sync_date(conn, sid) for sid in service_ids}
    finally:
        conn.close()

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
            **sync_sections.section_fields(
                item.get("section_path") or "", newest_by_service.get(item.get("service_id", "")),
            ),
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
