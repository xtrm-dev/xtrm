# service-knowledge index — per-repo FTS5 evidence retrieval (PR3, v0.3.0)

The service-knowledge package ships a **derived, regenerable** per-repo evidence index that
turns the service registry + SKILL.md files + (PR1) claim manifests into a searchable SQLite
FTS5 store, exposed through three narrow **read-only** MCP tools. It implements research
[`§3`](../research/kb-knowledge-base-svc.md) (retrieval architecture). The SQLite/FTS5/BM25
substrate is **[vaultctl](../../../vaultctl)** — reused, not reimplemented.

- **Package:** `~/dev/xtrm/packages/service-knowledge` (`service_knowledge.index`)
- **Spec source:** [`docs/research/kb-knowledge-base-svc.md`](../research/kb-knowledge-base-svc.md) §3
- **Storage:** `<consumer>/.xtrm/cache/service-knowledge.sqlite`
- **Telemetry:** `<consumer>/.xtrm/state/service-knowledge/events.jsonl` (`component=knowledge-index`)

## Architecture

```
service-registry.json ─┐
SKILL.md (## sections) ─┼─> builder ─> .xtrm/cache/service-knowledge.sqlite
claim manifests (PR1)  ─┤              ├─ vaultctl layer: documents / sections_fts /
citations (extracted)  ─┤              │   document_links / document_graph_stats  (REUSED)
probes (health-check)  ─┘              └─ sk_ domain layer: sk_items / sk_items_fts /
                                          sk_citations / sk_conflicts /
                                          sk_retrieval_events / sk_index_state
```

**Two layers, one SQLite file.** `vaultctl.store.db.connect()` creates vaultctl's base schema;
`service_knowledge.index.schema` adds the five domain tables in the `sk_` namespace (constraint:
prefix to avoid collision — no `ATTACH DATABASE` needed since both layers share the file).

- **vaultctl layer (reused):** every registered service `SKILL.md` is indexed via
  `vaultctl.store.indexer.index_source`, so whole-skill BM25 (`vaultctl.store.search.search_documents`),
  wikilink resolution and in-degree graph stats come for free. If a SKILL contains `[[other-service]]`
  references, those become graph edges.
- **sk_ domain layer (rolled):** vaultctl's retrieval unit is the *document*; research §3.2 mandates
  the *section*. `sk_items_fts` is a section/claim/probe-granularity FTS5 table using vaultctl's exact
  tokenizer (`unicode61 remove_diacritics 2`).

### Domain tables

| Table | Content |
|---|---|
| `sk_items` | `kind ∈ {service, section, claim, probe, conflict}` rows + mutable `status` (provenance) |
| `sk_items_fts` | FTS5 over `title, description, text, tags, literals` (section granularity) |
| `sk_citations` | `path / line_start / line_end / ref / hash` per item |
| `sk_conflicts` | incompatible claim pairs + authority |
| `sk_retrieval_events` | **append-only** retrieval audit trail (query hash, never raw text) |
| `sk_index_state` | singleton: `source_ref`, `schema_version`, `generator_version`, `index_hash`, counts |

## Ranking (§3.5)

`score = 0.40·T + 0.30·L + 0.15·I + 0.10·A + 0.05·F`, then the post-rank penalty lattice.

| Signal | Meaning | Source |
|---|---|---|
| **T** territory | 1.0 path owned · 0.7 explicit service · 0.3 trigger · 0 else | registry territory/triggers |
| **L** lexical | percentile of BM25 within the candidate set | **vaultctl** `search_documents` + `sk_items_fts` |
| **I** intent | fraction of query literals (path/symbol/metric/alert/trigger) exactly matched | item searchable surface |
| **A** authority | 1.0 curated+verified · 0.8 auto+verified · 0.3 unverified · 0.2 memory | authority + verification verdict |
| **F** freshness | `exp(-ln(2)·changed_commits/20)` since `source_ref` | git (drift_detector helper) |

