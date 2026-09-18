"""Build and freeze Evidence Gate dataset v1 (XTRM-493).

    python -m xtrm_research.evidence_gate.build --out ~/.xtrm/research/datasets/evidence-gate-v1

Sources are discovered from their fixed locations; the source lists and
every count the build sees are recorded in the manifest so a later reader
can tell what population the sample came from (the source transcripts are
pruned by retention, which is why the set is frozen rather than re-derived).
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from xtrm_research.code_state import capture_code_state
from xtrm_research.evidence_gate import dataset as d

SEED = 20260918
#: Query groups per stratum. L groups hold ~2 passages (ctx_search's
#: per-query default); W groups hold up to WEB_RESULTS_PER_QUERY.
QUOTAS = {"L": 90, "W": 24}
QUESTIONS_V1 = [
    "relevant",
    "contains_usable_evidence",
    "contradicts_query_assumption",
    "contains_prompt_injection",
    "warrants_frontier_attention",
    "source_authority",
]
EXCLUDED_QUESTIONS = {
    "contradicts_accepted_evidence": "needs a sequential accepted_evidence state; v1 is single-pass with accepted_evidence=[]",
    "adds_novel_information": "novelty is defined against accepted_evidence, which v1 holds empty",
}


def _has(path: Path, needle: str) -> bool:
    try:
        with path.open(encoding="utf-8", errors="ignore") as handle:
            return any(needle in line for line in handle)
    except FileNotFoundError:
        return False


def discover(home: Path) -> dict[str, list[Path]]:
    pi = sorted(p for p in (home / ".pi").rglob("*.jsonl") if _has(p, '"ctx_search"'))
    claude = sorted(
        p
        for p in (home / ".claude" / "projects").glob("*/*.jsonl")
        if _has(p, "context-mode__ctx_search")
    )
    dbs = sorted((home / "dev").glob("*/.specialists/db/observability.db"))
    return {"pi": pi, "claude": claude, "specialists_dbs": dbs}


def build(out: Path, home: Path) -> dict:
    sources = discover(home)
    local = d.local_groups(sources["pi"], "pi-ctx_search") + d.local_groups(
        sources["claude"], "claude-ctx_search"
    )
    local_kept, local_counts = d.apply_filters(local, {"L": d.LOCAL_PASSAGES_PER_GROUP})

    web_raw = []
    for db in sources["specialists_dbs"]:
        web_raw.extend(d.researcher_web_queries(db))
    seen: set[str] = set()
    web_stubs = []
    for query, ref, ts in sorted(web_raw, key=lambda r: r[2]):
        key = query.strip().lower()
        if key in seen or not d.eligible_query(query):
            continue
        seen.add(key)
        web_stubs.append(d.Group("W", "specialists-researcher-ddgs", ref, ts, query))

    chosen_local = d.select_groups(local_kept, {"L": QUOTAS["L"]}, SEED)
    chosen_stubs = d.select_groups(web_stubs, {"W": QUOTAS["W"]}, SEED)
    retrieved_at = datetime.now(timezone.utc).isoformat()
    web = d.replay_web_queries(
        ((g.query, g.source_ref, g.ts) for g in chosen_stubs), retrieved_at
    )
    web_kept, web_counts = d.apply_filters(web, {"W": d.WEB_RESULTS_PER_QUERY})

    items = d.items_of(chosen_local + web_kept)
    manifest_fields = {
        "created_at": retrieved_at,
        "code_state": capture_code_state(Path(__file__).resolve().parents[3]),
        "questions": QUESTIONS_V1,
        "excluded_questions": EXCLUDED_QUESTIONS,
        "passage_char_limit": d.PASSAGE_CHAR_LIMIT,
        "provenance": {
            "L": "ctx_search tool results as originally returned, read from Pi session logs and Claude Code transcripts",
            "W": "ddgs text queries issued by Specialists researcher jobs, replayed once through the same tool (ddgs) at created_at; original results were truncated in the job log",
            "source_files": {
                "pi": len(sources["pi"]),
                "claude": len(sources["claude"]),
                "specialists_dbs": [str(p) for p in sources["specialists_dbs"]],
            },
        },
        "population": {
            "local_groups_raw": len(local),
            "local_groups_eligible": len(local_kept),
            "local_eligible_by_kind": d._count(
                [{"k": g.source_kind} for g in local_kept], "k"
            ),
            "web_queries_raw": len(web_raw),
            "web_queries_eligible_unique": len(web_stubs),
        },
        "selection": {
            "method": "per (stratum, source_kind): groups ordered by sha256(f'{seed}:{group_id}') and the first quota/n_kinds taken; quota split evenly across source kinds, remainder to the largest; W sampled before replay so only chosen queries were sent",
            "seed": SEED,
            "quotas": QUOTAS,
            "web_groups_selected": len(chosen_stubs),
            "web_groups_with_results": len(web_kept),
        },
        "filters": {
            "L": d.filter_counts_dict(local_counts),
            "W": d.filter_counts_dict(web_counts),
            "rules": "drop empty and within-group duplicate passages; drop queries with <3 word tokens and duplicate queries; guards.redact applied before truncation to passage_char_limit; L capped at LOCAL_PASSAGES_PER_GROUP in retrieval order",
        },
        "retrieval_W": {
            "tool": "ddgs text",
            "max_results": d.WEB_RESULTS_PER_QUERY,
            "replayed_at": retrieved_at,
        },
        "cluster_key": "source_ref (one ctx_search call for L, one researcher job for W): bootstrap resamples clusters, not items",
    }
    return d.freeze(items, out, manifest_fields)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    manifest = build(args.out.expanduser(), Path.home())
    print(
        json.dumps(
            {
                k: manifest[k]
                for k in (
                    "items_sha256",
                    "n_items",
                    "n_groups",
                    "by_stratum",
                    "by_source_kind",
                )
            },
            indent=1,
        )
    )


if __name__ == "__main__":
    main()
