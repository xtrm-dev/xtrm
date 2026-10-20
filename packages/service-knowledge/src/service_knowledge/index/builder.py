"""Index builder: ingest registry + SKILL sections + claims + citations + probes.

Produces the derived per-repo projection (research §3.4) in two layers:

* vaultctl document layer — every registered service SKILL.md is indexed via
  ``vaultctl.store.indexer.index_source`` so the whole-skill BM25 search, the wikilink
  resolution graph and in-degree stats are reused unchanged (cross-service navigation).
* sk_ domain layer — registry entries become ``kind=service`` items; each ``## `` section
  becomes a ``kind=section`` item; PR1 claim manifests (when present) become ``kind=claim``
  items; health-check probes become ``kind=probe`` items; extracted citations land in
  ``sk_citations``.

Provenance (§3.6): the current view is mutable (UPSERT by id); claims no longer produced by
the source flip to ``superseded``/``invalidated`` and are excluded from default retrieval;
``sk_retrieval_events`` is append-only and never touched by a rebuild. Secret VALUES are
scrubbed at ingestion and ``.env`` files are skipped.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import bootstrap  # type: ignore[import-not-found]
from vaultctl.core.models import SourceConfig
from vaultctl.store import indexer as vaultctl_indexer
from vaultctl.store.link_resolver import slugify

from service_knowledge import __version__
from service_knowledge.index import citations as citations_mod
from service_knowledge.index import claims as claims_mod
from service_knowledge.index import freshness as freshness_mod
from service_knowledge.index import inputs as inputs_mod
from service_knowledge.index import probes as probes_mod
from service_knowledge.index import ranking, schema, secrets, telemetry
from service_knowledge.index.markdown_sections import parse_skill

VAULTCTL_SOURCE_ID = "service-knowledge"
# Bounded to per-service SKILLs under a services/ dir — never machinery reference skills.
VAULTCTL_INCLUDE_GLOB = ".xtrm/skills/**/services/*/SKILL.md"

_CAMEL_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
_SNAKE_RE = re.compile(r"[_\-]+")


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _literals(*parts: str) -> str:
    """Normalized searchable copy: split camelCase + snake_case/kebab into plain tokens.

    Constraint: tokenizer stays vaultctl's unicode61; compose service names + metric families
    are made searchable by indexing a normalized token copy in ``sk_items.literals``.
    """
    tokens: list[str] = []
    for part in parts:
        if not part:
            continue
        for chunk in _SNAKE_RE.split(part):
            chunk = chunk.strip()
            if not chunk:
                continue
            tokens.append(chunk.casefold())
            for sub in _CAMEL_RE.split(chunk):
                sub = sub.strip().casefold()
                if sub and sub != chunk.casefold():
                    tokens.append(sub)
    return " ".join(sorted(set(tokens)))


def _content_hash(text: str) -> str:
    return "sha256:" + hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class BuildStats:
    services: int
    items: int
    sections: int
    claims: int
    probes: int
    citations: int
    superseded: int
    duration_ms: float
    source_ref: str
    index_hash: str
    inputs_fingerprint: str


class _ItemWriter:
    """Accumulates item rows + FTS + citations, then UPSERTs them in one transaction."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self.conn = conn
        self.ids: set[str] = set()
        self.counts = {"service": 0, "section": 0, "claim": 0, "probe": 0, "conflict": 0}
        self.citation_count = 0

    def add(
        self,
        *,
        item_id: str,
        kind: str,
        repo: str,
        service_id: str,
        title: str,
        text: str,
        description: str = "",
        tags: list[str] | None = None,
        source_path: str = "",
        source_ref: str = "",
        source_hash: str = "",
        authority: str = "unverified",
        status: str = "active",
        risk: str = "low",
        territory: list[str] | None = None,
        triggers: list[str] | None = None,
        section_path: str = "",
        skill_rel_path: str = "",
        claim_type: str = "",
        verification: dict[str, Any] | None = None,
        related_ids: list[str] | None = None,
        citations: list[citations_mod.Citation] | None = None,
    ) -> None:
        scrubbed = secrets.scrub(text)
        scrubbed_desc = secrets.scrub(description or text[:240])
        scrubbed_title = secrets.scrub(title).text
        tags_text = secrets.scrub(" ".join(sorted(set(tags or [])))).text
        scrubbed_section_path = secrets.scrub(section_path).text
        literals = _literals(service_id, scrubbed_title, tags_text, scrubbed_section_path)
        self.conn.execute(
            """
            INSERT INTO sk_items(
              id, kind, repo, service_id, title, description, text, literals, tags,
              source_path, source_ref, source_hash, authority, status, risk, territory,
              triggers, section_path, skill_rel_path, claim_type, verification, related_ids, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET
              kind=excluded.kind, repo=excluded.repo, service_id=excluded.service_id,
              title=excluded.title, description=excluded.description, text=excluded.text,
              literals=excluded.literals, tags=excluded.tags, source_path=excluded.source_path,
              source_ref=excluded.source_ref, source_hash=excluded.source_hash,
              authority=excluded.authority, status=excluded.status, risk=excluded.risk,
              territory=excluded.territory, triggers=excluded.triggers,
              section_path=excluded.section_path, skill_rel_path=excluded.skill_rel_path,
              claim_type=excluded.claim_type, verification=excluded.verification,
              related_ids=excluded.related_ids, updated_at=excluded.updated_at
            """,
            (
                item_id, kind, repo, service_id, scrubbed_title, scrubbed_desc.text, scrubbed.text,
                literals, tags_text, source_path, source_ref, source_hash, authority, status,
                risk, json.dumps(territory or []), json.dumps(triggers or []), scrubbed_section_path,
                skill_rel_path, claim_type, json.dumps(verification or {}),
                json.dumps(related_ids or []), _utc_now(),
            ),
        )
        # keep the FTS projection in sync with the current view
        self.conn.execute("DELETE FROM sk_items_fts WHERE sk_item_id=?", (item_id,))
        self.conn.execute(
            "INSERT INTO sk_items_fts(title, description, text, tags, literals, sk_item_id, service_id) "
            "VALUES (?,?,?,?,?,?,?)",
            (scrubbed_title, scrubbed_desc.text, scrubbed.text, tags_text, literals, item_id, service_id),
        )
        self.conn.execute("DELETE FROM sk_citations WHERE item_id=?", (item_id,))
        for citation in citations or []:
            self.conn.execute(
                "INSERT INTO sk_citations(item_id, path, line_start, line_end, ref, hash) VALUES (?,?,?,?,?,?)",
                (item_id, citation.path, citation.line_start, citation.line_end, source_ref, ""),
            )
            self.citation_count += 1
        self.ids.add(item_id)
        self.counts[kind] += 1


