"""Ranking wrapper over vaultctl's BM25 + the sk_items_fts domain index (research §3.5).

``score = 0.40 T + 0.30 L + 0.15 I + 0.10 A + 0.05 F`` then the post-rank penalty lattice.

* **L** (lexical) pulls BM25 from vaultctl: ``vaultctl.store.search.search_documents`` ranks the
  whole-SKILL documents; the section-granularity ``sk_items_fts`` BM25 ranks within a skill. A
  candidate's raw lexical score is the best (most-negative) of its section BM25 and its parent
  document's vaultctl BM25; L is that score's percentile within the candidate set.
* **T / I / A / F** are computed on top in Python (interpretable, reproducible — no learned
  reranker, no RRF: there is a single lexical retriever plus structural signals).

Default retrieval admits only the current view (``active`` / ``stale`` / ``stale_pending``);
``superseded`` / ``invalidated`` / ``conflicted`` are excluded unless explicitly requested.
"""
from __future__ import annotations

import fnmatch
import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from vaultctl.store import search as vaultctl_search

from service_knowledge.index import _compat  # noqa: F401  (ensures scripts/ importable)
from service_knowledge.index import freshness as freshness_mod
from service_knowledge.index import ranking, schema, telemetry

import bootstrap  # type: ignore[import-not-found]  # noqa: E402

_VERDICT_VERIFIED = {"verified", "pass", "verified_pass", "supported"}
_VERDICT_INSUFFICIENT = {"insufficient_evidence", "insufficient", "unknown"}


@dataclass(frozen=True)
class QueryContext:
    query: str = ""
    paths: tuple[str, ...] = ()
    service_id: str | None = None
    include_inactive: bool = False
    limit: int = ranking.BUNDLE_MAX_ITEMS


@dataclass(frozen=True)
class RankedItem:
    item: dict[str, Any]
    score: float
    signals: dict[str, float]
    penalties: tuple[str, ...] = ()
    advisories: tuple[str, ...] = ()


def _territory_base(pattern: str) -> str:
    return pattern.replace("/**/*", "").replace("/**", "").replace("/*", "").rstrip("/")


def _path_in_territory(path: str, territory: list[str]) -> bool:
    for pattern in territory:
        if fnmatch.fnmatch(path, pattern):
            return True
        base = _territory_base(pattern)
        if base and (path == base or path.startswith(base + "/")):
            return True
    return False


def _query_path_tokens(query: str) -> list[str]:
    return [token for token in query.split() if "/" in token or "." in token]


def _territory_signal(item: dict[str, Any], ctx: QueryContext) -> float:
    territory = item.get("territory", [])
    for path in ctx.paths:
        if _path_in_territory(path, territory):
            return ranking.T_PATH_OWNED
    for path in _query_path_tokens(ctx.query):
        if _path_in_territory(path, territory):
            return ranking.T_PATH_OWNED
    if ctx.service_id and item.get("service_id") == ctx.service_id:
        return ranking.T_SERVICE_EXPLICIT
    triggers = item.get("triggers", [])
    query_lower = ctx.query.casefold()
    if triggers and any(trigger.casefold() in query_lower for trigger in triggers if trigger):
        return ranking.T_TRIGGER
    return ranking.T_NONE


def _intent_signal(item: dict[str, Any], ctx: QueryContext) -> float:
    """Fraction of the query's literal tokens that exactly match the item's searchable surface."""
    tokens = [t for t in ctx.query.casefold().split() if len(t) >= 3]
    tokens.extend(t.casefold() for t in ctx.paths)
    tokens = sorted(set(tokens))
    if not tokens:
        return 0.0
    haystack = " ".join(
        [
            str(item.get("title", "")).casefold(),
            str(item.get("tags", "")).casefold(),
            str(item.get("literals", "")).casefold(),
            str(item.get("service_id", "")).casefold(),
            " ".join(t.casefold() for t in item.get("triggers", [])),
            " ".join(c.get("path", "").casefold() for c in item.get("citations", [])),
        ]
    )
    matched = sum(1 for token in tokens if token in haystack)
    return matched / len(tokens)


