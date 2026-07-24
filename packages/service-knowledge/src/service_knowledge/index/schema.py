"""Domain schema extension layered on top of vaultctl's store (research §3.4).

vaultctl's ``connect()`` creates its base schema (``documents`` / ``sections`` / ``sections_fts``
/ ``document_links`` / ``document_graph_stats`` …) — the whole-SKILL document layer, BM25 search
and the link-resolution graph are all reused unchanged. This module adds the five *domain*
tables in the ``sk_`` namespace (constraint: prefix to avoid collision; no ATTACH needed since
both layers share one SQLite file):

    sk_items             service | section | claim | probe | conflict rows (+ mutable status)
    sk_items_fts         FTS5 over title/description/text/tags/literals (section granularity)
    sk_citations         path / line-range / ref / hash per item
    sk_conflicts         incompatible claim pairs + authority
    sk_retrieval_events  append-only retrieval history (provenance audit trail)
    sk_index_state       source_ref + schema/generator version + content hash (singleton)

vaultctl's retrieval unit is the *document*; §3.2 mandates the *section*, hence a dedicated
section-granularity FTS table using the same tokenizer vaultctl uses (unicode61 remove_diacritics 2).
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

from vaultctl.store import db as vaultctl_db

SCHEMA_VERSION = "1"
# FTS5 tokenizer reused verbatim from vaultctl's sections_fts (constraint: no tokenizer change).
FTS_TOKENIZE = "unicode61 remove_diacritics 2"

_DOMAIN_DDL = f"""
CREATE TABLE IF NOT EXISTS sk_items (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('service','section','claim','probe','conflict')),
  repo          TEXT NOT NULL DEFAULT '',
  service_id    TEXT NOT NULL DEFAULT '',
  title         TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  text          TEXT NOT NULL DEFAULT '',
  literals      TEXT NOT NULL DEFAULT '',
  tags          TEXT NOT NULL DEFAULT '',
  source_path   TEXT NOT NULL DEFAULT '',
  source_ref    TEXT NOT NULL DEFAULT '',
  source_hash   TEXT NOT NULL DEFAULT '',
  authority     TEXT NOT NULL DEFAULT 'unverified',
  status        TEXT NOT NULL DEFAULT 'active',
  risk          TEXT NOT NULL DEFAULT 'low',
  territory     TEXT NOT NULL DEFAULT '[]',
  triggers      TEXT NOT NULL DEFAULT '[]',
  section_path  TEXT NOT NULL DEFAULT '',
  skill_rel_path TEXT NOT NULL DEFAULT '',
  claim_type    TEXT NOT NULL DEFAULT '',
  verification  TEXT NOT NULL DEFAULT '{{}}',
  related_ids   TEXT NOT NULL DEFAULT '[]',
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sk_items_service ON sk_items(service_id);
CREATE INDEX IF NOT EXISTS idx_sk_items_kind    ON sk_items(kind);
CREATE INDEX IF NOT EXISTS idx_sk_items_status  ON sk_items(status);

CREATE VIRTUAL TABLE IF NOT EXISTS sk_items_fts USING fts5(
  title,
  description,
  text,
  tags,
  literals,
  sk_item_id UNINDEXED,
  service_id UNINDEXED,
  tokenize='{FTS_TOKENIZE}'
);

CREATE TABLE IF NOT EXISTS sk_citations (
  id         INTEGER PRIMARY KEY,
  item_id    TEXT NOT NULL,
  path       TEXT NOT NULL,
  line_start INTEGER,
  line_end   INTEGER,
  ref        TEXT NOT NULL DEFAULT '',
  hash       TEXT NOT NULL DEFAULT '',
  FOREIGN KEY(item_id) REFERENCES sk_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sk_citations_item ON sk_citations(item_id);
CREATE INDEX IF NOT EXISTS idx_sk_citations_path ON sk_citations(path);

CREATE TABLE IF NOT EXISTS sk_conflicts (
  id             INTEGER PRIMARY KEY,
  item_id        TEXT NOT NULL,
  conflicts_with TEXT NOT NULL,
  authority      TEXT NOT NULL DEFAULT '',
  note           TEXT NOT NULL DEFAULT '',
  detected_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(item_id) REFERENCES sk_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sk_conflicts_item ON sk_conflicts(item_id);

CREATE TABLE IF NOT EXISTS sk_retrieval_events (
  id                  INTEGER PRIMARY KEY,
  timestamp           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  query_hash          TEXT NOT NULL DEFAULT '',
  service_ids_matched TEXT NOT NULL DEFAULT '[]',
  top_score           REAL,
  candidate_count     INTEGER NOT NULL DEFAULT 0,
  bundle_hash         TEXT NOT NULL DEFAULT '',
  duration_ms         REAL,
  source_ref          TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sk_retrieval_ts ON sk_retrieval_events(timestamp);

CREATE TABLE IF NOT EXISTS sk_index_state (
  id                INTEGER PRIMARY KEY CHECK (id = 1),
  source_ref        TEXT NOT NULL DEFAULT '',
  schema_version    TEXT NOT NULL DEFAULT '',
  generator_version TEXT NOT NULL DEFAULT '',
  index_hash        TEXT NOT NULL DEFAULT '',
  item_count        INTEGER NOT NULL DEFAULT 0,
  services_count    INTEGER NOT NULL DEFAULT 0,
  built_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


def connect(consumer_root: Path) -> sqlite3.Connection:
    """Open the per-repo index DB: vaultctl base schema + the sk_ domain extension."""
    from service_knowledge.index import paths

    conn = vaultctl_db.connect(paths.db_path(consumer_root))
    ensure_domain_schema(conn)
    return conn


def ensure_domain_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_DOMAIN_DDL)
    conn.commit()


def domain_tables(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name LIKE 'sk_%' ORDER BY name"
    ).fetchall()
    return [str(row[0]) for row in rows]