def _index_vaultctl_documents(conn: sqlite3.Connection, consumer_root: Path) -> None:
    """Reuse vaultctl's indexer for scrubbed whole-SKILL documents and link graph."""
    with tempfile.TemporaryDirectory(prefix="service-knowledge-vaultctl-") as staging:
        staging_root = Path(staging)
        for source_path in consumer_root.glob(VAULTCTL_INCLUDE_GLOB):
            if not source_path.is_file():
                continue
            relative_path = source_path.relative_to(consumer_root)
            if secrets.should_skip_file(str(relative_path)):
                continue
            try:
                text = source_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            target_path = staging_root / relative_path
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_text(secrets.scrub(text).text, encoding="utf-8")

        source = SourceConfig(
            id=VAULTCTL_SOURCE_ID,
            root=staging_root,
            include_glob=VAULTCTL_INCLUDE_GLOB,
        )
        vaultctl_indexer.index_source(conn, source, full=True)


def _service_skill_rel_path(service: dict[str, Any], service_id: str, consumer_root: Path) -> str:
    skill_path = service.get("skill_path")
    if skill_path:
        return str(skill_path)
    try:
        return bootstrap.get_service_skill_path_str(service_id, str(consumer_root))
    except (bootstrap.BootstrapError, OSError, ValueError):
        return f"{service_id}/SKILL.md"