def _authority_score(item: dict[str, Any]) -> float:
    authority = item.get("authority", ranking.AUTHORITY_UNVERIFIED)
    if authority == ranking.AUTHORITY_MEMORY:
        return ranking.AUTHORITY_BASE[ranking.AUTHORITY_MEMORY]
    verdict = str(item.get("verification", {}).get("verdict", "")).casefold()
    if verdict in _VERDICT_VERIFIED:
        base = ranking.AUTHORITY_BASE.get(authority, ranking.AUTHORITY_BASE[ranking.AUTHORITY_AUTO])
        return max(base, ranking.AUTHORITY_BASE[ranking.AUTHORITY_AUTO])
    return ranking.AUTHORITY_BASE[ranking.AUTHORITY_UNVERIFIED]


def _is_verified(item: dict[str, Any]) -> bool:
    verdict = str(item.get("verification", {}).get("verdict", "")).casefold()
    return verdict in _VERDICT_VERIFIED or item.get("authority") == ranking.AUTHORITY_CURATED


def _load_item_row(conn: sqlite3.Connection, item_id: str) -> dict[str, Any] | None:
    row = conn.execute("SELECT * FROM sk_items WHERE id=?", (item_id,)).fetchone()
    if row is None:
        return None
    return _hydrate(conn, row)