Post-rank penalties: `conflicted`+high-risk → **excluded**; `invalidated` → **excluded**;
`stale`+high-risk → −0.25; `insufficient_evidence`+high-risk → −0.15; unverified source → −0.10.

All weights, penalty magnitudes and the freshness half-life (20 commits) are constants in
`service_knowledge/index/ranking.py` — operator-tunable without touching the ranking logic.
No learned reranker, no RRF (justified only with ≥2 retrievers).

## MCP tools (read-only, §3.8)

| Tool | Function |
|---|---|
| `knowledge_search` | Search by query / path / service / intent → §3.2 evidence bundle |
| `knowledge_get` | Fetch one item by id, or a full SKILL.md by path |
| `knowledge_evidence_for_files` | Bundle for a list of paths (routes by territory ownership) |

`knowledge_probes` and `knowledge_conflicts` are **deferred** to follow-up beads (advisory
extras, low value at MVP); `list_tools` advertises them under `deferred`. There is deliberately
**no `answer()` endpoint** — the layer returns evidence, never conclusions.

### Evidence bundle (§3.2)

Each bundle carries: (1) routing header; (2) the 3–7 top items with their T/L/I/A/F signals;
(3) citations to code/config; (4) verification + freshness state; (5) conflicts/caveats;
(6) applicable read-only probes; (7) links to the full skills. Serialized size is capped at
**8000 tokens** (overflow trims lowest-ranked items first).

The MCP server speaks vaultctl's line-delimited JSON stdio protocol
(`{"tool": <name>, "args": {...}}` → `{"result": ...}`):

```bash
python -m service_knowledge.mcp.server
```

## CLI

```bash
service-knowledge index build      # full rebuild of the derived index
service-knowledge index rebuild    # explicit operator trigger (same as build)
service-knowledge index query "discord webhook" --bundle
service-knowledge index stats      # index_state + item counts + retrieval-event count
```

## Rebuild triggers

1. **On-demand:** `service-knowledge index rebuild`.
2. **Post-merge:** the `post_merge_drift_sweep.py` git hook rebuilds on a default-branch merge,
   so `index_state.source_ref` tracks `HEAD`.
3. **Stale-detection:** `index_state.source_ref != HEAD` ⇒ the cataloger reports `index_health: stale`
   (a rebuild is advised; PR4 wires automatic stale-rebuild on first tool call).

17-service rebuild benchmarks at **~50 ms** (budget ≤ 60 s).

## Provenance & conflicts (§3.6)

- **Current view is mutable** via the `status` field on `sk_items`.
- **History is append-only** via `sk_retrieval_events` (never deleted by a rebuild).
- When a claim's source changes or it drops from the manifest, it flips to `superseded` /
  `invalidated` and is **excluded from default retrieval** (still present for explicit history).

## Security

Secret **values** are never indexed. At ingestion a gitleaks-style scrubber redacts AWS keys,
credentialed URLs (`redis://:pw@host`), GitHub/Slack tokens, JWTs and private-key blocks; `.env`
files are skipped wholesale. Env-var **names** are indexed; **values** are not.

## Telemetry

Every query and rebuild appends one JSON line to `.xtrm/state/service-knowledge/events.jsonl`
with `component=knowledge-index`: `{timestamp, event=query|rebuild, query_hash, service_ids_matched,
top_score, candidate_count, duration_ms, source_ref, ...}`. Raw query text is never recorded —
only a SHA-256 hash. Grep by `component`.

## Cataloger reframe

The SessionStart catalog now advertises **"Available operational knowledge sources"** with
per-service `last_sync_ref` + index health + item count + verification coverage, replacing the
old "Available expert personas" list (still available behind `cataloger.py --legacy` for one
release cycle).

## Deferred (follow-ups)

- `knowledge_probes` MCP tool — list applicable probes + prerequisites.
- `knowledge_conflicts` MCP tool — show conflicts / stale claims for a service.
- Embeddings / vector search / sqlite-vec (measured trigger in PR5a).
- Cross-repo federation (fans out over `~/.xtrm/stack-registry.json`).