def build(consumer_root: Path, *, repo_name: str | None = None) -> BuildStats:
    """Full rebuild of the per-repo index. Idempotent: same source -> same projection."""
    started = time.perf_counter()
    consumer_root = Path(consumer_root).resolve()
    repo = repo_name or consumer_root.name
    conn = schema.connect(consumer_root)
    source_ref = freshness_mod.git_head(str(consumer_root))

    try:
        _index_vaultctl_documents(conn, consumer_root)
        registry = bootstrap.load_registry(str(consumer_root))
        services = registry.get("services", {})
        writer = _ItemWriter(conn)

        for service_id in sorted(services):
            service = services[service_id]
            territory = list(service.get("territory", []))
            triggers = list(service.get("triggers", []))
            skill_rel = _service_skill_rel_path(service, service_id, consumer_root)
            skill_abs = consumer_root / skill_rel
            description = str(service.get("description") or service.get("name") or service_id)

            writer.add(
                item_id=f"service:{service_id}",
                kind="service",
                repo=repo,
                service_id=service_id,
                title=str(service.get("name") or service_id),
                text=description,
                description=description,
                tags=[service_id, *triggers],
                source_path=skill_rel,
                source_ref=source_ref,
                source_hash=_content_hash(description),
                authority=ranking.AUTHORITY_CURATED,
                status=ranking.STATUS_ACTIVE,
                territory=territory,
                triggers=triggers,
                skill_rel_path=skill_rel,
            )

            if not skill_abs.exists() or secrets.should_skip_file(skill_rel):
                continue
            try:
                skill_text = skill_abs.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            parsed = parse_skill(skill_text)

            for section in parsed.sections:
                section_id = f"section:{service_id}:{slugify(section.heading) or 'section'}"
                section_citations = list(citations_mod.extract_citations(section.body))
                writer.add(
                    item_id=section_id,
                    kind="section",
                    repo=repo,
                    service_id=service_id,
                    title=section.heading,
                    text=section.body,
                    description=section.body[:240],
                    tags=[service_id, slugify(section.heading)],
                    source_path=f"{skill_rel}#L{section.line_start}-L{section.line_end}",
                    source_ref=source_ref,
                    source_hash=_content_hash(section.body),
                    authority=ranking.AUTHORITY_CURATED,
                    status=ranking.STATUS_ACTIVE,
                    territory=territory,
                    triggers=triggers,
                    section_path=section.heading_path,
                    skill_rel_path=skill_rel,
                    related_ids=[f"service:{service_id}"],
                    citations=section_citations,
                )
                for probe in probes_mod.extract_probes(section.heading, section.body, section.heading_path):
                    probe_id = f"probe:{service_id}:{slugify(probe.command[:40]) or 'probe'}"
                    writer.add(
                        item_id=probe_id,
                        kind="probe",
                        repo=repo,
                        service_id=service_id,
                        title=f"Health probe — {service_id}",
                        text=probe.command,
                        description=f"Read-only health probe for {service_id}",
                        tags=[service_id, "probe", "health"],
                        source_path=f"{skill_rel}#L{section.line_start}",
                        source_ref=source_ref,
                        source_hash=_content_hash(probe.command),
                        authority=ranking.AUTHORITY_CURATED,
                        status=ranking.STATUS_ACTIVE,
                        territory=territory,
                        triggers=triggers,
                        section_path=probe.section_path,
                        skill_rel_path=skill_rel,
                        related_ids=[section_id],
                    )

            skill_dir = skill_abs.parent
            for claim in claims_mod.load_claims(skill_dir, consumer_root, service_id):
                claim_citations = [
                    citations_mod.Citation(
                        path=str(c.get("path", "")),
                        line_start=c.get("line_start"),
                        line_end=c.get("line_end"),
                    )
                    for c in claim.citations
                    if c.get("path")
                ]
                verdict = str(claim.verification.get("verdict") or "unverified")
                claim_status = claim.status
                if verdict == "invalidated" or claim_status == "invalidated":
                    claim_status = ranking.STATUS_INVALIDATED
                writer.add(
                    item_id=f"claim:{claim.claim_id}",
                    kind="claim",
                    repo=repo,
                    service_id=service_id,
                    title=f"{claim.claim_type}: {claim.text[:80]}",
                    text=claim.text,
                    description=claim.text[:240],
                    tags=[service_id, claim.claim_type, "claim"],
                    source_path=str(claim.source.get("path") or skill_rel),
                    source_ref=str(claim.source.get("ref") or source_ref),
                    source_hash=str(claim.source.get("hash") or _content_hash(claim.text)),
                    authority=claim.authority,
                    status=claim_status,
                    risk=claim.risk,
                    territory=territory,
                    triggers=triggers,
                    skill_rel_path=skill_rel,
                    claim_type=claim.claim_type,
                    verification=claim.verification,
                    related_ids=[f"service:{service_id}"],
                    citations=claim_citations,
                )

        superseded = _supersede_stale_claims(conn, writer.ids)
        index_hash = _compute_index_hash(conn)
        inputs_fingerprint = inputs_mod.fingerprint_inputs(consumer_root) or ""
        _write_index_state(conn, source_ref, index_hash, writer, len(services), inputs_fingerprint)
        conn.commit()

        duration_ms = (time.perf_counter() - started) * 1000.0
        stats = BuildStats(
            services=len(services),
            items=sum(writer.counts.values()),
            sections=writer.counts["section"],
            claims=writer.counts["claim"],
            probes=writer.counts["probe"],
            citations=writer.citation_count,
            superseded=superseded,
            duration_ms=duration_ms,
            source_ref=source_ref,
            index_hash=index_hash,
            inputs_fingerprint=inputs_fingerprint,
        )
        telemetry.emit(
            consumer_root,
            "rebuild",
            source_ref=source_ref,
            item_count=stats.items,
            services_count=stats.services,
            candidate_count=stats.items,
            duration_ms=round(duration_ms, 2),
            index_hash=index_hash,
            generator_version=__version__,
        )
        return stats
    finally:
        conn.close()