def _hydrate(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    item = dict(row)
    for json_field in ("territory", "triggers", "related_ids"):
        try:
            item[json_field] = json.loads(item.get(json_field) or "[]")
        except (json.JSONDecodeError, TypeError):
            item[json_field] = []
    try:
        item["verification"] = json.loads(item.get("verification") or "{}")
    except (json.JSONDecodeError, TypeError):
        item["verification"] = {}
    citation_rows = conn.execute(
        "SELECT path, line_start, line_end, ref FROM sk_citations WHERE item_id=?", (item["id"],)
    ).fetchall()
    item["citations"] = [dict(c) for c in citation_rows]
    return item


def _candidate_lexical_scores(
    conn: sqlite3.Connection, ctx: QueryContext
) -> dict[str, float]:
    """Map item_id -> raw lexical score (negative BM25; lower is better).

    Combines the section-granularity sk_items_fts BM25 with vaultctl's whole-document BM25
    (pulled via vaultctl.store.search.search_documents) so a section inherits its skill's
    document relevance even when the section text alone would not match.
    """
    scores: dict[str, float] = {}
    query = ctx.query.strip()
    if query:
        try:
            fts_rows = conn.execute(
                "SELECT sk_item_id, bm25(sk_items_fts, 8.0, 4.0, 1.0, 2.0, 3.0) AS score "
                "FROM sk_items_fts WHERE sk_items_fts MATCH ? ORDER BY score LIMIT 200",
                (query,),
            ).fetchall()
            for row in fts_rows:
                scores[str(row["sk_item_id"])] = float(row["score"])
        except sqlite3.OperationalError:
            pass

        # vaultctl document-level BM25 → inherited by every item of a matched skill document.
        doc_scores: dict[str, float] = {}
        try:
            for result in vaultctl_search.search_documents(conn, query, limit=50):
                rel_path = str(result.get("rel_path", ""))
                if rel_path:
                    doc_scores[rel_path] = float(result.get("score", 0.0))
        except sqlite3.OperationalError:
            pass
        if doc_scores:
            placeholders = ",".join("?" for _ in doc_scores)
            rows = conn.execute(
                f"SELECT id, skill_rel_path FROM sk_items WHERE skill_rel_path IN ({placeholders})",
                tuple(doc_scores),
            ).fetchall()
            for row in rows:
                item_id = str(row["id"])
                doc_score = doc_scores[str(row["skill_rel_path"])]
                if item_id not in scores or doc_score < scores[item_id]:
                    scores[item_id] = doc_score
    return scores


def _percentile_map(scores: dict[str, float]) -> dict[str, float]:
    """Convert raw BM25 (lower=better) to a 0..1 percentile (best=1.0) within the set."""
    if not scores:
        return {}
    ordered = sorted(scores.items(), key=lambda kv: kv[1])  # most-negative (best) first
    n = len(ordered)
    if n == 1:
        return {ordered[0][0]: 1.0}
    return {item_id: 1.0 - idx / (n - 1) for idx, (item_id, _) in enumerate(ordered)}


def _freshness_by_service(
    repo_root: str, registry: dict[str, Any], service_ids: set[str]
) -> dict[str, tuple[float, int | None]]:
    out: dict[str, tuple[float, int | None]] = {}
    services = registry.get("services", {})
    for service_id in service_ids:
        service = services.get(service_id, {})
        ref = str(service.get("last_sync_ref") or "")
        territory = list(service.get("territory", []))
        out[service_id] = freshness_mod.compute(repo_root, ref, territory)
    return out


def _apply_penalties(item: dict[str, Any], score: float) -> tuple[float, tuple[str, ...], tuple[str, ...]]:
    penalties: list[str] = []
    advisories: list[str] = []
    status = item.get("status", ranking.STATUS_ACTIVE)
    risk = item.get("risk", "low")
    verdict = str(item.get("verification", {}).get("verdict", "")).casefold()

    if status == ranking.STATUS_INVALIDATED:
        return float("-inf"), ("invalidated-excluded",), advisories
    if status == ranking.STATUS_CONFLICTED and risk == ranking.RISK_HIGH:
        return float("-inf"), ("conflicted-high-risk-excluded",), advisories

    if status in (ranking.STATUS_STALE, ranking.STATUS_STALE_PENDING) and risk == ranking.RISK_HIGH:
        score += ranking.PENALTY_STALE_HIGH_RISK
        penalties.append("stale-high-risk")
        advisories.append("stale: territory changed since source_ref (high-risk)")
    if verdict in _VERDICT_INSUFFICIENT and risk == ranking.RISK_HIGH:
        score += ranking.PENALTY_INSUFFICIENT_EVIDENCE_HIGH_RISK
        penalties.append("insufficient-evidence-high-risk")
        advisories.append("insufficient evidence (high-risk)")
    if not _is_verified(item):
        score += ranking.PENALTY_UNVERIFIED_SOURCE
        penalties.append("unverified-source")
    return score, tuple(penalties), tuple(advisories)


def rank(conn: sqlite3.Connection, consumer_root: Path, ctx: QueryContext) -> list[RankedItem]:
    """Rank candidates for ``ctx``; returns the top items (post-filter + penalty)."""
    consumer_root = Path(consumer_root)
    lexical = _candidate_lexical_scores(conn, ctx)

    # Path-driven context (knowledge_evidence_for_files): seed candidates by territory ownership.
    path_owned_ids: set[str] = set()
    if ctx.paths:
        rows = conn.execute("SELECT id, territory FROM sk_items").fetchall()
        for row in rows:
            try:
                territory = json.loads(row["territory"] or "[]")
            except (json.JSONDecodeError, TypeError):
                territory = []
            if any(_path_in_territory(p, territory) for p in ctx.paths):
                path_owned_ids.add(str(row["id"]))
                lexical.setdefault(str(row["id"]), 0.0)

    if ctx.service_id:
        rows = conn.execute("SELECT id FROM sk_items WHERE service_id=?", (ctx.service_id,)).fetchall()
        for row in rows:
            lexical.setdefault(str(row["id"]), 0.0)

    if not lexical:
        return []

    percentiles = _percentile_map(lexical)
    registry = bootstrap.load_registry(str(consumer_root))
    service_ids = {
        str(conn.execute("SELECT service_id FROM sk_items WHERE id=?", (item_id,)).fetchone()["service_id"])
        for item_id in lexical
    }
    freshness = _freshness_by_service(str(consumer_root), registry, service_ids)

    ranked: list[RankedItem] = []
    for item_id, raw_lexical in lexical.items():
        row = conn.execute("SELECT * FROM sk_items WHERE id=?", (item_id,)).fetchone()
        if row is None:
            continue
        item = _hydrate(conn, row)
        status = item.get("status", ranking.STATUS_ACTIVE)
        if not ctx.include_inactive and status not in ranking.RETRIEVABLE_STATUSES:
            continue

        territory_score = ranking.T_PATH_OWNED if item_id in path_owned_ids else _territory_signal(item, ctx)
        lexical_score = percentiles.get(item_id, 0.0)
        intent_score = _intent_signal(item, ctx)
        authority_score = _authority_score(item)
        freshness_score, changed_commits = freshness.get(item.get("service_id", ""), (ranking.FRESHNESS_ABSENT_REF, None))

        score = ranking.weighted_score(
            territory_score, lexical_score, intent_score, authority_score, freshness_score
        )
        score, penalties, advisories = _apply_penalties(item, score)
        if score == float("-inf"):
            continue
        if changed_commits is None:
            advisories = (*advisories, "freshness: no source_ref — treat as stale")

        signals = {
            "T": round(territory_score, 4),
            "L": round(lexical_score, 4),
            "I": round(intent_score, 4),
            "A": round(authority_score, 4),
            "F": round(freshness_score, 4),
            "raw_lexical": round(raw_lexical, 6),
        }
        ranked.append(RankedItem(item=item, score=round(score, 6), signals=signals,
                                 penalties=penalties, advisories=advisories))

    ranked.sort(key=lambda r: r.score, reverse=True)
    return ranked[: max(ctx.limit, 1)]


def search(consumer_root: Path, ctx: QueryContext) -> dict[str, Any]:
    """Public search entry: rank + telemetry + retrieval-event audit row."""
    started = time.perf_counter()
    conn = schema.connect(consumer_root)
    try:
        ranked = rank(conn, consumer_root, ctx)
        duration_ms = (time.perf_counter() - started) * 1000.0
        source_ref = _index_source_ref(conn)
        service_ids_matched = sorted({r.item.get("service_id", "") for r in ranked if r.item.get("service_id")})
        qhash = telemetry.query_hash(ctx.query or " ".join(ctx.paths))
        _record_retrieval_event(conn, qhash, service_ids_matched, ranked, duration_ms, source_ref)
        telemetry.emit(
            consumer_root, "query",
            query_hash=qhash,
            service_ids_matched=service_ids_matched,
            top_score=ranked[0].score if ranked else None,
            candidate_count=len(ranked),
            duration_ms=round(duration_ms, 2),
            source_ref=source_ref,
        )
        return {
            "query": ctx.query,
            "paths": list(ctx.paths),
            "service_id": ctx.service_id,
            "source_ref": source_ref,
            "results": [
                {"item": r.item, "score": r.score, "signals": r.signals,
                 "penalties": list(r.penalties), "advisories": list(r.advisories)}
                for r in ranked
            ],
            "duration_ms": round(duration_ms, 2),
        }
    finally:
        conn.close()


def get_item(consumer_root: Path, item_id: str) -> dict[str, Any] | None:
    """Fetch one item by id (knowledge_get); includes the full-skill link."""
    conn = schema.connect(consumer_root)
    try:
        item = _load_item_row(conn, item_id)
        if item is None:
            return None
        item["skill_link"] = item.get("skill_rel_path", "")
        return item
    finally:
        conn.close()


def get_full_skill(consumer_root: Path, skill_rel_path: str) -> dict[str, Any] | None:
    """Return the full SKILL.md text via vaultctl's document layer (knowledge_get full skill)."""
    conn = schema.connect(consumer_root)
    try:
        row = conn.execute(
            "SELECT rel_path, title, body, status FROM documents WHERE source_id=? AND rel_path=?",
            ("service-knowledge", skill_rel_path),
        ).fetchone()
        if row is None:
            abs_path = Path(consumer_root) / skill_rel_path
            if abs_path.exists():
                return {"rel_path": skill_rel_path, "title": abs_path.stem,
                        "body": abs_path.read_text(encoding="utf-8", errors="replace"), "status": None}
            return None
        return dict(row)
    finally:
        conn.close()


def _index_source_ref(conn: sqlite3.Connection) -> str:
    row = conn.execute("SELECT source_ref FROM sk_index_state WHERE id=1").fetchone()
    return str(row["source_ref"]) if row else ""


def _record_retrieval_event(
    conn: sqlite3.Connection,
    qhash: str,
    service_ids: list[str],
    ranked: list[RankedItem],
    duration_ms: float,
    source_ref: str,
) -> None:
    import hashlib

    bundle_repr = "|".join(f"{r.item.get('id')}:{r.score}" for r in ranked)
    bundle_hash = "sha256:" + hashlib.sha256(bundle_repr.encode("utf-8")).hexdigest()[:32]
    conn.execute(
        "INSERT INTO sk_retrieval_events(query_hash, service_ids_matched, top_score, "
        "candidate_count, bundle_hash, duration_ms, source_ref) VALUES (?,?,?,?,?,?,?)",
        (qhash, json.dumps(service_ids), ranked[0].score if ranked else None,
         len(ranked), bundle_hash, round(duration_ms, 2), source_ref),
    )
    conn.commit()