def _supersede_stale_claims(conn: sqlite3.Connection, generated_ids: set[str]) -> int:
    """Flip pre-existing claims no longer produced by the source to ``superseded`` (§3.6).

    Structural items (service/section/probe) are derived and safe to drop when gone; claims are
    provenance-bearing, so they are kept and marked superseded instead of deleted — default
    retrieval excludes them but the audit trail survives.
    """
    rows = conn.execute("SELECT id, kind FROM sk_items").fetchall()
    superseded = 0
    for row in rows:
        item_id = str(row["id"])
        if item_id in generated_ids:
            continue
        if row["kind"] == "claim":
            conn.execute("UPDATE sk_items SET status=?, updated_at=? WHERE id=?",
                         (ranking.STATUS_SUPERSEDED, _utc_now(), item_id))
            superseded += 1
        else:
            conn.execute("DELETE FROM sk_items_fts WHERE sk_item_id=?", (item_id,))
            conn.execute("DELETE FROM sk_citations WHERE item_id=?", (item_id,))
            conn.execute("DELETE FROM sk_items WHERE id=?", (item_id,))
    return superseded


def _compute_index_hash(conn: sqlite3.Connection) -> str:
    rows = conn.execute(
        "SELECT id, kind, status, source_hash FROM sk_items ORDER BY id"
    ).fetchall()
    digest = hashlib.sha256()
    for row in rows:
        digest.update(f"{row['id']}|{row['kind']}|{row['status']}|{row['source_hash']}\n".encode())
    return "sha256:" + digest.hexdigest()


def _write_index_state(
    conn: sqlite3.Connection, source_ref: str, index_hash: str, writer: _ItemWriter, services: int,
    inputs_fingerprint: str = "",
) -> None:
    conn.execute(
        """
        INSERT INTO sk_index_state(id, source_ref, schema_version, generator_version,
                                    index_hash, item_count, services_count,
                                    inputs_fingerprint, built_at)
        VALUES (1,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          source_ref=excluded.source_ref, schema_version=excluded.schema_version,
          generator_version=excluded.generator_version, index_hash=excluded.index_hash,
          item_count=excluded.item_count, services_count=excluded.services_count,
          inputs_fingerprint=excluded.inputs_fingerprint, built_at=excluded.built_at
        """,
        (source_ref, schema.SCHEMA_VERSION, __version__, index_hash,
         sum(writer.counts.values()), services, inputs_fingerprint, _utc_now()),
    )
